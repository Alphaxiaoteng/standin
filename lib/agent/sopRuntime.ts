/**
 * SOP 运行时装配：把 runSopTick 的端口接到真实模块上。
 *
 *   BountiesPort  → lib/market/bounties（开放悬赏）
 *   HealthPort    → lib/market/health（真实滑动窗口健康度）
 *   WalletPort    → lib/ledger（本地账本余额 / recordSpend）
 *   LedgerPort    → lib/ledger.settle（写失败抛错 → sop 走回滚停机分支）
 *   ExecutorPort  → lib/market/sources（CoinGecko/Coinbase/HN 真实抓取，
 *                    并把每次调用回写健康度）
 *   PosteriorPort → sop 自带 memoryPosteriorPort（挂在 globalThis 防 HMR 重复）
 *   GuardState    → globalThis 单例（止损状态跨请求保持）
 *
 * 演示配置：单笔上限 5 USDC、每日预算 10 USDC（界面上写明可调）。
 */

import {
  runSopTick,
  memoryPosteriorPort,
  emptyPosteriorStore,
  type SopDeps,
  type SopTickRequest,
  type SopTickResult,
  type ScorePosteriorPort,
} from "./sop";
import type { BetaPosterior } from "./score";
import { initialGuardState, resetDaily, type GuardState } from "./guard";
import { listBounties, type Bounty, type BountyKind } from "../market/bounties";
import {
  sourceHealth,
  recordSuccess,
  recordFailure,
  DATA_SOURCES,
} from "../market/health";
import {
  fetchCoingeckoPrices,
  fetchCoinbaseSpot,
  fetchKrakenSpot,
  fetchHnTop,
} from "../market/sources";
import { getStats, recordSpend } from "../store";
import { settle, getLedger, toDateKey, creditBalance } from "../ledger";
import { pollPendingSettlements } from "../chain/settlementWatcher";
import { emitNotice, latestNoticeFor } from "./notify";
import type { BriefSnapshot, SpreadSample } from "./verify";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const PER_TRADE_CAP_USDC = 5;
export const DAILY_BUDGET_USDC = 10;

interface SopRuntime {
  guard: GuardState;
  posterior: ScorePosteriorPort;
  store: Map<BountyKind, { alpha: number; beta: number }>;
}

const globalForSop = globalThis as unknown as { __standinSopRuntime?: SopRuntime };

/* ------------------------------------------------------------------ */
/* 止损与后验持久化（T4）：账本 KV 是唯一事实源，重启不丢                  */
/* ------------------------------------------------------------------ */

export interface KvLike {
  getKv<T = unknown>(key: string): T | undefined;
  setKv<T = unknown>(key: string, value: T): void;
}

const GUARD_KV_KEY = "agent:guard";
const POSTERIOR_KV_KEY = "agent:posterior";

interface PosteriorKvFile {
  kinds: Array<{ kind: BountyKind; alpha: number; beta: number }>;
}

function isPlausibleGuard(v: unknown): v is GuardState {
  if (typeof v !== "object" || v === null) return false;
  const g = v as GuardState;
  return (
    typeof g.dateKey === "string"
    && Number.isFinite(g.dailyBudgetUsdc)
    && Number.isFinite(g.spentTodayUsdc)
    && typeof g.halt === "boolean"
    && Array.isArray(g.pausedKinds)
    && typeof g.consecutiveLossesByKind === "object"
  );
}

/** 启动恢复：KV 里有止损状态就用它；跨天自动重置当日预算与亏损 */
export function restoreGuardFromKv(kv: KvLike, now: number = Date.now(), dailyBudgetUsdc = DAILY_BUDGET_USDC): GuardState {
  const stored = kv.getKv<GuardState>(GUARD_KV_KEY);
  if (!isPlausibleGuard(stored)) {
    return initialGuardState(dailyBudgetUsdc, now);
  }
  return stored.dateKey === toDateKey(now) ? stored : resetDaily(stored, now);
}

/** 启动恢复：后验计数（每个任务类型的 Beta α/β） */
export function restorePosteriorFromKv(kv: KvLike): Map<BountyKind, BetaPosterior> {
  const store = emptyPosteriorStore();
  const rec = kv.getKv<PosteriorKvFile>(POSTERIOR_KV_KEY);
  if (rec && Array.isArray(rec.kinds)) {
    for (const e of rec.kinds) {
      if (e && typeof e.kind === "string" && Number.isFinite(e.alpha) && Number.isFinite(e.beta)) {
        store.set(e.kind, { alpha: e.alpha, beta: e.beta });
      }
    }
  }
  return store;
}

export function persistSopStateToKv(
  kv: KvLike,
  guard: GuardState,
  store: Map<BountyKind, BetaPosterior>,
): void {
  const kinds: PosteriorKvFile["kinds"] = [];
  store.forEach((v, k) => kinds.push({ kind: k, alpha: v.alpha, beta: v.beta }));
  kv.setKv(POSTERIOR_KV_KEY, { kinds } satisfies PosteriorKvFile);
  kv.setKv(GUARD_KV_KEY, guard);
}

/** 每次 tick 结束后写回；写失败 → 沿用账本回滚语义：停机并禁止继续花钱 */
export function persistAfterTick(
  kv: KvLike & { setHalted(halted: boolean, reason?: string | null): void },
  state: { guard: GuardState; store: Map<BountyKind, BetaPosterior> },
  result: SopTickResult,
): void {
  try {
    persistSopStateToKv(kv, state.guard, state.store);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      kv.setHalted(true, `状态持久化失败，已停机：${msg}`);
    } catch {
      // 二次写失败静默（与账本回滚存盘语义一致）
    }
    result.steps.push({ step: "复盘", status: "fail", note: `状态持久化失败，已停机：${msg}` });
  }
}

function runtime(): SopRuntime {
  globalForSop.__standinSopRuntime ??= (() => {
    const ledger = getLedger();
    // 启动时从账本 KV 恢复，重启服务后止损与后验不丢
    const store = restorePosteriorFromKv(ledger);
    return {
      guard: restoreGuardFromKv(ledger),
      store,
      posterior: memoryPosteriorPort(store),
    };
  })();
  return globalForSop.__standinSopRuntime;
}

/* ------------------------------------------------------------------ */
/* Executor：真实数据源抓取 + 健康度回写                                */
/* ------------------------------------------------------------------ */

async function fetchQuote(
  coin: "btc" | "eth",
): Promise<{
  coingecko?: { usd: number; fetchedAt: number };
  coinbase?: { usd: number; fetchedAt: number };
  kraken?: { usd: number; fetchedAt: number };
}> {
  const out: {
    coingecko?: { usd: number; fetchedAt: number };
    coinbase?: { usd: number; fetchedAt: number };
    kraken?: { usd: number; fetchedAt: number };
  } = {};

  const cg = await fetchCoingeckoPrices();
  if (cg.ok) {
    recordSuccess("coingecko", cg.latencyMs);
    const usd = coin === "btc" ? cg.value.btcUsd : cg.value.ethUsd;
    out.coingecko = { usd, fetchedAt: cg.fetchedAt };
  } else {
    recordFailure("coingecko", cg.error, cg.latencyMs);
  }

  const pair = coin === "btc" ? "BTC-USD" : "ETH-USD";
  const cb = await fetchCoinbaseSpot(pair);
  if (cb.ok) {
    recordSuccess("coinbase", cb.latencyMs);
    out.coinbase = { usd: cb.value.usd, fetchedAt: cb.fetchedAt };
  } else {
    recordFailure("coinbase", cb.error, cb.latencyMs);
  }

  // 第三方交叉校验源：失败只降级（验收回退两源规则），不中断执行
  const kr = await fetchKrakenSpot(pair);
  if (kr.ok) {
    recordSuccess("kraken", kr.latencyMs);
    out.kraken = { usd: kr.value.usd, fetchedAt: kr.fetchedAt };
  } else {
    recordFailure("kraken", kr.error, kr.latencyMs);
  }

  return out;
}

const executor = {
  async execute(kind: BountyKind, opts: { bountyId?: string; windowSec: number; toleranceBps: number | null }) {
    if (kind === "data_brief") {
      const [btc, eth, hn] = await Promise.all([
        fetchQuote("btc"),
        fetchQuote("eth"),
        (async () => {
          const r = await fetchHnTop();
          if (r.ok) {
            recordSuccess("hn", r.latencyMs);
            return { titles: r.value.titles, fetchedAt: r.fetchedAt };
          }
          recordFailure("hn", r.error, r.latencyMs);
          return null;
        })(),
      ]);
      if (!btc.coingecko || !btc.coinbase || !eth.coingecko || !eth.coinbase || !hn) {
        return { ok: false as const, error: "数据源失败（见健康度面板）" };
      }
      const snapshot: BriefSnapshot = {
        btc: { coingecko: btc.coingecko, coinbase: btc.coinbase, kraken: btc.kraken },
        eth: { coingecko: eth.coingecko, coinbase: eth.coinbase, kraken: eth.kraken },
        headlines: hn.titles,
        // 榜单不由执行阶段提供：验收阶段独立回查后再填入，杜绝"自己验证自己"
        hnBoard: [],
      };
      return { ok: true as const, snapshot };
    }

    // spread_watch：在窗口内真实采样两源 BTC 价差
    const samples: SpreadSample[] = [];
    const windowMs = Math.min(opts.windowSec, 30) * 1_000;
    const started = Date.now();
    let notifiedAt: number | null = null;
    while (Date.now() - started < windowMs && samples.length < 6) {
      const btc = await fetchQuote("btc");
      if (btc.coingecko && btc.coinbase) {
        const mid = (btc.coingecko.usd + btc.coinbase.usd) / 2;
        const bps = mid > 0 ? (Math.abs(btc.coingecko.usd - btc.coinbase.usd) / mid) * 10_000 : Infinity;
        samples.push({ spreadBps: Math.round(bps * 100) / 100, at: Date.now() });
        // 通知走独立通道（notices.json），时间戳以写入时刻为准；写失败不视为已通知
        if (bps > (opts.toleranceBps ?? 50) && notifiedAt === null && opts.bountyId) {
          try {
            const n = await emitNotice(opts.bountyId, {
              spreadBps: Math.round(bps * 100) / 100,
              toleranceBps: opts.toleranceBps ?? 50,
              sampledAt: Date.now(),
            });
            notifiedAt = n.at;
          } catch {
            // 通知写失败：保持 null，验收将如实判"未按时通知"
          }
        }
      }
      if (samples.length < 6) {
        await delay(Math.max(2_000, Math.floor(windowMs / 6)));
      }
    }
    return { ok: true as const, samples, notifiedAt };
  },
};

/* ------------------------------------------------------------------ */
/* 端口装配                                                            */
/* ------------------------------------------------------------------ */

function buildDeps(rt: SopRuntime): SopDeps {
  return {
    bounties: {
      listOpen: () => listBounties().filter((b: Bounty) => b.status === "open"),
    },
    health: {
      healthOf(name) {
        const h = sourceHealth(name);
        return { name, score: h.score, healthy: h.healthy };
      },
      allUnhealthy() {
        return DATA_SOURCES.every((n) => !sourceHealth(n).healthy);
      },
    },
    wallet: {
      balanceUsdc: () => getStats().walletBalance,
      debit(amount) {
        const before = getStats().walletBalance;
        if (before < amount) return null;
        recordSpend(amount);
        return getStats().walletBalance;
      },
      credit(amount) {
        creditBalance(amount);
        return getStats().walletBalance;
      },
    },
    ledger: {
      settle(entry) {
        settle(entry);
      },
    },
    posterior: rt.posterior,
    executor,
    boardRecheck: {
      // 验收阶段独立回查：榜单取前 30 条，与执行阶段抓取相互独立
      async recheck() {
        // 抓 30 条榜单，交付热点仍取前 5 条；与执行阶段抓取相互独立
        const r = await fetchHnTop(30);
        if (!r.ok) {
          recordFailure("hn", `独立回查失败：${r.error}`, r.latencyMs);
          return null;
        }
        recordSuccess("hn", r.latencyMs);
        return { board: r.value.board, fetchedAt: r.fetchedAt };
      },
    },
    notices: {
      // 验收只认通知存储里的时间戳（漏洞 B：执行器自带 notifiedAt 不再作为证据）
      latestFor(bountyId) {
        const n = latestNoticeFor(bountyId);
        return n ? { at: n.at } : null;
      },
    },
    guard: rt.guard,
  };
}

/** 跑一单：给 API route 的唯一入口 */
export async function tick(req: { kind?: BountyKind; bountyId?: string }): Promise<SopTickResult> {
  const rt = runtime();
  const body: SopTickRequest = {
    kind: req.kind,
    bountyId: req.bountyId,
    perTradeCapUsdc: PER_TRADE_CAP_USDC,
    dailyBudgetUsdc: DAILY_BUDGET_USDC,
  };
  const result = await runSopTick(body, buildDeps(rt));
  // 第三方悬赏：轮询链上付款；确认的收入同步进 guard 今日收入。
  // 查询失败保持 pending，不影响 tick 结果。
  try {
    await pollPendingSettlements(Date.now(), {
      onConfirmed: (_b, rev) => {
        rt.guard.revenueTodayUsdc = Math.round((rt.guard.revenueTodayUsdc + rev) * 1e6) / 1e6;
      },
    });
  } catch {
    // 链上查询异常：pending 保持 pending
  }
  // 每次 tick 结束后写回止损与后验；写失败 → 停机
  persistAfterTick(getLedger(), rt, result);
  return result;
}

export function guardRef(): GuardState {
  return runtime().guard;
}
