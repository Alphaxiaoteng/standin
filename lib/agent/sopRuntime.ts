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
import { initialGuardState, type GuardState } from "./guard";
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
  fetchHnTop,
} from "../market/sources";
import { getStats, recordSpend } from "../store";
import { settle } from "../ledger";
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

function runtime(): SopRuntime {
  globalForSop.__standinSopRuntime ??= {
    guard: initialGuardState(DAILY_BUDGET_USDC),
    store: emptyPosteriorStore(),
    posterior: memoryPosteriorPort(),
  };
  return globalForSop.__standinSopRuntime;
}

/* ------------------------------------------------------------------ */
/* Executor：真实数据源抓取 + 健康度回写                                */
/* ------------------------------------------------------------------ */

async function fetchQuote(
  coin: "btc" | "eth",
): Promise<{ coingecko?: { usd: number; fetchedAt: number }; coinbase?: { usd: number; fetchedAt: number } }> {
  const out: { coingecko?: { usd: number; fetchedAt: number }; coinbase?: { usd: number; fetchedAt: number } } = {};

  const cg = await fetchCoingeckoPrices();
  if (cg.ok) {
    recordSuccess("coingecko", cg.latencyMs);
    const usd = coin === "btc" ? cg.value.btcUsd : cg.value.ethUsd;
    out.coingecko = { usd, fetchedAt: cg.fetchedAt };
  } else {
    recordFailure("coingecko", cg.error, cg.latencyMs);
  }

  const cb = await fetchCoinbaseSpot(coin === "btc" ? "BTC-USD" : "ETH-USD");
  if (cb.ok) {
    recordSuccess("coinbase", cb.latencyMs);
    out.coinbase = { usd: cb.value.usd, fetchedAt: cb.fetchedAt };
  } else {
    recordFailure("coinbase", cb.error, cb.latencyMs);
  }

  return out;
}

const executor = {
  async execute(kind: BountyKind, opts: { windowSec: number; toleranceBps: number | null }) {
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
        btc: { coingecko: btc.coingecko, coinbase: btc.coinbase },
        eth: { coingecko: eth.coingecko, coinbase: eth.coinbase },
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
        if (bps > (opts.toleranceBps ?? 50) && notifiedAt === null) notifiedAt = Date.now();
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
        recordSpend(-amount);
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
  return runSopTick(body, buildDeps(rt));
}

export function guardRef(): GuardState {
  return runtime().guard;
}
