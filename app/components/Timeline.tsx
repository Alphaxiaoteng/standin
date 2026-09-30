"use client";

/**
 * 把「交易流水」与「拦截记录」合并成一条按时间倒序、说人话的事件流。
 * 用户不需要看懂哈希和策略，只需要知道：AI 员工干了什么、钱花了多少、有没有出事。
 */

import type { Transaction, Intercept } from "./types";
import { IconAlert, IconShield, IconCopy } from "./icons";
import { truncateHash } from "./format";
import { useState } from "react";

export type TimelineEvent =
  | { kind: "paid"; ts: number; data: Transaction }
  | { kind: "blocked"; ts: number; data: Intercept };

/** 把后端两条列表合成时间轴（新→旧） */
export function buildTimeline(
  txs: Transaction[] | null,
  intercepts: Intercept[] | null
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  (txs ?? []).forEach((t) => events.push({ kind: "paid", ts: t.ts, data: t }));
  (intercepts ?? []).forEach((i) => events.push({ kind: "blocked", ts: i.ts, data: i }));
  return events.sort((a, b) => b.ts - a.ts);
}

/** 收款方人话描述：0x2222 与 0x4a7D 均为白名单商户，其余为陌生地址 */
function describeCounterparty(t: Transaction & { known?: boolean }): { name: string; hint: string } {
  const addr = t.to.toLowerCase();
  const isKnown =
    typeof t.known === "boolean"
      ? t.known
      : addr.startsWith("0x2222") || addr.startsWith("0x4a7d");
  return isKnown
    ? { name: "已授权数据商户", hint: "在白名单内的合规收款方" }
    : { name: "未授权收款方", hint: "不在白名单内，已触发审计" };
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="tl-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "已复制" : <IconCopy size={12} />}
    </button>
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <div className="tl-empty">还没有动态。运行一次任务后，这里会按顺序记录它做的每一件事。</div>;
  }

  return (
    <ol className="tl">
      {events.map((ev, idx) => {
        if (ev.kind === "paid") {
          const t = ev.data;
          const who = describeCounterparty(t);
          return (
            <li key={t.id} className="tl-item tl-paid">
              <div className="tl-rail">
                <span className="tl-dot tl-dot-ok" />
                {idx !== events.length - 1 && <span className="tl-line" />}
              </div>
              <div className="tl-body">
                <div className="tl-head">
                  <span className="tl-title">付款成功</span>
                  <span className="tl-time">{timeLabel(ev.ts)}</span>
                </div>
                <p className="tl-desc">
                  向 <strong>{who.name}</strong> 支付 <strong>{t.amount} USDC</strong>
                </p>
                <div className="tl-meta">
                  <span>{who.hint}</span>
                  <span className="tl-hash">
                    交易 {truncateHash(t.txHash, 8, 6)}
                    <Copy text={t.txHash} />
                  </span>
                </div>
              </div>
            </li>
          );
        }

        const i = ev.data;
        const isInfinite = i.reason.includes("Infinite");
        return (
          <li key={i.id} className="tl-item tl-blocked">
            <div className="tl-rail">
              <span className="tl-dot tl-dot-bad">
                <IconAlert size={12} />
              </span>
              {idx !== events.length - 1 && <span className="tl-line" />}
            </div>
            <div className="tl-body">
              <div className="tl-head">
                <span className="tl-title tl-title-bad">
                  {isInfinite ? "已拦截：无限授权风险" : "已拦截：收款方异常"}
                </span>
                <span className="tl-time">{timeLabel(ev.ts)}</span>
              </div>
              <p className="tl-desc">
                {isInfinite
                  ? "它打算把钱包权限全部交给对方，一旦授权，余额可能被随时转走。"
                  : "它要把钱打给一个陌生地址，而不是原本说好的供应商。"}
              </p>
              {isInfinite ? (
                <div className="tl-compare">
                  <div>
                    <span className="tl-cmp-label">原本申请额度</span>
                    <span className="tl-cmp-ok">1.0 USDC</span>
                  </div>
                  <div>
                    <span className="tl-cmp-label">实际索要额度</span>
                    <span className="tl-cmp-bad">无限额度 (2²⁵⁶-1)</span>
                  </div>
                </div>
              ) : (
                <div className="tl-compare">
                  <div>
                    <span className="tl-cmp-label">原本要付给</span>
                    <span className="tl-cmp-ok">{truncateHash(i.declaredTo, 8, 6)}</span>
                  </div>
                  <div>
                    <span className="tl-cmp-label">实际要付给</span>
                    <span className="tl-cmp-bad">{truncateHash(i.actualTo, 8, 6)}</span>
                  </div>
                </div>
              )}
              <div className="tl-foot">
                <span className="tl-saved">
                  <IconShield size={12} /> 资金未损失，已阻止
                </span>
                <span className="tl-hash">
                  报告 {truncateHash(i.reportHash, 8, 6)}
                  <Copy text={i.reportHash} />
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
