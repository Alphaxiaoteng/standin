"use client";

/**
 * 本金保护（PRD §五）：原「拦截记录」页。
 * 用户不关心"被阻断的意图"，关心的是"帮你避免了多少损失"。
 * 顶部：累计避免损失；每条写明"若放行将损失 X"。
 */

import { useEffect, useState } from "react";
import PageHead from "../components/PageHead";
import { fetchIntercepts, fetchProtection } from "../components/api";
import type { Intercept, Protection } from "../components/types";
import { SCENARIO_LABEL, formatAmount, formatAgo, formatTime } from "../components/format";
import { Badge, Card, DataState, DataTable, Hash } from "../components/ui";
import { IconShield } from "../components/icons";

export default function InterceptsPage() {
  const [items, setItems] = useState<Intercept[] | null>(null);
  const [protection, setProtection] = useState<Protection | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchIntercepts().then((data) => {
      if (!cancelled) setItems(data);
    });
    fetchProtection().then((data) => {
      if (!cancelled) setProtection(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="stack">
      <PageHead
        title="本金保护"
        desc="付款与声明不一致、或出现新收款方时，门禁会拒绝放行。这里记录每一次保护，以及它帮你避免的损失。"
      />

      <div className="summary">
        <div className="summary-item">
          <span className="summary-label">
            <IconShield size={12} /> 累计避免损失
          </span>
          <span className="summary-value" style={{ color: "var(--green)" }}>
            {protection === null
              ? "…"
              : formatAmount(protection.totalAvoidedLossUsdc)}
            <em>USDC</em>
          </span>
        </div>
        <div className="summary-item">
          <span className="summary-label">拦截次数</span>
          <span className="summary-value">
            {protection === null ? "…" : protection.interceptCount}
            <em>次</em>
          </span>
        </div>
        <div className="summary-item">
          <span className="summary-label">可量化金额的拦截</span>
          <span className="summary-value">
            {protection === null ? "…" : protection.knownCount}
            <em>次</em>
          </span>
        </div>
      </div>

      <Card title="保护明细" desc="按时间倒序；金额无法量化时如实标注" flush>
        <DataState
          data={items}
          emptyTitle="暂无保护记录"
          emptyHint="运行「收款方篡改」或「无限授权」剧本可产生一条本金保护记录"
        >
          {(list) => (
            <DataTable
              head={["时间", "剧本 / 任务", "拦截原因", "若放行将损失", "声明 vs 实际", "报告哈希"]}
            >
              {list.map((it) => (
                <tr key={it.id}>
                  <td className="mono">
                    {formatTime(it.ts)}
                    <div className="muted">{formatAgo(it.ts)}</div>
                  </td>
                  <td className="is-strong">
                    {SCENARIO_LABEL[it.scenario] ?? it.scenario ?? "—"}
                    {it.taskId && <div className="muted mono">{it.taskId}</div>}
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    <div className="truncate" title={it.reason}>
                      {it.reason || "—"}
                    </div>
                    <Badge tone="danger">已拦截</Badge>
                  </td>
                  <td className="table-num">
                    {it.avoidedLossUsdc !== null && it.avoidedLossUsdc !== undefined ? (
                      <span style={{ color: "var(--green)", fontWeight: 600 }}>
                        {formatAmount(it.avoidedLossUsdc, 2)} USDC
                      </span>
                    ) : (
                      <span className="muted">金额未记录</span>
                    )}
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    <div className="mono truncate" title={it.declaredTo}>
                      声明 {it.declaredTo || "—"}
                    </div>
                    <div
                      className="mono truncate"
                      style={{ color: "#fca5a5" }}
                      title={it.actualTo}
                    >
                      实际 {it.actualTo || "—"}
                    </div>
                  </td>
                  <td>
                    <Hash value={it.reportHash} head={10} tail={8} />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </DataState>
      </Card>

      <div className="notice">
        <span>
          每次拦截都生成彩排报告并锚定到 StandInAnchor
          合约。测试网测试币没有价值，这里量化的"避免损失"只证明保护机制真实生效，不构成投资建议。
        </span>
      </div>
    </div>
  );
}
