"use client";

/**
 * 悬赏市场（PRD §五）：发布和查看悬赏，标明买方来源。
 * 内置买方标 DEMO BUYER；第三方发布的标"第三方悬赏"。
 * 数据一律来自 /api/bounties，前端不写死任何悬赏。
 */

import { useCallback, useEffect, useState } from "react";
import PageHead from "../components/PageHead";
import { createBounty, fetchBounties } from "../components/api";
import type { Bounty } from "../components/types";
import { BOUNTY_STATUS_LABEL, formatAmount, formatAgo, formatTime } from "../components/format";
import { Badge, Card, DataState } from "../components/ui";
import { IconFlag, IconPlus } from "../components/icons";

const KIND_LABEL: Record<Bounty["kind"], string> = {
  data_brief: "数据简报",
  spread_watch: "价差监测",
};

const KIND_DESC: Record<Bounty["kind"], string> = {
  data_brief: "BTC/ETH 双源价格 + 5 条科技热点，数据不得早于设定窗口",
  spread_watch: "窗口内两源价差超出容忍带即通知买方，窗口结束用真实数据回放判定",
};

export default function BountiesPage() {
  const [bounties, setBounties] = useState<Bounty[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const reload = useCallback(() => {
    void fetchBounties().then(setBounties);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="stack">
      <PageHead
        title="悬赏市场"
        desc="买方在这里发布数据任务，Agent 按打分决定接不接。报酬由验收结果决定：验收不通过，成本照付、拿不到报酬。报酬为 Monad 测试网演示定价（同类 x402 服务市场价约 $0.005/次起），不代表真实市场行情。"
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setFormOpen((v) => !v)}
          >
            <IconPlus size={13} />
            发布悬赏
          </button>
        }
      />

      {flash && <div className="demo-flash">{flash}</div>}

      {formOpen && (
        <BountyForm
          busy={busy}
          onCancel={() => setFormOpen(false)}
          onSubmit={async (input) => {
            setBusy(true);
            const res = await createBounty(input);
            setBusy(false);
            if (!res.ok) {
              setFlash(res.error ?? "发布失败");
              return res.error ?? "发布失败";
            }
            setFlash("悬赏已发布，Agent 会在下一次决策时评估是否接单。");
            setFormOpen(false);
            reload();
            return null;
          }}
        />
      )}

      <Card
        title="全部悬赏"
        desc="标 DEMO BUYER 的是内置演示买方；欢迎真人发布，发布后同样走验收规则"
        flush
      >
        <DataState
          data={bounties}
          emptyTitle="暂无悬赏"
          emptyHint="点击右上角「发布悬赏」创建第一条任务"
        >
          {(list) => (
            <div className="stack" style={{ gap: 10 }}>
              {list.map((b) => (
                <div key={b.id} className="demo-card" style={{ textAlign: "left", cursor: "default" }}>
                  <div className="row" style={{ alignItems: "center", gap: 8 }}>
                    <IconFlag size={14} />
                    <span className="demo-card-label">{b.title || KIND_LABEL[b.kind]}</span>
                    <Badge tone={b.buyerType === "demo" ? "neutral" : "accent"}>
                      {b.buyerType === "demo" ? "DEMO BUYER" : "第三方悬赏"}
                    </Badge>
                    <Badge
                      tone={
                        b.status === "open"
                          ? "success"
                          : b.status === "failed"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {BOUNTY_STATUS_LABEL[b.status] ?? b.status}
                    </Badge>
                    <span className="spacer" />
                    <span className="is-strong" style={{ color: "var(--green)" }}>
                      {formatAmount(b.rewardUsdc)} USDC
                    </span>
                  </div>
                  <div className="demo-card-desc">
                    {b.description || KIND_DESC[b.kind]}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {KIND_LABEL[b.kind]} · 窗口 {b.windowSec} 秒
                    {b.toleranceBps !== null && b.toleranceBps !== undefined
                      ? ` · 容忍带 ${b.toleranceBps} bps`
                      : ""}
                    {b.buyer ? ` · 买方 ${b.buyer}` : ""}
                    {b.createdAt ? ` · ${formatTime(b.createdAt)}（${formatAgo(b.createdAt)}）` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DataState>
      </Card>

      <div className="notice">
        <span>
          诚实边界：测试网测试币没有价值，悬赏市场是可运行的演示市场。Agent
          的收入由真实数据验收决定，可能出现亏损单。
        </span>
      </div>
    </div>
  );
}

const DAY_MS = 86_400_000;

function BountyForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    kind: "data_brief" | "spread_watch";
    rewardUsdc: number;
    windowSec: number;
    toleranceBps?: number;
    buyerType: "third_party";
    buyerName: string;
  }) => Promise<string | null>;
}) {
  const [kind, setKind] = useState<"data_brief" | "spread_watch">("data_brief");
  const [reward, setReward] = useState("2");
  const [windowMin, setWindowMin] = useState("60");
  const [toleranceBps, setToleranceBps] = useState("50");
  const [buyerName, setBuyerName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const rewardUsdc = Number(reward);
    const minutes = Number(windowMin);
    if (!Number.isFinite(rewardUsdc) || rewardUsdc <= 0) {
      setError("报酬必须是大于 0 的数字");
      return;
    }
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setError("时限必须是大于 0 的分钟数");
      return;
    }
    const input = {
      kind,
      rewardUsdc,
      windowSec: Math.round(minutes * 60),
      toleranceBps: kind === "spread_watch" ? Number(toleranceBps) || 50 : undefined,
      buyerType: "third_party" as const,
      buyerName: buyerName.trim(),
    };
    const err = await onSubmit(input);
    if (err) setError(err);
  };

  return (
    <Card title="发布悬赏" desc="任何人都可以发布；Agent 会按期望收益决定是否接单">
      <div className="stack" style={{ gap: 14 }}>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <label className="field">
            <span className="field-label">任务类型</span>
            <select
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as "data_brief" | "spread_watch")}
            >
              <option value="data_brief">数据简报（双源价格 + 热点）</option>
              <option value="spread_watch">价差监测（越带即通知）</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">报酬（USDC）</span>
            <input
              className="input"
              type="number"
              min="0.1"
              step="0.1"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">时限（分钟）</span>
            <input
              className="input"
              type="number"
              min="1"
              value={windowMin}
              onChange={(e) => setWindowMin(e.target.value)}
            />
          </label>
          {kind === "spread_watch" && (
            <label className="field">
              <span className="field-label">价差容忍带（基点 bps）</span>
              <input
                className="input"
                type="number"
                min="1"
                value={toleranceBps}
                onChange={(e) => setToleranceBps(e.target.value)}
              />
            </label>
          )}
          <label className="field">
            <span className="field-label">你的署名（可选，留空则匿名发布）</span>
            <input
              className="input"
              placeholder="例如：Alice 的数据站"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
            />
          </label>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {KIND_DESC[kind]}
        </div>
        {error && (
          <div className="notice" style={{ borderLeftColor: "var(--red)" }}>
            <span>{error}</span>
          </div>
        )}
        <div className="row">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "发布中…" : "发布悬赏"}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            取消
          </button>
          <span className="spacer" />
          <span className="muted">发布后由 Agent 自主决策是否接单，不保证成交</span>
        </div>
      </div>
    </Card>
  );
}
