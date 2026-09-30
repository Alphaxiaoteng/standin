"use client";

import { useEffect, useState } from "react";
import PageHead from "../components/PageHead";
import { fetchTransactions } from "../components/api";
import type { Transaction } from "../components/types";
import { formatAmount, formatTime, statusLabel, statusTone } from "../components/format";
import { Badge, Card, DataState, DataTable, Hash } from "../components/ui";

export default function TransactionsPage() {
  const [items, setItems] = useState<Transaction[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTransactions().then((data) => {
      if (!cancelled) setItems(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="stack">
      <PageHead
        title="交易流水"
        desc="通过彩排门禁并成功放款的结算记录（本地账本）。被拦截的请求不会在此出现，请前往拦截记录查看。"
      />

      <Card title="全部流水" desc="按时间倒序" flush>
        <DataState
          data={items}
          emptyTitle="暂无交易"
          emptyHint="Agent 成功放行一笔支付后，这里会出现记录"
        >
          {(list) => (
            <DataTable head={["时间", "收款方", "金额", "状态", "本地流水号", "彩排报告哈希"]}>
              {list.map((tx) => (
                <tr key={tx.id}>
                  <td className="mono">{formatTime(tx.ts)}</td>
                  <td>
                    <Hash value={tx.to} head={8} tail={6} />
                  </td>
                  <td className="table-num is-strong">
                    {formatAmount(tx.amount)}
                    <span className="metric-unit">{tx.token}</span>
                  </td>
                  <td>
                    <Badge tone={statusTone(tx.status)}>{statusLabel(tx.status)}</Badge>
                  </td>
                  <td>
                    <Hash value={tx.txHash} head={10} tail={8} />
                  </td>
                  <td>
                    <Hash value={tx.reportHash} head={10} tail={8} />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </DataState>
      </Card>
    </div>
  );
}
