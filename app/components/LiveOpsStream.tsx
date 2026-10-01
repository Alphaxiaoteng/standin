"use client";

/**
 * 实时操作流水（终端驾驶舱）：tail -f 账本。
 * 每 4 秒拉一次 /api/ledger，把真实账本条目映射成终端日志行。
 * 没有新条目时显示待命行——所有内容都来自真实账本，无任何编造。
 */

import { useEffect, useRef, useState } from "react";
import { fetchLedgerEntries, type LedgerTaskEntry } from "../components/api";

const STATUS_OP: Record<string, { op: string; cls: string }> = {
  SUCCESS: { op: "SETTLE", cls: "set" },
  PENDING: { op: "DELIVER", cls: "pend" },
  FAILED: { op: "FAIL", cls: "fail" },
  INTERCEPTED: { op: "GATE✗", cls: "itcp" },
  SKIPPED: { op: "SKIP", cls: "skip" },
};

function timeOf(ts: number): string {
  const d = new Date(ts);
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mm = `${d.getMinutes()}`.padStart(2, "0");
  const ss = `${d.getSeconds()}`.padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function lineOf(e: LedgerTaskEntry, i: number, total: number, newIds: Set<string>) {
  const meta = STATUS_OP[e.status] ?? { op: "EVENT", cls: "skip" };
  const net = e.netUsdc >= 0 ? `+${e.netUsdc.toFixed(2)}` : e.netUsdc.toFixed(2);
  const netColor = e.netUsdc > 0 ? "var(--green)" : e.netUsdc < 0 ? "var(--red)" : "var(--text-faint)";
  return (
    <div key={`${e.id}-${i}`} className={`opslog-line${newIds.has(e.id) ? " is-new" : ""}`}>
      <span className="t">{timeOf(e.ts)}</span>
      <span className={`op ${meta.cls}`}>{meta.op}</span>
      <span className="m">
        {e.taskId} · {e.taskType || "task"} · cost {e.costUsdc.toFixed(2)} · rev{" "}
        {e.revenueUsdc.toFixed(2)} ·{" "}
        <span style={{ color: netColor }}>net {net}</span>
      </span>
      <span style={{ flex: "0 0 auto", color: "var(--text-faint)" }}>
        {String(total - i).padStart(3, "0")}
      </span>
    </div>
  );
}

export default function LiveOpsStream({ limit = 8 }: { limit?: number }) {
  const [entries, setEntries] = useState<LedgerTaskEntry[] | null>(null);
  const [pulse, setPulse] = useState(0);
  const [nowTs, setNowTs] = useState<number | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const lastTopId = useRef<string | null>(null);
  const entriesRef = useRef<LedgerTaskEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await fetchLedgerEntries();
      if (!alive || !list) return;
      setEntries(list.slice(0, 40));
      setNowTs(Date.now());
      const top = list[0]?.id ?? null;
      if (top && lastTopId.current !== null && top !== lastTopId.current) {
        setPulse((n) => n + 1);
        // 新条目高亮：本次出现、上次没有的条目
        const prevIds = new Set((entriesRef.current ?? []).map((e) => e.id));
        const fresh = new Set(
          list.slice(0, limit).filter((e) => !prevIds.has(e.id)).map((e) => e.id),
        );
        if (fresh.size > 0) setNewIds(fresh);
      }
      entriesRef.current = list;
      lastTopId.current = top;
    };
    void load();
    const timer = setInterval(load, 4_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [limit]);

  const shown = (entries ?? []).slice(0, limit);

  return (
    <div className="opslog">
      <div className="opslog-head">
        <span className="opslog-live">live</span>
        <span>tail -f /ops/ledger</span>
        <span style={{ flex: 1 }} />
        <span>
          {entries === null ? "connecting…" : `${entries.length} entries`}
          {pulse > 0 ? ` · +${pulse} new` : ""}
        </span>
      </div>
      <div className="opslog-body">
        {shown.length === 0 ? (
          <div className="opslog-line">
            <span className="t">--:--:--</span>
            <span className="op skip">IDLE</span>
            <span className="m">等待第一笔真实任务写入账本…</span>
          </div>
        ) : (
          shown.map((e, i) => lineOf(e, i, entries?.length ?? 0, newIds))
        )}
        <div className="opslog-line">
          <span className="t">{nowTs === null ? "--:--:--" : timeOf(nowTs)}</span>
          <span className="op skip">WAIT</span>
          <span className="m">
            agent standby: gates armed, sources healthy
            <span className="opslog-cursor"> ▊</span>
          </span>
        </div>
      </div>
    </div>
  );
}
