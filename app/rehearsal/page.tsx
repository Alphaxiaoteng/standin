"use client";

import { useEffect, useState } from "react";
import PageHead from "../components/PageHead";
import IntentDiff from "../components/IntentDiff";
import { fetchRehearsal } from "../components/api";
import type { Rehearsal } from "../components/types";
import { formatAgo, formatDateTime } from "../components/format";
import { Badge, Card, Empty, Hash, Loading } from "../components/ui";

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

  if (!loaded) {
    return (
      <div className="stack">
        <PageHead title="彩排报告" desc="最近一次彩排的逐字段比对结果" />
        <Card title="彩排详情" flush>
          <Loading rows={5} />
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="stack">
        <PageHead title="彩排报告" desc="最近一次彩排的逐字段比对结果" />
        <Card title="彩排详情" flush>
          <Empty
            title="暂无彩排记录"
            hint="在概览页运行一个剧本后，这里会展示完整的比对报告"
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead
        title="彩排报告"
        desc="Agent 声明它要做什么，彩排门禁解析真实 calldata 后逐字段比对。任何一项不一致都会阻断放款。"
      />

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
    </div>
  );
}
