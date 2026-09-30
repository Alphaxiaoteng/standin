"use client";

/**
 * 今日账本（PRD §五）：
 * 顶部三个数：收入、成本、净利（真实账本数据，亏损单如实显示）。
 * 下方：本金曲线、状态行「Agent 正在做…」、机会快捷入口、时间轴流水。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchStats,
  fetchTransactions,
  fetchIntercepts,
  fetchProtection,
  fetchEarningsToday,
  fetchOpportunities,
  runAgent,
  runSopTask,
} from "./components/api";
import type {
  EarningsToday,
  Intercept,
  Opportunity,
  Protection,
  Stats,
  Transaction,
} from "./components/types";
import { buildTimeline, Timeline } from "./components/Timeline";
import PageHead from "./components/PageHead";
import { formatAmount } from "./components/format";
import { IconShield, IconAlert, IconWallet, IconActivity } from "./components/icons";

const SCENARIOS = [
  { key: "allowed", label: "正常采购", desc: "它按规矩向供应商付款", tone: "ok" },
  { key: "phishing", label: "遇到骗子", desc: "被诱导把钱转给陌生地址", tone: "bad" },
  { key: "infinite", label: "授权陷阱", desc: "被要求交出全部钱包权限", tone: "bad" },
] as const;

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [intercepts, setIntercepts] = useState<Intercept[] | null>(null);
  const [protection, setProtection] = useState<Protection | null>(null);
  const [earnings, setEarnings] = useState<EarningsToday | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTaskLabel, setActiveTaskLabel] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const reload = () => {
    void fetchStats().then(setStats);
    void fetchTransactions().then(setTxs);
    void fetchIntercepts().then(setIntercepts);
    void fetchProtection().then(setProtection);
    void fetchEarningsToday().then(setEarnings);
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
            ? `验收通过，净赚 ${out.task.netUsdc.toFixed(2)} USDC。`
            : `已结算，净亏 ${Math.abs(out.task.netUsdc).toFixed(2)} USDC（成本已沉没）。`
          : out.task.failReason
            ? `未通过：${out.task.failReason}`
            : "这次没做成",
    );
    reload();
    setActiveTaskLabel(null);
    setBusy(false);
  };

  const run = async (key: string) => {
    setBusy(true);
    setActiveTaskLabel(`执行「${key}」场景测试`);
    setFlash(null);
    const out = await runAgent(key as "allowed" | "phishing" | "infinite");
    if (out?.result?.status === "INTERCEPTED") {
      setFlash("发现异常，已拦截，钱没丢。");
    } else if (out?.result?.status === "EXECUTED") {
      setFlash("付款成功，已记入流水。");
    }
    reload();
    setActiveTaskLabel(null);
    setBusy(false);
  };

  const events = buildTimeline(txs, intercepts);
  const revenue = earnings?.totalRevenueUsdc ?? 0;
  const cost = earnings?.totalCostUsdc ?? 0;
  const net = earnings?.netUsdc ?? 0;
  const balance = stats?.walletBalance ?? 0;
  const spent = stats?.todaySpent ?? 0;
  const avoidedLoss = protection?.totalAvoidedLossUsdc ?? 0;

  return (
    <div className="page">
      <PageHead
        title="今日账本"
        desc="AI 员工今天赚了多少、花了多少。数据全部来自落盘账本，亏损单如实显示。"
      />

      {/* 顶部三个核心指标（PRD §五：收入、成本、净利） */}
      <div className="summary">
        <div className="summary-item">
          <span className="summary-label">今日收入</span>
          <span className="summary-value" style={{ color: "var(--green)" }}>
            {formatAmount(revenue)}
            <em>USDC</em>
          </span>
        </div>
        <div className="summary-item">
          <span className="summary-label">今日成本</span>
          <span className="summary-value">
            {formatAmount(cost)}
            <em>USDC</em>
          </span>
        </div>
        <div
          className={`summary-item ${net < 0 ? "summary-item-bad" : ""}`}
        >
          <span className="summary-label">今日净利</span>
          <span
            className="summary-value"
            style={{
              color: net > 0 ? "var(--green)" : net < 0 ? "var(--red)" : "var(--text)",
            }}
          >
            {net > 0 ? "+" : ""}
            {formatAmount(net)}
            <em>USDC</em>
          </span>
        </div>
      </div>

      {/* 资产与本金保护次级行 */}
      <div className="summary">
        <div className="summary-item">
          <span className="summary-label">
            <IconWallet size={12} /> 本金余额
          </span>
          <span className="summary-value">
            {formatAmount(balance)}
            <em>USDC</em>
          </span>
        </div>
        <div className="summary-item">
          <span className="summary-label">
            <IconShield size={12} /> 门禁避免损失
          </span>
          <span className="summary-value" style={{ color: "var(--green)" }}>
            {formatAmount(avoidedLoss)}
            <em>USDC</em>
          </span>
        </div>
        <div className="summary-item">
          <span className="summary-label">今日支出流水</span>
          <span className="summary-value">
            {formatAmount(spent)}
            <em>USDC</em>
          </span>
        </div>
      </div>

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
            ? `Agent 正在做：${activeTaskLabel}…（双源实时采集中）`
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
            真实数据验收：价差超 50bps 或超时将判定未通过记亏。
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

      {/* 门禁剧本测试 */}
      <div className="demo">
        <div className="demo-head">
          <span className="demo-title">安全门禁演练</span>
          <span className="demo-hint">
            测试门禁对异常意图的防御：篡改收款方或无限授权都会被拦截
          </span>
        </div>
        <div className="demo-grid">
          {SCENARIOS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`demo-card demo-${s.tone}`}
              onClick={() => void run(s.key)}
              disabled={busy}
            >
              <span className="demo-card-label">{s.label}</span>
              <span className="demo-card-desc">{s.desc}</span>
            </button>
          ))}
        </div>
        {flash && <div className="demo-flash">{flash}</div>}
      </div>

      {/* 时间轴：它做了什么 */}
      <div className="section">
        <div className="section-head">
          <span className="section-title">流水时间轴</span>
          <span className="section-hint">最新的在最上面</span>
        </div>
        {txs === null && intercepts === null ? (
          <div className="tl-empty">正在读取…</div>
        ) : (
          <Timeline events={events} />
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
