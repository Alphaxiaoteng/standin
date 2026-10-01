"use client";

/**
 * 今日账本（PRD §五 + T8 收口）：
 * 第一屏三个数——今日净利（仅链上确认部分）、可动用本金、已避免损失；
 * 演示收入单独一行小字，绝不与链上确认收入相加。
 * 每个数字可点开看来源（数据源/抓取时刻/交易哈希）。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchStats,
  fetchTransactions,
  fetchIntercepts,
  fetchEarningsReport,
  fetchOpportunities,
  runSopTask,
  type EarningsReport,
} from "./components/api";
import type { Intercept, Opportunity, Stats, Transaction } from "./components/types";
import { buildTimeline, Timeline } from "./components/Timeline";
import PageHead from "./components/PageHead";
import { formatAmount } from "./components/format";
import { IconShield, IconWallet, IconActivity } from "./components/icons";

const USDC_MONAD = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [intercepts, setIntercepts] = useState<Intercept[] | null>(null);
  const [report, setReport] = useState<EarningsReport | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTaskLabel, setActiveTaskLabel] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [openSource, setOpenSource] = useState<"net" | "balance" | "avoided" | "demo" | null>(null);

  const reload = () => {
    void fetchStats().then(setStats);
    void fetchTransactions().then(setTxs);
    void fetchIntercepts().then(setIntercepts);
    void fetchEarningsReport().then(setReport);
    void fetchOpportunities().then(setOpportunities);
  };

  useEffect(reload, []);

  const earn = async (o: Opportunity) => {
    setBusy(true);
    setActiveTaskLabel(o.title);
    setFlash(null);
    const out = await runSopTask({ bountyId: o.bountyId ?? o.id });
    setFlash(
      !out
        ? "这次没做成，后端未响应"
        : out.ok
          ? out.task.netUsdc >= 0
            ? "任务交付通过。链上确认收入以结算回执为准。"
            : `已结算，净亏 ${Math.abs(out.task.netUsdc).toFixed(2)} USDC（成本已沉没）。`
          : out.task.failReason
            ? `未通过：${out.task.failReason}`
            : "这次没做成",
    );
    reload();
    setActiveTaskLabel(null);
    setBusy(false);
  };

  const events = buildTimeline(txs, intercepts);
  const onchainNet = report?.onchainUsdcToday ?? 0;
  const balance = stats?.walletBalance ?? 0;
  const avoidedLoss = report?.avoidedLossUsdc ?? 0;
  const demoRevenue = report?.demoUsdc ?? 0;
  const todayCost = report?.todayCostUsdc ?? 0;

  const toggle = (k: "net" | "balance" | "avoided" | "demo") =>
    setOpenSource((cur) => (cur === k ? null : k));

  return (
    <div className="page">
      <PageHead
        title="今日账本"
        desc="AI 员工今天赚了多少、花了多少。链上确认收入与演示收入分开记账，亏损单如实显示。"
      />

      {/* 门禁演示直达：评委第一眼看到的应该是「它能拦住」，90 秒故事从这进 */}
      <div className="demo" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13 }}>
          <strong>30 秒看懂 StandIn：</strong>恶意调用当场拦截，合规调用逐字段一致才放行
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/guardrail" className="btn btn-primary" style={{ textDecoration: "none" }}>
          打开门禁演示 →
        </Link>
      </div>

      {/* 第一屏三个数（T8）：净利只算链上确认部分 */}
      <div className="summary">
        <button
          type="button"
          className="summary-item"
          onClick={() => toggle("net")}
          style={{ textAlign: "left", cursor: "pointer" }}
        >
          <span className="summary-label">今日净利（链上确认）</span>
          <span
            className="summary-value"
            style={{ color: onchainNet > 0 ? "var(--green)" : onchainNet < 0 ? "var(--red)" : "var(--text)" }}
          >
            {onchainNet > 0 ? "+" : ""}
            {formatAmount(onchainNet)}
            <em>USDC</em>
          </span>
        </button>
        <button
          type="button"
          className="summary-item"
          onClick={() => toggle("balance")}
          style={{ textAlign: "left", cursor: "pointer" }}
        >
          <span className="summary-label">
            <IconWallet size={12} /> 可动用本金
          </span>
          <span className="summary-value">
            {formatAmount(balance)}
            <em>USDC</em>
          </span>
        </button>
        <button
          type="button"
          className="summary-item"
          onClick={() => toggle("avoided")}
          style={{ textAlign: "left", cursor: "pointer" }}
        >
          <span className="summary-label">
            <IconShield size={12} /> 已避免损失
          </span>
          <span className="summary-value" style={{ color: "var(--green)" }}>
            {formatAmount(avoidedLoss)}
            <em>USDC</em>
          </span>
        </button>
      </div>

      {/* 演示收入：单独一行小字，不与链上确认收入相加 */}
      <button
        type="button"
        onClick={() => toggle("demo")}
        style={{
          alignSelf: "flex-start",
          background: "none",
          border: "none",
          padding: 0,
          color: "var(--text-dim)",
          fontSize: 12,
          cursor: "pointer",
          textDecoration: "underline dotted",
        }}
      >
        演示收入（DEMO BUYER，本地结算）{formatAmount(demoRevenue)} USDC · 今日成本 {formatAmount(todayCost)} USDC
      </button>

      {/* 来源面板：任一数字点开看到来源 */}
      {openSource === "net" && (
        <div className="notice">
          <div className="card-title">来源：链上 USDC Transfer 回执</div>
          {report && report.onchainTxs.length > 0 ? (
            <div className="stack" style={{ gap: 4, marginTop: 6 }}>
              {report.onchainTxs.map((t, i) => (
                <span key={i} className="mono" style={{ fontSize: 12 }}>
                  {t.taskId} · {formatAmount(t.revenueUsdc)} USDC ·{" "}
                  {t.explorerUrl ? (
                    <a href={t.explorerUrl} target="_blank" rel="noreferrer">
                      {t.txHash?.slice(0, 18)}…
                    </a>
                  ) : (
                    t.txHash?.slice(0, 18)
                  )}
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, marginTop: 6 }}>
              暂无链上确认收入（确认代币 {USDC_MONAD.slice(0, 10)}…）。没有买方付款回执就不计入净利。
            </div>
          )}
          <div style={{ fontSize: 12, marginTop: 6 }}>
            全部账本明细见 <Link href="/transactions">账本页</Link>
          </div>
        </div>
      )}
      {openSource === "balance" && (
        <div className="notice">
          <div className="card-title">来源：本地账本余额</div>
          <div style={{ fontSize: 12.5, marginTop: 6 }}>
            ledger.json stats.walletBalance（Monad 测试网 · 演示规模）。每笔成本扣减与
            {report && report.onchainTxs.length > 0 ? " 链上确认收入入账" : " 演示结算"}都会更新，
            流水见 <Link href="/transactions">账本页</Link>。
          </div>
        </div>
      )}
      {openSource === "avoided" && (
        <div className="notice">
          <div className="card-title">来源：拦截记录</div>
          <div style={{ fontSize: 12.5, marginTop: 6 }}>
            累计拦截 {stats?.interceptCount ?? 0} 次，按被拦截意图的声明金额推导避免损失。
            逐条证据（声明 vs 实际 calldata）见 <Link href="/guardrail">门禁页</Link> 与{" "}
            <Link href="/intercepts">拦截记录</Link>。
          </div>
        </div>
      )}
      {openSource === "demo" && (
        <div className="notice">
          <div className="card-title">来源：演示买方本地结算</div>
          <div style={{ fontSize: 12.5, marginTop: 6 }}>
            DEMO BUYER 不发生真实链上转账，验收通过即本地结算记账（meta.billing=demo）。
            演示收入与链上确认收入分开统计，本页从不把两者相加。
          </div>
        </div>
      )}

      {/* 状态行（PRD §五：一行「Agent 正在做…」） */}
      <div
        className="row"
        style={{
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: "#0e1017",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          fontSize: 13,
        }}
      >
        <IconActivity
          size={15}
          style={{
            color: busy ? "var(--accent)" : "var(--green)",
            animation: busy ? "pulse 1.2s infinite ease-in-out" : "none",
          }}
        />
        <span className="is-strong">
          {busy
            ? `Agent 正在做：${activeTaskLabel}…（多源实时采集中）`
            : "Agent 处于待命状态：健康度正常，等待新任务触发"}
        </span>
        <span className="spacer" />
        <Link
          href="/opportunities"
          className="muted"
          style={{ fontSize: 12, textDecoration: "underline" }}
        >
          查看完整机会与决策看板 →
        </Link>
      </div>

      {/* 机会卡片区 */}
      <div className="demo">
        <div className="demo-head">
          <div className="row" style={{ alignItems: "center" }}>
            <span className="demo-title">能赚的机会</span>
            <span className="spacer" />
            <Link
              href="/opportunities"
              className="muted"
              style={{ fontSize: 12, textDecoration: "underline" }}
            >
              看算法放弃理由 →
            </Link>
          </div>
          <span className="demo-hint">
            真实数据验收：三源中位数偏差超 50bps 或超时将判定未通过记亏。
          </span>
        </div>
        <div className="demo-grid">
          {(opportunities ?? []).map((o) => (
            <button
              key={o.id}
              type="button"
              className="demo-card demo-ok"
              onClick={() => void earn(o)}
              disabled={busy}
            >
              <span className="demo-card-label">{o.title}</span>
              <span className="demo-card-desc">
                预估净赚 {formatAmount(o.estNetUsdc)} USDC · 成本{" "}
                {formatAmount(o.costUsdc)} ·{" "}
                {o.risk === "medium" ? "风险中等" : "风险低"}
              </span>
            </button>
          ))}
        </div>
        {opportunities !== null && opportunities.length === 0 && (
          <div className="tl-empty">
            当前没有入选机会（可能余额不足或 EV ≤ 0）。前往「机会与决策」看放弃理由。
          </div>
        )}
      </div>

      {flash && <div className="demo-flash">{flash}</div>}

      {/* 时间轴：它做了什么 */}
      <div className="section">
        <div className="section-head">
          <span className="section-title">流水时间轴</span>
          <span className="section-hint">最新的在最上面</span>
        </div>
        {txs === null && intercepts === null ? (
          <div className="tl-empty">正在读取…</div>
        ) : (
          <Timeline events={events} showHashes={false} />
        )}
      </div>

      <div className="trust">
        <IconShield size={14} />
        <span>
          诚实边界：测试网测试币没有价值，只证明机制；不出现稳赚，真实价差过小自然会出现亏损单。
        </span>
      </div>
    </div>
  );
}
