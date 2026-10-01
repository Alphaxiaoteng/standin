/**
 * 机会打分（PRD §三，纯函数，可解释）：
 * - 成功率 p：每种「任务类型 × 数据源组合」一个 Beta 后验，起始 α=β=1。
 * - 健康度 h：依赖源健康度的乘积（任一源挂都拖垮整单）。
 * - EV = p × h × 报酬 − 成本 − 风险惩罚。
 * - score = EV / 成本。
 * - 样本 < 5：p 取 0.5，标「样本不足」。
 */

import type { Bounty, BountyKind } from "../market/bounties";

export const MIN_SAMPLES = 5;
/** 风险惩罚：任务 B 依赖「价差真的越带」这种小概率事件，期望天然偏低 */
export const RISK_PENALTY_USDC = { data_brief: 0.02, spread_watch: 0.05 } as const;

export interface BetaPosterior {
  alpha: number;
  beta: number;
}

export interface SourceHealthInput {
  name: string;
  score: number;
  healthy: boolean;
}

export interface ScoreInput {
  kind: BountyKind;
  rewardUsdc: number;
  costUsdc: number;
  /** 该任务依赖的数据源健康度 */
  sourceHealth: SourceHealthInput[];
  /** 「任务类型 × 源组合」的历史成败 */
  posterior: BetaPosterior;
  samples?: number;
}

export interface ScoreResult {
  /** Beta 后验均值；样本不足时固定 0.5 */
  p: number;
  /** 成功把握所依据的历史样本数（T8 界面展示用） */
  samples: number;
  /** 依赖源健康度乘积 */
  h: number;
  /** 期望净收益 = p·h·报酬 − 成本 − 风险惩罚 */
  ev: number;
  /** 排序分 = EV / 成本；成本为 0 时记 Infinity（免费的机会排最前） */
  score: number;
  sampleInsufficient: boolean;
  risk: "low" | "medium";
}

/** 批量打分输出（app/api/opportunities 的卡片形状） */
export interface ScoredOpportunity extends ScoreResult {
  id: string;
  kind: BountyKind;
  bountyId: string;
  source: "bounty" | "builtin";
  buyer: string;
  buyerType: "demo" | "third_party";
  title: string;
  description: string;
  rewardUsdc: number;
  costUsdc: number;
  estNetUsdc: number;
  windowSec: number;
  toleranceBps: number | null;
  slots: number;
}

export type HealthSnapshot = Record<string, { score: number; healthy: boolean }>;

/** 冷启动：α=β=1 → p=0.5，且样本不足 */
export function coldStartPosterior(): BetaPosterior {
  return { alpha: 1, beta: 1 };
}

/** Beta 后验观测一次成败（α=β=1 起始），不修改入参 */
export function observe(post: BetaPosterior, success: boolean): BetaPosterior {
  return success ? { alpha: post.alpha + 1, beta: post.beta } : { alpha: post.alpha, beta: post.beta + 1 };
}

function betaMean(post: BetaPosterior): number {
  const denom = post.alpha + post.beta;
  return denom > 0 ? post.alpha / denom : 0.5;
}

function healthProduct(sources: SourceHealthInput[]): number {
  let h = 1;
  for (const s of sources) h *= Math.max(0, Math.min(1, s.score));
  return Math.round(h * 10_000) / 10_000;
}

/** 供 discover 步骤用：一种任务类型依赖哪些数据源 */
export function sourcesForKind(kind: BountyKind): string[] {
  return kind === "data_brief" ? ["coingecko", "coinbase", "hn"] : ["coingecko", "coinbase"];
}

export function bountySourceHealth(bounty: Pick<Bounty, "kind">, healthOf: (name: string) => SourceHealthInput): SourceHealthInput[] {
  return sourcesForKind(bounty.kind).map(healthOf);
}

export function scoreOpportunity(input: ScoreInput): ScoreResult {
  const samples = input.samples ?? (input.posterior.alpha + input.posterior.beta - 2);
  const sampleInsufficient = samples < MIN_SAMPLES;
  const p = sampleInsufficient ? 0.5 : betaMean(input.posterior);
  const h = healthProduct(input.sourceHealth);
  const risk: "low" | "medium" = input.kind === "spread_watch" ? "medium" : "low";
  const ev = p * h * input.rewardUsdc - input.costUsdc - RISK_PENALTY_USDC[input.kind];
  const score = input.costUsdc > 0 ? ev / input.costUsdc : Number.POSITIVE_INFINITY;
  const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
  return {
    p: r4(p),
    samples: Math.max(0, Math.floor(samples)),
    h: r4(h),
    ev: r4(ev),
    score: Number.isFinite(score) ? r4(score) : score,
    sampleInsufficient,
    risk,
  };
}

export interface ScoreBatchContext {
  /** 源名 → 健康度快照（getSourceHealth().sources） */
  health: HealthSnapshot;
  /** 后验端口；缺省一律冷启动（p=0.5、样本不足） */
  posteriorFor?: (kind: BountyKind) => BetaPosterior;
  samplesFor?: (kind: BountyKind) => number;
}

function healthFromSnapshot(kind: BountyKind, snapshot: HealthSnapshot): SourceHealthInput[] {
  return sourcesForKind(kind).map((name) => ({
    name,
    score: snapshot[name]?.score ?? 1,
    healthy: snapshot[name]?.healthy ?? true,
  }));
}

/** 批量打分：悬赏列表 → 决策卡（score 降序） */
export function scoreOpportunities(bounties: Bounty[], ctx: ScoreBatchContext): ScoredOpportunity[] {
  const scored = bounties.map((b) => {
    const result = scoreOpportunity({
      kind: b.kind,
      rewardUsdc: b.rewardUsdc,
      costUsdc: b.costUsdc,
      sourceHealth: healthFromSnapshot(b.kind, ctx.health),
      posterior: ctx.posteriorFor?.(b.kind) ?? coldStartPosterior(),
      samples: ctx.samplesFor?.(b.kind),
    });
    return {
      ...result,
      id: b.id,
      kind: b.kind,
      bountyId: b.id,
      source: "bounty" as const,
      buyer: b.buyer,
      buyerType: b.buyerType,
      title: b.title,
      description: b.description,
      rewardUsdc: b.rewardUsdc,
      costUsdc: b.costUsdc,
      estNetUsdc: result.ev,
      windowSec: b.windowSec,
      toleranceBps: b.toleranceBps,
      slots: 1,
    };
  });
  return scored.sort((a, b) => b.score - a.score);
}
