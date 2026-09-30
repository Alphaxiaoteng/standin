"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchStats } from "./api";
import type { Stats } from "./types";
import { formatAmount } from "./format";
import { Metric } from "./ui";

export default function MetricsRow({ refreshKey = 0 }: { refreshKey?: number }) {
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    fetchStats().then((data) => {
      if (!cancelled) setStats(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load, refreshKey]);

  const offline = stats === null;

  return (
    <div className="grid grid-3">
      <Metric
        label="今日支出"
        value={offline ? "—" : formatAmount(stats.todaySpent)}
        unit="USDC"
        foot={offline ? "指标接口未返回数据" : "已放行交易的累计金额"}
      />
      <Metric
        label="拦截数"
        value={offline ? "—" : String(stats.interceptCount)}
        unit="次"
        tone={stats && stats.interceptCount > 0 ? "danger" : undefined}
        foot={offline ? "指标接口未返回数据" : "彩排不一致被门禁阻断"}
      />
      <Metric
        label="钱包余额"
        value={offline ? "—" : formatAmount(stats.walletBalance)}
        unit="USDC"
        tone="accent"
        foot={offline ? "指标接口未返回数据" : "Agent 可支配余额"}
      />
    </div>
  );
}
