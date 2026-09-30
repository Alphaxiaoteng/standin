"use client";

/**
 * 机会与决策（PRD §五）：
 * 决策卡：候选、选中、放弃理由、预算占用。
 * 用户可点击「让它做」触发 SOP 状态机；执行后展示确定性规则验收清单与净利结算。
 * 触发止损时以醒目提示接管。所有数据均来自 /api/opportunities。
 */

import { useCallback, useEffect, useState } from "react";
import PageHead from "../components/PageHead";
import { fetchOpportunityBoard, runSopTask } from "../components/api";
import type { OpportunityBoard, OpportunityDecision, SopRunOutcome } from "../components/types";
import { formatAmount } from "../components/format";
import { Badge, Card, DataState } from "../components/ui";
import { IconCheck, IconPlay, IconAlert, IconShield } from "../components/icons";

const KIND_LABEL: Record<string, string> = {
  data_brief: "数据简报",
  spread_watch: "价差监测",
};

export default function OpportunitiesPage() {
  const [board, setBoard] = useState<OpportunityBoard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SopRunOutcome | null>(null);

  const reload = useCallback(() => {
    void fetchOpportunityBoard().then(setBoard);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const execute = async (o: OpportunityDecision) => {
    setBusy(o.id);
    const res = await runSopTask({ bountyId: o.bountyId ?? o.id });
    setOutcome(res);
    setBusy(null);
    reload();
  };

  const guard = board?.guard;
  const config = board?.config;
  const remainingBudget = Math.max(
    0,
    (config?.dailyBudgetUsdc ?? 10) - (guard?.spentTodayUsdc ?? 0),
  );

  return (
    <div className="stack">
      <PageHead
        title="机会与决策"
        desc="Agent 按算法打分（EV = p·h·报酬 − 成本 − 风险惩罚）自主决策。剔除的都写明放弃理由；放弃不是失败，是控制。"
      />

      {/* 止损提示条（PRD §五 关键时刻 4） */}
      {guard?.halt && (
        <div
          className="notice"
          style={{
            borderLeftColor: "var(--red)",
            background: "rgba(239, 68, 68, 0.08)",
            padding: 16,
          }}
        >
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <IconAlert size={18} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 650, color: "var(--red)", fontSize: 14 }}>
                {guard.haltReason ?? "今日已触发止损停手"}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                当日净亏损已达预算 30% 止损线，Agent 自动停手至次日，避免继续扩大亏损。
              </div>
            </div>
            <Badge tone="danger">强制止损中</Badge>
          </div>
        </div>
      )}

      {/* 经营与预算摘要 */}
      <div className="summary">
        <div className="summary-item">
          <span className="summary-label">今日预算剩余</span>
          <span className="summary-value">
            {formatAmount(remainingBudget)}
            <em>USDC</em>
          </span>
        </div>
        <div className="summary-item">
          <span className="summary-label">单笔仓位上限</span>
          <span className="summary-value">
            {formatAmount(config?.perTradeCapUsdc ?? 5)}
            <em>USDC</em>
          </span>
        </div>
        <div className="summary-item">
          <span className="summary-label">
            <IconShield size={12} /> 止损触发线
          </span>
          <span className="summary-value" style={{ color: "var(--text-dim)" }}>
            {formatAmount((config?.dailyBudgetUsdc ?? 10) * 0.3)}
            <em>USDC</em>
          </span>
        </div>
      </div>

      {/* 执行结果面板：验收清单逐条打勾（PRD §五 关键时刻 2 与 3） */}
      {outcome && (
        <Card
          title={
            outcome.ok
              ? "验收通过 · 收益结算完成"
              : outcome.task.status === "failed"
                ? "验收未通过 · 成本沉没记亏"
                : outcome.task.status === "intercepted"
                  ? "门禁拦截 · 本金受保护"
                  : "任务跳过"
          }
          desc={`任务 ${outcome.task.id}（${outcome.task.label}）`}
        >
          <div className="stack" style={{ gap: 14 }}>
            <div className="row" style={{ alignItems: "baseline", gap: 16 }}>
              <div>
                <span className="muted" style={{ fontSize: 12 }}>结算净利：</span>
                <span
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: outcome.task.netUsdc >= 0 ? "var(--green)" : "var(--red)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {outcome.task.netUsdc >= 0 ? "+" : ""}
                  {formatAmount(outcome.task.netUsdc)} USDC
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                成本 {formatAmount(outcome.task.costUsdc)} · 收入{" "}
                {formatAmount(outcome.task.revenueUsdc)} USDC
              </div>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setOutcome(null)}
              >
                关闭结果
              </button>
            </div>

            {outcome.verify.checks.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>
                  验收规则判定（真实数据裁决）：
                </div>
                {outcome.verify.checks.map((chk, i) => (
                  <div
                    key={i}
                    className="row"
                    style={{
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12.5,
                      color: chk.passed ? "var(--text)" : "var(--red)",
                    }}
                  >
                    <IconCheck
                      size={14}
                      style={{ color: chk.passed ? "var(--green)" : "var(--red)" }}
                    />
                    <span>{chk.label}</span>
                    <Badge tone={chk.passed ? "success" : "danger"}>
                      {chk.passed ? "通过" : "未过"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {outcome.task.failReason && (
              <div className="notice" style={{ borderLeftColor: "var(--red)" }}>
                <span>原因：{outcome.task.failReason}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* 选中的候选卡��� */}
      <Card
        title="入选机会（按期望收益排序）"
        desc="由算法选出：EV > 0、源健康度 ≥ 0.6、在今日预算与单笔上限内"
        flush
      >
        <DataState
          data={board?.opportunities ?? null}
          emptyTitle="当前没有入选机会"
          emptyHint="所有候选要么 EV ≤ 0，要么源不健康或超上限，详见下方放弃理由"
        >
          {(list) => (
            <div className="stack" style={{ gap: 12, padding: 16 }}>
              {list.map((o) => (
                <div
                  key={o.id}
                  className="demo-card demo-ok"
                  style={{ textAlign: "left", cursor: "default" }}
                >
                  <div className="row" style={{ alignItems: "center", gap: 8 }}>
                    <span className="demo-card-label">{o.title}</span>
                    <Badge tone={o.buyerType === "demo" ? "neutral" : "accent"}>
                      {o.buyer}
                    </Badge>
                    {o.sampleInsufficient && (
                      <Badge tone="warn">样本不足（p 取 0.5）</Badge>
                    )}
                    <span className="spacer" />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void execute(o)}
                      disabled={busy !== null || !!guard?.halt}
                    >
                      <IconPlay size={12} />
                      {busy === o.id ? "执行中…" : "让它做"}
                    </button>
                  </div>

                  <div className="demo-card-desc">{o.description}</div>

                  <div
                    className="row"
                    style={{
                      gap: 16,
                      fontSize: 12,
                      marginTop: 6,
                      paddingTop: 8,
                      borderTop: "1px dashed var(--border)",
                    }}
                  >
                    <span>
                      报酬：<strong>{formatAmount(o.rewardUsdc)}</strong> USDC
                    </span>
                    <span>
                      成本：<strong>{formatAmount(o.costUsdc)}</strong> USDC
                    </span>
                    <span style={{ color: "var(--green)" }}>
                      期望收益 EV：<strong>{formatAmount(o.ev)}</strong> USDC
                    </span>
                    <span>
                      排序分 EV/成本：<strong>{o.score.toFixed(2)}</strong>
                    </span>
                    <span className="muted">
                      成功率 p={o.p} · 健康度 h={o.h}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DataState>
      </Card>

      {/* 放弃理由（PRD §三：记录剔除原因作为「放弃理由」展���） */}
      <Card
        title="放弃理由（未入选的候选）"
        desc="严格按规则剔除，不因「可能赚」而冒险执行"
        flush
      >
        <DataState
          data={board?.skipped ?? null}
          emptyTitle="没有被放弃的候选"
          emptyHint="所有开放悬赏都符合当前执行条件"
        >
          {(skipped) => (
            <div className="stack" style={{ gap: 8, padding: 16 }}>
              {skipped.map((s) => (
                <div
                  key={s.id}
                  className="row"
                  style={{
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    background: "#0e1017",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <Badge tone="neutral">{s.id}</Badge>
                  {s.title && <span className="is-strong">{s.title}</span>}
                  <span className="spacer" />
                  <span style={{ color: "var(--red)", fontSize: 12.5 }}>
                    放弃理由：{s.reason}
                  </span>
                </div>
              ))}
            </div>
          )}
        </DataState>
      </Card>

      <div className="notice">
        <span>
          诚实边界：排序分与期望收益由算法生成，LLM 只润色文案，不决定接单顺序；
          未入选机会被剔除是特性不是 bug。
        </span>
      </div>
    </div>
  );
}
