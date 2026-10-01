"use client";

import { useEffect, useMemo, useState } from "react";
import PageHead from "../components/PageHead";
import IntentDiff from "../components/IntentDiff";
import { fetchRehearsal } from "../components/api";
import type { Rehearsal } from "../components/types";
import { formatAgo, formatDateTime } from "../components/format";
import { Badge, Card, Empty, Hash, Loading } from "../components/ui";
import { compareIntent, fromX402Response } from "../../lib/rehearse";

/** T7：粘贴一个 x402 402 响应 JSON，解析声明意图并与"实际付款"逐字段比对 */
function X402GateCard() {
  const [raw, setRaw] = useState("");
  const [actualTo, setActualTo] = useState("");
  const [actualAmount, setActualAmount] = useState("");
  const [actualToken, setActualToken] = useState("");

  const parsed = useMemo(() => {
    if (!raw.trim()) return null;
    try {
      return fromX402Response(JSON.parse(raw));
    } catch {
      return { ok: false as const, error: "不是合法的 JSON" };
    }
  }, [raw]);

  const intent = parsed?.ok ? parsed.intent : null;
  const verdict = useMemo(() => {
    if (!intent || !actualTo || !actualAmount || !actualToken) return null;
    if (!/^\d+$/.test(actualAmount.trim())) return null;
    return compareIntent(intent, {
      action: "transfer",
      token: actualToken.trim(),
      to: actualTo.trim(),
      amount: BigInt(actualAmount.trim()),
    });
  }, [intent, actualTo, actualAmount, actualToken]);

  return (
    <Card title="粘贴一个 402 响应 JSON" desc="x402 服务方的 402 响应即收款声明；门禁按它核对实际付款，任何字段越线都拦截">
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={'{\n  "accepts": [{ "scheme": "exact", "asset": "0x...", "amount": "1200000", "payTo": "0x..." }]\n}'}
        rows={8}
        className="mono"
        style={{
          width: "100%",
          padding: 12,
          border: "1px solid var(--border-soft)",
          borderRadius: 8,
          background: "var(--bg-soft, transparent)",
          fontSize: 12,
          resize: "vertical",
        }}
      />
      {parsed && !parsed.ok && (
        <div className="notice" style={{ borderLeftColor: "var(--red)", marginTop: 12 }}>
          <span className="mono">{parsed.error}</span>
        </div>
      )}
      {intent && (
        <div style={{ marginTop: 14 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>
            402 声明的收款意图
          </div>
          <dl className="kv">
            <dt>收款方 payTo</dt>
            <dd className="mono">{intent.to}</dd>
            <dt>金额（最小单位）</dt>
            <dd className="mono">{intent.amount.toString()}</dd>
            <dt>代币 asset</dt>
            <dd className="mono">{intent.token}</dd>
            {intent.memo && (
              <>
                <dt>资源描述</dt>
                <dd>{intent.memo}</dd>
              </>
            )}
          </dl>

          <div className="card-title" style={{ margin: "14px 0 8px" }}>
            实际付款参数（默认与声明一致，可修改以观察拦截）
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <input
              className="mono"
              value={actualTo}
              onChange={(e) => setActualTo(e.target.value)}
              placeholder={intent.to}
              style={{ padding: 8, border: "1px solid var(--border-soft)", borderRadius: 6, fontSize: 12 }}
            />
            <input
              className="mono"
              value={actualAmount}
              onChange={(e) => setActualAmount(e.target.value)}
              placeholder={intent.amount.toString()}
              style={{ padding: 8, border: "1px solid var(--border-soft)", borderRadius: 6, fontSize: 12 }}
            />
            <input
              className="mono"
              value={actualToken}
              onChange={(e) => setActualToken(e.target.value)}
              placeholder={intent.token}
              style={{ padding: 8, border: "1px solid var(--border-soft)", borderRadius: 6, fontSize: 12 }}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setActualTo(intent.to);
              setActualAmount(intent.amount.toString());
              setActualToken(intent.token);
            }}
            style={{ marginTop: 8, cursor: "pointer" }}
          >
            重置为与声明一致
          </button>
        </div>
      )}
      {verdict && (
        <div
          className="notice"
          style={{
            marginTop: 14,
            borderLeftColor: verdict.allowed ? "var(--green, var(--ink))" : "var(--red)",
          }}
        >
          <strong>{verdict.allowed ? "裁决：放行" : "裁决：拦截"}</strong>
          {verdict.reasons.length > 0 && (
            <div className="stack" style={{ gap: 4, marginTop: 6 }}>
              {verdict.reasons.map((r, i) => (
                <span key={i} className="mono" style={{ fontSize: 12 }}>
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function RehearsalPage() {
  const [data, setData] = useState<Rehearsal | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRehearsal().then((res) => {
      if (cancelled) return;
      setData(res);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="stack">
      <PageHead
        title="彩排报告"
        desc="Agent 声明它要做什么，彩排门禁解析真实 calldata 后逐字段比对。任何一项不一致都会阻断放款。"
      />

      <X402GateCard />

      {!loaded && (
        <Card title="彩排详情" flush>
          <Loading rows={5} />
        </Card>
      )}

      {!loaded ? null : !data ? (
        <Card title="彩排详情" flush>
          <Empty
            title="暂无彩排记录"
            hint="在概览页运行一个剧本后，这里会展示完整的比对报告"
          />
        </Card>
      ) : (
        <Card
          title={data.description || data.taskId}
          desc={`任务 ${data.taskId} · ${formatDateTime(data.ts)} · ${formatAgo(data.ts)}`}
          actions={
            data.allowed ? (
              <Badge tone="success">放行</Badge>
            ) : (
              <Badge tone="danger">拦截</Badge>
            )
          }
          flush
        >
          <IntentDiff rehearsal={data} />

          {data.reasons.length > 0 && (
            <div style={{ padding: 18, borderTop: "1px solid var(--border-soft)" }}>
              <div className="card-title" style={{ marginBottom: 10 }}>
                命中规则
              </div>
              <div className="stack" style={{ gap: 8 }}>
                {data.reasons.map((reason, i) => (
                  <div
                    key={i}
                    className="notice"
                    style={{ borderLeftColor: "var(--red)" }}
                  >
                    <span className="mono">{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            style={{
              padding: "0 18px 16px",
              borderTop: "1px solid var(--border-soft)",
            }}
          >
            <dl className="kv" style={{ paddingTop: 14 }}>
              <dt>报告 ID</dt>
              <dd className="mono">{data.id}</dd>
              <dt>报告哈希</dt>
              <dd>
                <Hash value={data.reportHash} head={16} tail={12} />
              </dd>
            </dl>
          </div>
        </Card>
      )}
    </div>
  );
}
