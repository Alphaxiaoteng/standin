/**
 * 止损与降级（PRD §三，纯函数状态机；「在 Agent 之外强制」——Agent 每步都要问它）。
 * 触发表：
 * - 当日净亏损 ≥ 今日预算 30% → 停手到次日（halt），要打断用户。
 * - 连亏 3 单 → 暂停该任务类型（进日报，不打断）。
 * - 数据源健康度 < 0.6 → 不接依赖该源的任务（在 select 剔除，这里只暴露阈值语义）。
 * - 单笔超上限 → 直接拒绝（rejectTrade），不打断。
 */

export const DAILY_LOSS_HALT_FRACTION = 0.3;
export const CONSECUTIVE_LOSS_PAUSE = 3;
export const CONSECUTIVE_LOSS_HALF_STAKE = 2;

export type TradeStatus = "passed" | "failed";

export interface GuardState {
  /** 今日预算（人类单位 USDC） */
  dailyBudgetUsdc: number;
  spentTodayUsdc: number;
  revenueTodayUsdc: number;
  costTodayUsdc: number;
  halt: boolean;
  haltReason: string | null;
  /** 全局连亏（跨类型，用于演示「止损真的触发一次」） */
  consecutiveLosses: number;
  /** 各任务类型连亏计数 */
  consecutiveLossesByKind: Record<string, number>;
  /** 连亏 3 单被暂停的任务类型 */
  pausedKinds: string[];
  /** 触发停手时刻（Unix ms），次日 resetDaily 后清空 */
  haltedAt: number | null;
  dateKey: string;
}

export interface TradeRecord {
  kind: string;
  status: TradeStatus;
  /** 成本（人类单位） */
  costUsdc: number;
  /** 收入（人类单位，失败单为 0） */
  revenueUsdc: number;
  at?: number;
}

export interface GuardStatus {
  dailyBudgetUsdc: number;
  spentTodayUsdc: number;
  todayNetUsdc: number;
  halt: boolean;
  haltReason: string | null;
  consecutiveLosses: number;
  pausedKinds: string[];
}

function dateKeyOf(at: number): string {
  const d = new Date(at);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function initialGuardState(dailyBudgetUsdc: number, at = Date.now()): GuardState {
  return {
    dailyBudgetUsdc,
    spentTodayUsdc: 0,
    revenueTodayUsdc: 0,
    costTodayUsdc: 0,
    halt: false,
    haltReason: null,
    consecutiveLosses: 0,
    consecutiveLossesByKind: {},
    pausedKinds: [],
    haltedAt: null,
    dateKey: dateKeyOf(at),
  };
}

/** 纯函数版本：结算一单，返回新状态（不修改入参） */
export function settleTrade(state: GuardState, trade: TradeRecord): GuardState {
  const at = trade.at ?? Date.now();
  let next: GuardState = { ...state, consecutiveLossesByKind: { ...state.consecutiveLossesByKind }, pausedKinds: [...state.pausedKinds] };

  if (dateKeyOf(at) !== next.dateKey) {
    next = resetDaily(next, at);
  }

  next.costTodayUsdc = Math.round((next.costTodayUsdc + trade.costUsdc) * 1e6) / 1e6;
  next.revenueTodayUsdc = Math.round((next.revenueTodayUsdc + trade.revenueUsdc) * 1e6) / 1e6;
  next.spentTodayUsdc = next.costTodayUsdc;

  const kindStreak = (next.consecutiveLossesByKind[trade.kind] ?? 0);
  if (trade.status === "failed") {
    next.consecutiveLosses += 1;
    next.consecutiveLossesByKind[trade.kind] = kindStreak + 1;
    if (next.consecutiveLossesByKind[trade.kind] >= CONSECUTIVE_LOSS_PAUSE && !next.pausedKinds.includes(trade.kind)) {
      next.pausedKinds.push(trade.kind);
    }
  } else {
    next.consecutiveLosses = 0;
    next.consecutiveLossesByKind[trade.kind] = 0;
  }

  const net = next.revenueTodayUsdc - next.costTodayUsdc;
  if (!next.halt && -net >= next.dailyBudgetUsdc * DAILY_LOSS_HALT_FRACTION) {
    next.halt = true;
    next.haltedAt = at;
    next.haltReason = `今日已停手，避免继续亏损 ${Math.round(-net * 100) / 100}`;
  }
  return next;
}

/** 次日：读昨日净利后重置预算与日内计数；暂停的任务类型需要人工/日报解除 */
export function resetDaily(state: GuardState, at = Date.now(), newBudgetUsdc = state.dailyBudgetUsdc): GuardState {
  return {
    ...state,
    dailyBudgetUsdc: newBudgetUsdc,
    spentTodayUsdc: 0,
    revenueTodayUsdc: 0,
    costTodayUsdc: 0,
    halt: false,
    haltReason: null,
    consecutiveLosses: 0,
    consecutiveLossesByKind: {},
    haltedAt: null,
    dateKey: dateKeyOf(at),
    pausedKinds: [],
  };
}

/** 单笔超上限：直接拒绝，不打断（Agent 在出价前先问这个） */
export function rejectIfOverCap(state: GuardState, costUsdc: number, perTradeCapUsdc: number): { allowed: boolean; reason: string | null } {
  if (costUsdc > perTradeCapUsdc) return { allowed: false, reason: "超出单笔上限" };
  if (state.halt) return { allowed: false, reason: state.haltReason ?? "今日已停手" };
  if (state.pausedKinds.length > 0) return { allowed: false, reason: "该任务类型因连亏暂停" };
  return { allowed: true, reason: null };
}

/** 是否允许继续做某类型：停手/类型暂停时 false */
export function canTrade(state: GuardState, kind: string): boolean {
  if (state.halt) return false;
  return !state.pausedKinds.includes(kind);
}

/** UI 聚合视图（主页 + 机会页展示） */
export function guardStatusOf(state: GuardState): GuardStatus {
  const todayNet = Math.round((state.revenueTodayUsdc - state.costTodayUsdc) * 1e6) / 1e6;
  return {
    dailyBudgetUsdc: state.dailyBudgetUsdc,
    spentTodayUsdc: state.spentTodayUsdc,
    todayNetUsdc: todayNet,
    halt: state.halt,
    haltReason: state.haltReason,
    consecutiveLosses: state.consecutiveLosses,
    pausedKinds: [...state.pausedKinds],
  };
}
