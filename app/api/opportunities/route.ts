/**
 * 机会与决策 API。
 *
 * PRD §六：去掉静态列表，机会 = 悬赏（lib/market/bounties.ts）× 打分
 * （lib/agent/score.ts）× 选择（lib/agent/select.ts），配合数据源健康度与
 * 止损状态（lib/agent/guard.ts）。这些模块由 CoreAlgorithms 维护。
 *
 * 返回：
 *   opportunities: 通过筛选的候选（含可解释打分字段）
 *   skipped:       被剔除的机会 + 放弃理由（EV≤0、源不健康、超上限、余额不足等）
 *   guard:         今日预算/止损状态
 *   health:        数据源健康度
 */

import { NextResponse } from "next/server";
import { ensureSeedBounties } from "@/lib/market/bounties";
import { scoreOpportunities, sourcesForKind, type SourceHealthInput } from "@/lib/agent/score";
import { selectOpportunities, type Candidate } from "@/lib/agent/select";
import { guardStatusOf, initialGuardState, type GuardState } from "@/lib/agent/guard";
import { allSourceHealth } from "@/lib/market/health";
import { getStats } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 演示配置：单笔上限 5 USDC、每日预算 10 USDC（界面上写明可调） */
const PER_TRADE_CAP_USDC = 5;
const DAILY_BUDGET_USDC = 10;

/** dev 模块重复求值时保证 guard 单例 */
const g = globalThis as unknown as { __standinOpportGuard?: GuardState };
const guardState = (g.__standinOpportGuard ??= initialGuardState(DAILY_BUDGET_USDC));

export async function GET() {
  const stats = getStats();
  const walletBalanceUsdc = stats.walletBalance;
  const guard = guardStatusOf(guardState);

  const healthList = allSourceHealth();
  const healthMap: Record<string, SourceHealthInput> = {};
  for (const h of healthList) healthMap[h.name] = { name: h.name, score: h.score, healthy: h.healthy };
  const health = { sources: healthMap };

  // 已停手或该类任务被暂停时，不再给出可执行机会，只给理由
  const bounties = ensureSeedBounties().filter((b) => b.status === "open");
  const scored = scoreOpportunities(bounties, { health: healthMap });
  const candidates: Candidate[] = scored.map((o) => ({
    id: o.id,
    kind: o.kind,
    title: o.title,
    costUsdc: o.costUsdc,
    ev: o.ev,
    score: o.score,
    sampleInsufficient: o.sampleInsufficient,
    sourceHealth: sourcesForKind(o.kind).map(
      (name) => healthMap[name] ?? { name, score: 0, healthy: false },
    ),
  }));
  const { selected, skipped } = selectOpportunities(candidates, {
    perTradeCapUsdc: PER_TRADE_CAP_USDC,
    remainingBudgetUsdc: Math.max(0, DAILY_BUDGET_USDC - guard.spentTodayUsdc),
    balanceUsdc: walletBalanceUsdc,
    pausedKinds: guard.pausedKinds,
    consecutiveLossesByKind: guardState.consecutiveLossesByKind,
  });

  // 选中卡片携带完整打分字段供决策卡展示
  const selectedCards = scored.filter((o) => selected.some((s) => s.id === o.id));

  return NextResponse.json({
    opportunities: selectedCards,
    skipped,
    guard,
    health,
    walletBalanceUsdc,
    config: { perTradeCapUsdc: PER_TRADE_CAP_USDC, dailyBudgetUsdc: DAILY_BUDGET_USDC },
  });
}
