"use client";

/**
 * 本金控制甲板（终端驾驶舱重构）：逻辑与原经营设置页完全一致
 * （createPolicy / revokePolicy / fetchStats 原样复用），只重做展示：
 * 本金读数、/etc/guard.conf 风格的硬边界配置面板（数值全部来自真实常量）、
 * 支出护栏策略表。超出边界时门禁强制拦截——本页只读配置与生效状态。
 */

import { useCallback, useEffect, useState } from "react";
import PageHead from "../components/PageHead";
import {
  createPolicy,
  fetchPolicies,
  revokePolicy,
} from "../components/api";
import type { Policy } from "../components/types";
import { formatAmount, formatExpiry, isExpired } from "../components/format";
import { Badge, Card, DataState, DataTable, Hash } from "../components/ui";
import { IconAlert, IconLink, IconPlus, IconWallet } from "../components/icons";
import { useWallet } from "../components/WalletProvider";
import { EXPLORER } from "@/lib/chain";

function ConfLine({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 12, lineHeight: 1.7 }}>
      <span className="mono" style={{ color: "var(--text-faint)", flex: "0 0 178px" }}>
        {k}
      </span>
      <span className="mono" style={{ color: tone ?? "var(--text)" }}>
        {v}
      </span>
    </div>
  );
}

export default function WalletPage() {
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(() => {
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
        title="本金控制甲板"
        desc="Agent 经营的硬边界在这里配置与生效：本金规模、每日止损线、可做的生意类型。边界在 Agent 之外强制——Agent 每一步都要问过它。"
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
        <Card title="链上本金" desc="你的钱包在 Monad 测试网上的余额，直接读链">
          <ChainBalance />
        </Card>

        <Card title="guard.conf" desc="止损与仓位——在 Agent 之外强制执行">
          <div className="stack" style={{ gap: 2 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 6 }}>
              # /etc/standin/guard.conf · 生效中
            </div>
            <ConfLine k="stop_loss_daily" v="net_loss >= 30% budget → halt" tone="var(--red)" />
            <ConfLine k="consecutive_pause" v="3 losses same kind → pause kind" />
            <ConfLine k="stake" v="min(5 USDC, 35% budget)" />
            <ConfLine k="stake_halving" v="2-loss streak → stake / 2" />
            <ConfLine k="min_source_health" v="0.6" />
            <ConfLine k="daily_budget" v="10 USDC (demo)" />
          </div>
        </Card>

        <Card title="jobs.conf" desc="当前系统支持的两类任务">
          <div className="stack" style={{ gap: 2 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 6 }}>
              # /etc/standin/jobs.conf · 真实数据裁决
            </div>
            <ConfLine k="job A data_brief" v="BTC/ETH 三源价 + HN 热点" />
            <ConfLine k="freshness" v="<= 60s · median dev <= 50bps" />
            <ConfLine k="job B spread_watch" v="breach > band → notify → replay" />
            <ConfLine k="settlement" v="on-chain USDC receipt ONLY" tone="var(--green)" />
            <ConfLine k="guarantee" v="none. 真实裁决，不保证赚钱" tone="var(--red)" />
          </div>
        </Card>
      </div>

      <Card title="支出护栏策略" desc="限定每个 Agent 对指定商户单笔和每周最多花多少" flush>
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

function ChainBalance() {
  const wallet = useWallet();
  const busy = wallet.phase === "connecting" || wallet.phase === "switching" || wallet.phase === "reading";

  if (!wallet.address) {
    return (
      <div className="stack" style={{ gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>
          {wallet.hasProvider
            ? "连接后这里显示你地址上的测试 USDC 和 MON。没有预置余额。"
            : "这个浏览器里没有注入钱包。安装 MetaMask 后刷新再连接。"}
        </div>
        {wallet.error && (
          <div className="notice" style={{ borderLeftColor: "var(--red)" }}>
            <span>{wallet.error}</span>
          </div>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || (!wallet.hasProvider && wallet.phase === "error")}
          onClick={() => void wallet.connect()}
        >
          <IconLink size={13} />
          {wallet.phase === "connecting" ? "连接中…" : "连接钱包"}
        </button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="metric-value is-accent" style={{ fontSize: 40, letterSpacing: "-0.01em" }}>
        {wallet.phase === "reading" || wallet.usdc === null ? "—" : formatAmount(wallet.usdc)}
        <span className="metric-unit">USDC</span>
      </div>
      <ConfLine
        k="address"
        v={wallet.address}
      />
      <ConfLine
        k="mon"
        v={wallet.mon === null ? "读取中" : `${wallet.mon.toFixed(4)} MON`}
      />
      <ConfLine
        k="chain"
        v={wallet.chainOk ? "Monad Testnet · 10143" : `当前链 ${wallet.chainId ?? "未知"}，需要 10143`}
        tone={wallet.chainOk ? "var(--green)" : "var(--amber)"}
      />
      {wallet.phase === "reading" && <ConfLine k="status" v="正在读取余额…" />}
      {wallet.phase === "switching" && <ConfLine k="status" v="正在切换网络…" tone="var(--amber)" />}
      {wallet.error && (
        <div className="notice" style={{ borderLeftColor: "var(--red)" }}>
          <IconAlert size={13} />
          <span>{wallet.error}</span>
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        {!wallet.chainOk && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void wallet.switchChain()}
          >
            <IconAlert size={13} />
            {wallet.phase === "switching" ? "切链中…" : "切到 Monad 测试网"}
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => void wallet.refresh()}
        >
          <IconWallet size={13} />
          {wallet.phase === "reading" ? "读取中…" : "刷新余额"}
        </button>
        <a
          className="btn btn-sm btn-ghost"
          href={`${EXPLORER}/address/${wallet.address}`}
          target="_blank"
          rel="noreferrer"
        >
          在浏览器查看
        </a>
      </div>
    </div>
  );
}

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
  const wallet = useWallet();
  const [agent, setAgent] = useState("");
  const [merchantHash, setMerchantHash] = useState("");
  const [maxPerTx, setMaxPerTx] = useState("5");
  const [maxPerWeek, setMaxPerWeek] = useState("50");
  const [days, setDays] = useState("30");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (wallet.address) setAgent((cur) => (cur ? cur : wallet.address!));
  }, [wallet.address]);

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
