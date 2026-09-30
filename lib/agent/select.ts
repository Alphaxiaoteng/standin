/**
 * 选择与仓位（PRD §三，纯函数）：
 * 1. 剔除：EV ≤ 0、超单笔上限、依赖源健康度 < 0.6、余额不足、任务类型被止损暂停；记录剔除原因作为「放弃理由」。
 * 2. 按 score 从高到低，在今日预算内依次选。
 * 3. 单笔仓位 = min(单笔上限, 今日预算 35%)；同一类型连亏 2 次，仓位减半。
 */

import type { ScoredOpportunity } from "./score";

export const BUDGET_FRACTION = 0.35;

export interface Candidate {
  id: string;
  kind: string;
  title: string;
  /** 单笔要花的成本（执行花费） */
  costUsdc: number;
  ev: number;
  score: number;
  sampleInsufficient: boolean;
  /** 依赖源健康度；任一 < 0.6 即剔除 */
  sourceHealth: Array<{ name: string; healthy: boolean; score: number }>;
}

export interface SelectOptions {
  /** 单笔仓位上限（USDC，人类单位） */
  perTradeCapUsdc: number;
  /** 今日剩余预算 */
  remainingBudgetUsdc: number;
  /** 钱包余额 */
  balanceUsdc: number;
  /** 被止损暂停的任务类型（连亏 3 单） */
  pausedKinds?: string[];
  /** 各类型当前连亏次数（≥2 → 仓位减半） */
  consecutiveLossesByKind?: Record<string, number>;
  /** 样本不足是否照常执行（PRD 只要求标记；默认照常） */
  allowInsufficientSamples?: boolean;
}

export interface SkipReason {
  id: string;
  title: string;
  reason: string;
}

export interface Selected {
  id: string;
  kind: string;
  title: string;
  /** 本单实际允许动用的仓位 */
  stakeUsdc: number;
  ev: number;
  score: number;
  sampleInsufficient: boolean;
  /** 仓位是否因连亏 2 次被减半 */
  stakeHalved: boolean;
}

export interface SelectResult {
  selected: Selected[];
  skipped: SkipReason[];
}

function minStake(opts: SelectOptions): number {
  return Math.min(opts.perTradeCapUsdc, opts.remainingBudgetUsdc * BUDGET_FRACTION);
}

function rejectionReasons(c: Candidate, opts: SelectOptions): string[] {
  const reasons: string[] = [];
  if (c.ev <= 0) reasons.push("EV ≤ 0");
  for (const s of c.sourceHealth) {
    if (!s.healthy || s.score < 0.6) reasons.push(`源健康度低于 0.6（${s.name}）`);
  }
  if (c.costUsdc > opts.perTradeCapUsdc) reasons.push("超出单笔上限");
  if (c.costUsdc > opts.balanceUsdc) reasons.push("余额不足");
  if ((opts.pausedKinds ?? []).includes(c.kind)) reasons.push("止损暂停该任务类型");
  if (opts.allowInsufficientSamples === false && c.sampleInsufficient) reasons.push("样本不足，暂不执行");
  return reasons;
}

/** 单个候选能否入选（含仓位判断）；用于卡片页单独预检 */
export function evaluateCandidate(c: Candidate, opts: SelectOptions): { allowed: boolean; reason: string | null } {
  const reasons = rejectionReasons(c, opts);
  if (reasons.length > 0) return { allowed: false, reason: reasons.join("；") };
  const lossStreak = (opts.consecutiveLossesByKind ?? {})[c.kind] ?? 0;
  let stake = minStake(opts);
  if (lossStreak >= 2) stake /= 2;
  if (stake <= 0) return { allowed: false, reason: "预算不足" };
  if (c.costUsdc > stake) return { allowed: false, reason: "仓位小于成本" };
  return { allowed: true, reason: null };
}

export function selectOpportunities(candidates: Candidate[], opts: SelectOptions): SelectResult {
  const skipped: SkipReason[] = [];
  const selected: Selected[] = [];
  let budgetLeft = opts.remainingBudgetUsdc;
  const lossesByKind = opts.consecutiveLossesByKind ?? {};

  // score 降序；EV ≤ 0 的自然排最后，但同样会被剔除理由拦下
  const ordered = [...candidates].sort((a, b) => b.score - a.score);

  for (const c of ordered) {
    const reasons = rejectionReasons(c, opts);
    if (reasons.length > 0) {
      skipped.push({ id: c.id, title: c.title, reason: reasons.join("；") });
      continue;
    }

    const lossStreak = lossesByKind[c.kind] ?? 0;
    const stakeHalved = lossStreak >= 2;
    let stake = minStake(opts);
    if (stakeHalved) stake /= 2;

    if (stake <= 0 || c.costUsdc > stake) {
      skipped.push({ id: c.id, title: c.title, reason: "仓位小于成本" });
      continue;
    }
    if (c.costUsdc > budgetLeft) {
      skipped.push({ id: c.id, title: c.title, reason: "预算不足" });
      continue;
    }

    budgetLeft = Math.round((budgetLeft - c.costUsdc) * 1e6) / 1e6;
    selected.push({
      id: c.id,
      kind: c.kind,
      title: c.title,
      stakeUsdc: Math.round(c.costUsdc * 10_000) / 10_000,
      ev: c.ev,
      score: c.score,
      sampleInsufficient: c.sampleInsufficient,
      stakeHalved,
    });
  }

  return { selected, skipped };
}

/* ------------------------------------------------------------------ */
/* 批量入口：对齐打分模块的决策卡输出（app/api/opportunities 消费）       */
/* ------------------------------------------------------------------ */

export interface GuardSnapshot {
  dailyBudgetUsdc: number;
  halt: boolean;
  pausedKinds: string[];
}

export interface SelectBatchContext {
  walletBalanceUsdc: number;
  guard: GuardSnapshot;
  perTradeCapUsdc: number;
  /** 今日已花（默认 0） */
  spentTodayUsdc?: number;
  /** 各类型连亏次数（≥2 → 仓位减半） */
  consecutiveLossesByKind?: Record<string, number>;
}

export function selectScoredOpportunities(
  scored: ScoredOpportunity[],
  ctx: SelectBatchContext,
): { selected: ScoredOpportunity[]; skipped: SkipReason[] } {
  const remaining = Math.max(0, ctx.guard.dailyBudgetUsdc - (ctx.spentTodayUsdc ?? 0));
  const result = selectOpportunities(
    scored.map((o) => ({
      id: o.id,
      kind: o.kind,
      title: o.title,
      costUsdc: o.costUsdc,
      ev: o.ev,
      score: o.score,
      sampleInsufficient: o.sampleInsufficient,
      sourceHealth: [],
    })),
    {
      perTradeCapUsdc: ctx.perTradeCapUsdc,
      remainingBudgetUsdc: remaining,
      balanceUsdc: ctx.walletBalanceUsdc,
      pausedKinds: ctx.guard.pausedKinds,
      consecutiveLossesByKind: ctx.consecutiveLossesByKind,
    },
  );
  const byId = new Map(scored.map((o) => [o.id, o] as const));
  return {
    selected: result.selected.map((s) => byId.get(s.id)).filter((o): o is ScoredOpportunity => !!o),
    skipped: result.skipped,
  };
}
