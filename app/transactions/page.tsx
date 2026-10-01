"use client";

/**
 * 账本页（T8）：以"任务"为粒度展示成本、收入、净利、结果、结算状态。
 * 每条可点开：数据源与抓取时刻、验收规则命中情况、交易哈希与区块浏览器链接。
 * 买方标签：DEMO BUYER（本地演示结算）/ COMMUNITY BUYER（第三方 + 链上付款）。
 */

import { useEffect, useState } from "react";
import PageHead from "../components/PageHead";
import { fetchLedgerEntries, type LedgerTaskEntry } from "../components/api";
import { formatAmount, formatTime } from "../components/format";
import { Badge, Card, DataState } from "../components/ui";

const STATUS_TONE: Record<string, "success" | "danger" | "warn" | "neutral"> = {
  SUCCESS: "success",
  PENDING: "warn",
  FAILED: "danger",
  INTERCEPTED: "danger",
  SKIPPED: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  SUCCESS: "成功",
  PENDING: "待链上结算",
  FAILED: "失败",
  INTERCEPTED: "已拦截",
  SKIPPED: "跳过",
};

function buyerLabel(e: LedgerTaskEntry): string | null {
  if (e.buyerType === "third_party") {
    return e.settlement === "confirmed" ? "COMMUNITY BUYER" : "COMMUNITY BUYER（待链上确认）";
  }
  if (e.buyerType === "demo" || e.billing === "demo") return "DEMO BUYER";
  return null;
}

function TaskRow({ e }: { e: LedgerTaskEntry }) {
  const [open, setOpen] = useState(false);
  const buyer = buyerLabel(e);
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "#0e1017",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          color: "inherit",
          textAlign: "left",
          padding: "10px 14px",
          cursor: "pointer",
        }}
      >
        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <span className="is-strong" style={{ fontSize: 13 }}>
            {e.description}
          </span>
          {buyer && <Badge tone={e.buyerType === "demo" ? "neutral" : "accent"}>{buyer}</Badge>}
          <span className="spacer" />
          <span style={{ fontSize: 12.5 }}>
            成本 {formatAmount(e.costUsdc)} · 收入 {formatAmount(e.revenueUsdc)} ·{" "}
            <strong style={{ color: e.netUsdc >= 0 ? "var(--green)" : "var(--red)" }}>
              净 {formatAmount(e.netUsdc)}
            </strong>{" "}
            USDC
          </span>
          <Badge tone={STATUS_TONE[e.status] ?? "neutral"}>
            {STATUS_LABEL[e.status] ?? e.status}
          </Badge>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
          {formatTime(e.ts)} · 任务 {e.taskId}
          {e.taskType ? ` · ${e.taskType}` : ""}
        </div>
      </button>

      {open && (
        <div style={{ padding: "0 14px 12px", borderTop: "1px solid var(--border)" }}>
          {e.reason && (
            <div className="notice" style={{ borderLeftColor: "var(--red)", marginTop: 10 }}>
              <span style={{ fontSize: 12.5 }}>{e.reason}</span>
            </div>
          )}

          {e.verifyChecks.length > 0 && (
            <>
              <div className="card-title" style={{ margin: "10px 0 6px" }}>
                验收规则命中
              </div>
              <div className="stack" style={{ gap: 3 }}>
                {e.verifyChecks.map((c, i) => (
                  <span key={i} style={{ fontSize: 12, color: c.passed ? "var(--text)" : "var(--red)" }}>
                    {c.passed ? "✓" : "✗"} {c.label}
                  </span>
                ))}
              </div>
            </>
          )}

          {e.dataSources.length > 0 && (
            <>
              <div className="card-title" style={{ margin: "10px 0 6px" }}>
                数据源与抓取时刻
              </div>
              <div className="stack" style={{ gap: 3 }}>
                {e.dataSources.map((d, i) => {
                  const fetchedAt = typeof d.fetchedAt === "number" ? d.fetchedAt : null;
                  return (
                    <span key={i} className="mono" style={{ fontSize: 11.5 }}>
                      {String(d.source ?? "?")}
                      {fetchedAt ? ` · 抓取于 ${formatTime(fetchedAt)}` : ""}
                    </span>
                  );
                })}
              </div>
            </>
          )}

          {e.txHash && (
            <>
              <div className="card-title" style={{ margin: "10px 0 6px" }}>
                链上证据
              </div>
              <span className="mono" style={{ fontSize: 11.5, wordBreak: "break-all" }}>
                交易 {e.txHash}
                {e.explorerUrl && (
                  <>
                    {" · "}
                    <a href={e.explorerUrl} target="_blank" rel="noreferrer">
                      在区块浏览器查看 ↗
                    </a>
                  </>
                )}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function TransactionsPage() {
  const [items, setItems] = useState<LedgerTaskEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLedgerEntries().then((data) => {
      if (!cancelled) setItems(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="stack">
      <PageHead
        title="账本"
        desc="以任务为粒度：每单的成本、收入、净利、结果与结算状态。点开任意一条可看验收命中、数据源抓取时刻与链上回执。"
      />

      <Card title="全部账本（任务粒度）" desc="最新的在最上面；链上确认收入带交易哈希，演示收入标 DEMO BUYER" flush>
        <DataState
          data={items}
          emptyTitle="账本为空"
          emptyHint="Agent 完成第一单后，这里会出现任务级明细"
        >
          {(list) => (
            <div className="stack" style={{ gap: 8, padding: 16 }}>
              {list.map((e) => (
                <TaskRow key={e.id} e={e} />
              ))}
            </div>
          )}
        </DataState>
      </Card>
    </div>
  );
}
