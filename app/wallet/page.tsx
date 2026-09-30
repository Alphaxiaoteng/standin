"use client";

import { useCallback, useEffect, useState } from "react";
import PageHead from "../components/PageHead";
import {
  createPolicy,
  fetchPolicies,
  fetchStats,
  revokePolicy,
} from "../components/api";
import type { Policy, Stats } from "../components/types";
import { formatAmount, formatExpiry, isExpired } from "../components/format";
import { Badge, Card, DataState, DataTable, Hash, Loading } from "../components/ui";
import { IconPlus } from "../components/icons";

export default function WalletPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(() => {
    fetchStats().then(setStats);
    fetchPolicies().then(setPolicies);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRevoke = async (id: string) => {
    setBusy(id);
    setError(null);
    const res = await revokePolicy(id);
    if (!res.ok) setError(res.error ?? "撤销失败");
    await fetchPolicies().then(setPolicies);
    setBusy(null);
  };

  const onCreate = async (input: {
    agent: string;
    merchantHash: string;
    maxPerTx: number;
    maxPerWeek: number;
    expires: number;
  }) => {
    const res = await createPolicy(input);
    if (!res.ok) return res.error ?? "创建策略失败";
    await fetchPolicies().then(setPolicies);
    setError(null);
    return null;
  };

  return (
    <div className="stack">
      <PageHead
        title="经营设置"
        desc="设定 Agent 经营的三个硬边界：本金规模、每日最多亏多少（止损线）、以及允许做的生意类型。超出边界时门禁强制拦截。"
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setFormOpen((v) => !v)}
          >
            <IconPlus size={13} />
            新建策略
          </button>
        }
      />

      {error && (
        <div className="notice" style={{ borderLeftColor: "var(--red)" }}>
          <span>{error}</span>
        </div>
      )}

      {formOpen && (
        <PolicyForm
          onCancel={() => setFormOpen(false)}
          onSubmit={onCreate}
          onError={setError}
        />
      )}

      <div className="grid grid-3">
        <Card title="经营本金" desc="Agent 可支配的最大金库余额">
          {stats === null ? (
            <Loading rows={2} />
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <div className="metric-value is-accent" style={{ fontSize: 32 }}>
                {formatAmount(stats.walletBalance)}
                <span className="metric-unit">USDC</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                今日已花 {formatAmount(stats.todaySpent)} USDC · 本金保护拦截{" "}
                {stats.interceptCount} 次
              </div>
            </div>
          )}
        </Card>

        <Card title="每日最多亏多少" desc="在 Agent 之外强制执行的止损">
          <dl className="dl">
            <dt>单日止损线</dt>
            <dd style={{ color: "var(--red)", fontWeight: 650 }}>
              净亏损 ≥ 预算 30%（停手到次日）
            </dd>
            <dt>连亏熔断</dt>
            <dd>同一类型连亏 3 单暂停接单</dd>
            <dt>仓位控制</dt>
            <dd>单笔不超过预算 35%；连亏 2 次仓位减半</dd>
            <dt>���健康门槛</dt>
            <dd>健康度低于 0.6 不接该任务</dd>
          </dl>
        </Card>

        <Card title="可做的生意类型" desc="当前系统支持的两类任务">
          <dl className="dl">
            <dt>任务 A · 数据简报</dt>
            <dd>BTC/ETH 双源报价 + HN 5 条热点，新鲜度 ≤ 60 秒</dd>
            <dt>任务 B · 价差监测</dt>
            <dd>两源价差越过 50bps 容忍带即通知，未越带则记亏</dd>
            <dt>裁决原则</dt>
            <dd style={{ color: "var(--green)" }}>真实数据裁决，不保证赚钱</dd>
          </dl>
        </Card>
      </div>

      <Card title="支出护栏（白名单与上限）" desc="限定每个 Agent 对指定商户单笔和每周最多花多少" flush>
        <DataState
          data={policies}
          emptyTitle="暂无策略"
          emptyHint="新建策略后，Agent 才能发起支付"
        >
          {(list) => (
            <DataTable
              head={[
                "Agent",
                "商户摘要",
                "单笔上限",
                "每周上限",
                "有效期",
                "状态",
                "操作",
              ]}
            >
              {list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Hash value={p.agent} head={10} tail={6} />
                  </td>
                  <td>
                    <Hash value={p.merchantHash} head={10} tail={6} />
                  </td>
                  <td className="table-num">{formatAmount(p.maxPerTx)}</td>
                  <td className="table-num">{formatAmount(p.maxPerWeek)}</td>
                  <td className="mono">{formatExpiry(p.expires)}</td>
                  <td>
                    {!p.active ? (
                      <Badge tone="neutral">已撤销</Badge>
                    ) : isExpired(p.expires) ? (
                      <Badge tone="warn">已过期</Badge>
                    ) : (
                      <Badge tone="success">生效中</Badge>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={!p.active || busy === p.id}
                      onClick={() => onRevoke(p.id)}
                    >
                      {busy === p.id ? "处理中…" : "撤销"}
                    </button>
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

const DAY_MS = 86_400_000;

function PolicyForm({
  onCancel,
  onSubmit,
  onError,
}: {
  onCancel: () => void;
  onSubmit: (input: {
    agent: string;
    merchantHash: string;
    maxPerTx: number;
    maxPerWeek: number;
    expires: number;
  }) => Promise<string | null>;
  onError: (message: string) => void;
}) {
  const [agent, setAgent] = useState("0xAgent_ERC8004_Identity_Bound");
  const [merchantHash, setMerchantHash] = useState("");
  const [maxPerTx, setMaxPerTx] = useState("5");
  const [maxPerWeek, setMaxPerWeek] = useState("50");
  const [days, setDays] = useState("30");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const error = await onSubmit({
      agent,
      merchantHash,
      maxPerTx: Number(maxPerTx) || 0,
      maxPerWeek: Number(maxPerWeek) || 0,
      expires: Date.now() + (Number(days) || 0) * DAY_MS,
    });
    setSaving(false);
    if (error) onError(error);
    else onCancel();
  };

  return (
    <Card title="新建策略" desc="保存后立即对该 Agent 生效">
      <div className="stack" style={{ gap: 14 }}>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <label className="field">
            <span className="field-label">Agent 标识</span>
            <input
              className="input is-mono"
              placeholder="0x… 或 Agent ID"
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">商户摘要 merchantHash</span>
            <input
              className="input is-mono"
              placeholder="0x…"
              value={merchantHash}
              onChange={(e) => setMerchantHash(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">单笔上限（USDC）</span>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={maxPerTx}
              onChange={(e) => setMaxPerTx(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">每周上限（USDC）</span>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={maxPerWeek}
              onChange={(e) => setMaxPerWeek(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">有效天数</span>
            <input
              className="input"
              type="number"
              min="1"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={saving || !agent || !merchantHash}
          >
            {saving ? "保存中…" : "保存策略"}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            取消
          </button>
          <span className="spacer" />
          <span className="muted">每周上限需不小于单笔上限</span>
        </div>
      </div>
    </Card>
  );
}
