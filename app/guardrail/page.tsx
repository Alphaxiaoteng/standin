"use client";

/**
 * 门禁红绿灯控制台：把三个剧本并排对比，让评委 30 秒看懂「拦截 vs 放行」。
 *
 * 所有裁决结果均来自真实模块计算：
 *   POST /api/agent/run → lib/runtime.runScenario → ScriptedAgentRunner + compareIntent。
 * 逐字段比对证据（声明意图 vs 实际 calldata）来自该次运行写入的彩排记录（GET /api/rehearsal）。
 * 拦截分支的「避免损失」金额取自 GET /api/intercepts 的真实推导（按声明意图金额），非写死数字。
 * 展示的是本地彩排报告哈希，如实标注「本地账本记录」，绝不标称链上交易哈希。
 */

import { useState } from "react";
import PageHead from "../components/PageHead";
import IntentDiff from "../components/IntentDiff";
import { runAgent, fetchRehearsal, fetchIntercepts } from "../components/api";
import type { Rehearsal, ScenarioKey, TaskOutcome } from "../components/types";
import { formatAmount } from "../components/format";
import { Badge, Card, Hash } from "../components/ui";
import { IconPlay } from "../components/icons";

interface ColumnResult {
  outcome: TaskOutcome;
  rehearsal: Rehearsal | null;
  avoidedLossUsdc: number | null;
}

const RED_SCENARIOS: { key: ScenarioKey; label: string; desc: string }[] = [
  { key: "phishing", label: "收款方篡改", desc: "提示词注入把资金重定向到攻击者地址" },
  { key: "infinite", label: "无限授权", desc: "钓鱼合约诱导签署 2^256-1 授权" },
];

const GREEN_SCENARIO: { key: ScenarioKey; label: string; desc: string } = {
  key: "allowed",
  label: "正常采购",
  desc: "声明意图与实际 calldata 完全一致，预期放行",
};

export default function GuardrailPage() {
  const [red, setRed] = useState<ColumnResult | null>(null);
  const [green, setGreen] = useState<ColumnResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: ScenarioKey) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const outcome = await runAgent(kind);
    if (!outcome?.result) {
      setError(outcome?.error ?? "执行服务未响应，未产生真实裁决结果");
      setBusy(false);
      return;
    }
    const summary = outcome.result;
    // 拉取本次运行写入的彩排记录（按 taskId 匹配，防止并发覆盖错取）
    const rehearsal = await fetchRehearsal();
    const matched = rehearsal && rehearsal.taskId === summary.taskId ? rehearsal : null;

    let avoidedLossUsdc: number | null = null;
    if (summary.status === "INTERCEPTED" && outcome.interceptId) {
      const list = await fetchIntercepts();
      const hit = (list ?? []).find((i) => i.id === outcome.interceptId);
      if (hit) avoidedLossUsdc = hit.avoidedLossUsdc ?? null;
    }

    const result: ColumnResult = { outcome: summary, rehearsal: matched, avoidedLossUsdc };
    if (summary.status === "INTERCEPTED") setRed(result);
    else setGreen(result);
    setBusy(false);
  };

  return (
    <div className="stack">
      <PageHead
        title="门禁红绿灯"
        desc="AI Agent 想花钱时，先比对「声明意图」与「实际 calldata」：逐字段一致才放行，任一不符当场拦截。没有这道门，一次提示词注入就能把本金转走。"
      />

      {error && (
        <div className="notice" style={{ borderLeftColor: "var(--red)" }}>
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        {/* 左：红灯 · 拦截 */}
        <Card
          title="红灯 · 拦截"
          desc="声明与实际不一致，门禁拒绝放款，本金分毫未动"
          actions={<Badge tone="danger">INTERCEPTED</Badge>}
          flush
        >
          <div className="stack" style={{ padding: 18, gap: 14 }}>
            <div className="seg" role="group" aria-label="拦截剧本">
              {RED_SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="seg-item"
                  onClick={() => void run(s.key)}
                  disabled={busy}
                  title={s.desc}
                >
                  <IconPlay size={12} /> {s.label}
                </button>
              ))}
            </div>

            {!red && <div className="empty">点击剧本触发拦截演练</div>}

            {red && <RedPanel result={red} />}
          </div>
        </Card>

        {/* 右：绿灯 · 放行 */}
        <Card
          title="绿灯 · 放行"
          desc="逐字段一致，门禁按声明意图放行"
          actions={<Badge tone="success">EXECUTED</Badge>}
          flush
        >
          <div className="stack" style={{ padding: 18, gap: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void run(GREEN_SCENARIO.key)}
              disabled={busy}
              title={GREEN_SCENARIO.desc}
              style={{ alignSelf: "flex-start" }}
            >
              <IconPlay size={13} /> {busy ? "执行中…" : `运行「${GREEN_SCENARIO.label}」`}
            </button>

            {!green && <div className="empty">点击运行放行演练</div>}

            {green && <GreenPanel result={green} />}
          </div>
        </Card>
      </div>

      <div className="notice">
        <span>
          裁决由 ScriptedAgentRunner + compareIntent 实时计算；下方哈希为本地彩排报告哈希（账本记录），
          测试网测试币无价值，只证明门禁机制真实生效。
        </span>
      </div>
    </div>
  );
}

function RedPanel({ result }: { result: ColumnResult }) {
  const { outcome, rehearsal, avoidedLossUsdc } = result;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div
        className="summary"
        style={{
          padding: "12px 14px",
          background: "var(--red-dim)",
          border: "1px solid rgba(239,68,68,0.35)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        <div className="summary-item">
          <span className="summary-label" style={{ color: "var(--text-dim)" }}>
            避免损失（按声明意图金额）
          </span>
          <span className="summary-value" style={{ color: "var(--green)" }}>
            {avoidedLossUsdc === null
              ? "金额未记录"
              : `${formatAmount(avoidedLossUsdc)} USDC`}
          </span>
        </div>
      </div>

      {outcome.reason && (
        <div className="notice" style={{ borderLeftColor: "var(--red)" }}>
          <span className="mono">拦截依据：{outcome.reason}</span>
        </div>
      )}

      {rehearsal ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          <IntentDiff rehearsal={rehearsal} />
        </div>
      ) : (
        <div className="muted">
          本次彩排记录尚未取到，仅展示裁决与报告哈希。
          {outcome.reportHash && (
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <span className="muted">报告哈希（本地账本记录）</span>
              <Hash value={outcome.reportHash} head={14} tail={10} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GreenPanel({ result }: { result: ColumnResult }) {
  const { outcome, rehearsal } = result;
  const amountUsdc = rehearsal?.declaredIntent.amountUsdc ?? null;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div
        className="summary"
        style={{
          padding: "12px 14px",
          background: "var(--green-dim)",
          border: "1px solid rgba(52,211,153,0.35)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        <div className="summary-item">
          <span className="summary-label" style={{ color: "var(--text-dim)" }}>
            按声明意图放款
          </span>
          <span className="summary-value" style={{ color: "var(--green)" }}>
            {amountUsdc === null ? "—" : `${formatAmount(amountUsdc)} USDC`}
          </span>
        </div>
      </div>

      <div className="kv">
        <dt>任务</dt>
        <dd>{outcome.description || outcome.taskId}</dd>
        <dt>裁决</dt>
        <dd>
          {rehearsal && rehearsal.reasons.length === 0 ? (
            <Badge tone="success">全部字段一致 · 放行</Badge>
          ) : (
            <Badge tone="success">放行</Badge>
          )}
        </dd>
        <dt>报告哈希</dt>
        <dd>
          <Hash value={outcome.reportHash ?? "0x"} head={16} tail={12} />
          <span className="muted" style={{ marginLeft: 8 }}>
            本地彩排账本记录（非链上交易哈希）
          </span>
        </dd>
      </div>

      {rehearsal && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          <IntentDiff rehearsal={rehearsal} />
        </div>
      )}
    </div>
  );
}