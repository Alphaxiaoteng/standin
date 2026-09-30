"use client";

import { useEffect, useRef, useState } from "react";
import { runAgent } from "./api";
import type { ScenarioKey, TaskOutcome } from "./types";
import { formatTime, truncateHash } from "./format";
import { Badge, Hash } from "./ui";
import { IconPlay } from "./icons";

interface StreamLine {
  id: number;
  time: number;
  text: string;
  tone?: "danger" | "success" | "accent";
}

export const SCENARIOS: {
  key: ScenarioKey;
  label: string;
  desc: string;
}[] = [
  { key: "allowed", label: "正常采购", desc: "声明与 calldata 一致，预期放行" },
  { key: "phishing", label: "收款方篡改", desc: "提示词注入重定向到攻击者地址" },
  { key: "infinite", label: "无限授权", desc: "钓鱼合约诱导签署 2^256-1 授权" },
];

const STEP_TEMPLATES: Record<ScenarioKey, string[]> = {
  allowed: [
    "初始化 Agent 会话，绑定 ERC-8004 身份",
    "解析自然语言意图：采购第三方数据源 API 额度 0.5 USDC",
    "构造 calldata：transfer → 0x2222…2222，amount 500000",
    "调用 StandIn 彩排门禁比对意图与实际 calldata",
  ],
  phishing: [
    "初始化 Agent 会话，绑定 ERC-8004 身份",
    "解析自然语言意图：采购 API 额度 0.5 USDC",
    "外部内容注入，Agent 改写收款地址为 0x9999…9999",
    "构造 calldata：transfer → 0x9999…9999，amount 500000",
    "调用 StandIn 彩排门禁比对意图与实际 calldata",
  ],
  infinite: [
    "初始化 Agent 会话，绑定 ERC-8004 身份",
    "解析自然语言意图：为流式支付授权 1.0 USDC",
    "钓鱼合约返回畸形参数，Agent 构造无限授权",
    "构造 calldata：approve → amount 2^256-1",
    "调用 StandIn 彩排门禁比对意图与实际 calldata",
  ],
};

export default function RunConsole({ onFinished }: { onFinished?: () => void }) {
  const [scenario, setScenario] = useState<ScenarioKey>("allowed");
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [result, setResult] = useState<TaskOutcome | null>(null);
  const [offline, setOffline] = useState(false);
  const seq = useRef(0);
  const runId = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
    };
  }, []);

  const push = (text: string, tone?: StreamLine["tone"]) => {
    seq.current += 1;
    setLines((prev) => [...prev, { id: seq.current, time: Date.now(), text, tone }]);
  };

  const run = () => {
    if (running) return;
    setRunning(true);
    setResult(null);
    setOffline(false);
    setLines([]);
    seq.current = 0;

    const myRun = (runId.current += 1);
    const steps = STEP_TEMPLATES[scenario];

    steps.forEach((text, i) => {
      timers.current.push(
        setTimeout(() => {
          if (runId.current === myRun) push(text);
        }, i * 420),
      );
    });

    timers.current.push(
      setTimeout(() => {
        if (runId.current !== myRun) return;
        push("等待门禁裁决…", "accent");
        runAgent(scenario).then((outcome) => {
          if (runId.current !== myRun) return;
          if (!outcome || !outcome.result) {
            setOffline(true);
            push(
              outcome?.error
                ? `执行失败：${outcome.error}`
                : "执行服务未响应，本次仅展示本地剧本推演",
              "danger",
            );
            setRunning(false);
            return;
          }
          const summary = outcome.result;
          setResult(summary);
          const blocked = summary.status === "INTERCEPTED";
          push(
            blocked
              ? `门禁裁决：拦截。${summary.reason ?? "声明意图与实际 calldata 不一致"}`
              : "门禁裁决：放行。金库已按声明意图放款",
            blocked ? "danger" : "success",
          );
          if (summary.reportHash)
            push(`彩排报告已上链锚定 ${truncateHash(summary.reportHash)}`);
          if (outcome.transactionId)
            push(`已生成流水记录 ${outcome.transactionId}`);
          setRunning(false);
          onFinished?.();
        });
      }, steps.length * 420 + 200),
    );

    timers.current.push(
      setTimeout(() => {
        if (runId.current === myRun) setRunning(false);
      }, steps.length * 420 + 8000),
    );
  };

  const blocked = result ? result.status === "INTERCEPTED" : false;

  return (
    <div className="stack">
      <section className="card">
        <header className="card-head">
          <div>
            <div className="card-title">当前任务</div>
            <div className="card-desc">
              选择一个剧本驱动 Agent 发起支付，观察彩排门禁的裁决过程
            </div>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={run}
              disabled={running}
            >
              <IconPlay size={13} />
              {running ? "执行中…" : "运行剧本"}
            </button>
          </div>
        </header>
        <div className="card-body stack" style={{ gap: 14 }}>
          <div className="seg" role="tablist" aria-label="剧本选择">
            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={scenario === s.key}
                className={`seg-item${scenario === s.key ? " is-active" : ""}`}
                onClick={() => !running && setScenario(s.key)}
                title={s.desc}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="kv">
            <dt>剧本</dt>
            <dd>{SCENARIOS.find((s) => s.key === scenario)?.desc ?? "—"}</dd>
            <dt>任务 ID</dt>
            <dd className="mono">{result?.taskId ?? "待执行"}</dd>
            <dt>裁决</dt>
            <dd>
              {result ? (
                blocked ? (
                  <Badge tone="danger">已拦截</Badge>
                ) : (
                  <Badge tone="success">已放行</Badge>
                )
              ) : (
                <Badge tone="neutral">未运行</Badge>
              )}
            </dd>
            {result?.reportHash && (
              <>
                <dt>报告哈希</dt>
                <dd>
                  <Hash value={result.reportHash} />
                </dd>
              </>
            )}
          </div>

          {offline && (
            <div className="notice">
              <span>
                后端 <span className="mono">POST /api/agent/run</span>{" "}
                暂未返回数据，以上为前端剧本推演结果。
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="card" style={{ minHeight: 220 }}>
        <header className="card-head">
          <div>
            <div className="card-title">Agent 执行流</div>
            <div className="card-desc">逐步输出意图解析、calldata 构造与门禁裁决</div>
          </div>
          {running && <Badge tone="accent">运行中</Badge>}
        </header>
        <div className="card-body">
          {lines.length === 0 ? (
            <div className="empty">
              <div className="empty-title">尚未运行</div>
              <div>点击「运行剧本」开始</div>
            </div>
          ) : (
            <div className="stream">
              {lines.map((line) => (
                <div
                  key={line.id}
                  className={`stream-line${line.tone ? ` is-${line.tone}` : ""}`}
                >
                  <span className="stream-time">{formatTime(line.time)}</span>
                  <span className="stream-text">{line.text}</span>
                </div>
              ))}
              {running && (
                <div className="stream-line">
                  <span className="stream-time" />
                  <span className="stream-text">
                    <span className="caret" />
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
