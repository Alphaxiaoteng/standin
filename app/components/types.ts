/**
 * 前端与后端 /api/* 之间的数据契约，字段对齐 lib/store.ts 的真实结构。
 * 所有请求失败时前端降级为空态，不抛出到渲染层。
 */

export interface Stats {
  /** 今日已放行支出（USDC） */
  todaySpent: number;
  /** 累计拦截次数 */
  interceptCount: number;
  /** 本地账本余额（USDC，非链上金库） */
  walletBalance: number;
}

export interface Policy {
  id: string;
  agent: string;
  merchantHash: string;
  /** 单笔上限（USDC） */
  maxPerTx: number;
  /** 每周上限（USDC） */
  maxPerWeek: number;
  /** 过期时间（Unix 毫秒） */
  expires: number;
  /** 撤销后为 false */
  active: boolean;
}

export interface Transaction {
  id: string;
  /** Unix 毫秒 */
  ts: number;
  to: string;
  /** USDC 金额（人类单位） */
  amount: number;
  token: string;
  status: string;
  txHash: string;
  reportHash: string;
}

export interface Intercept {
  id: string;
  /** Unix 毫秒 */
  ts: number;
  taskId: string;
  /** 剧本标识：allowed / phishing / infinite */
  scenario: string;
  reason: string;
  declaredTo: string;
  actualTo: string;
  reportHash: string;
  /** 若放行将损失（USDC）；无法量化时为 null */
  avoidedLossUsdc?: number | null;
}

/** 彩排一侧的意图 / calldata（bigint 已序列化为字符串） */
export interface RehearsalSide {
  action: "transfer" | "approve";
  token: string;
  to: string;
  /** 最小单位原始值 */
  amount: string;
  /** 人类可读 USDC；无限授权等超范围值为 null */
  amountUsdc: number | null;
  memo?: string;
}

export interface Rehearsal {
  id: string;
  ts: number;
  taskId: string;
  description: string;
  declaredIntent: RehearsalSide;
  actualCalldata: RehearsalSide;
  allowed: boolean;
  reasons: string[];
  reportHash: string;
}

/** POST /api/agent/run 返回的 summary */
export interface TaskOutcome {
  taskId: string;
  description: string;
  rehearsal: { allowed: boolean; reasons: string[] };
  status: string;
  reason?: string;
  reportHash?: string;
}

export interface AgentRunOutcome {
  ok: boolean;
  error?: string;
  result: TaskOutcome | null;
  rehearsalId?: string;
  transactionId?: string | null;
  interceptId?: string | null;
}

export type ScenarioKey = "allowed" | "phishing" | "infinite";

export interface EarningsToday {
  totalRevenueUsdc: number;
  totalCostUsdc: number;
  netUsdc: number;
}

/** 悬赏任务类型（与 lib/market/bounties.ts 的 BountyKind 一致） */
export type BountyKind = "data_brief" | "spread_watch";

/** GET /api/opportunities 里入选机会的精简视图（主页「能赚的机会」卡片用） */
export interface Opportunity {
  id: string;
  kind: BountyKind;
  bountyId?: string;
  title: string;
  description: string;
  estNetUsdc: number;
  costUsdc: number;
  risk: string;
}

/** GET /api/intercepts 返回的 protection 汇总（本金保护页顶部） */
export interface Protection {
  /** 累计避免损失（仅可量化部分合计） */
  totalAvoidedLossUsdc: number;
  interceptCount: number;
  /** 能推导出金额的拦截数 */
  knownCount: number;
  /** 无法推导出金额的拦截数 */
  unknownCount: number;
}

/** 悬赏（GET/POST /api/bounties） */
export interface Bounty {
  id: string;
  kind: "data_brief" | "spread_watch";
  title: string;
  description: string;
  /** 打赏报酬（USDC，人类单位） */
  rewardUsdc: number;
  /** Agent 执行成本（USDC） */
  costUsdc: number;
  /** 任务 A 新鲜度窗口 / 任务 B 监测窗口（秒） */
  windowSec: number;
  /** 任务 B 价差容忍带（基点） */
  toleranceBps: number | null;
  status: "open" | "claimed" | "done" | "failed" | "cancelled";
  /** 买方名称 */
  buyer: string;
  /** demo = 内置演示买方；third_party = 第三方发布 */
  buyerType: "demo" | "third_party";
  createdAt: number;
  expiresAt: number;
}

/** 统一的请求结果，便于页面展示后端返回的校验错误 */
export interface ApiResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
}

/** 机会决策看板（GET /api/opportunities） */
export interface OpportunityDecision {
  id: string;
  kind: "data_brief" | "spread_watch";
  bountyId?: string;
  source: "bounty" | "builtin";
  buyer: string;
  buyerType: "demo" | "third_party";
  title: string;
  description: string;
  rewardUsdc: number;
  costUsdc: number;
  estNetUsdc: number;
  ev: number;
  score: number;
  p: number;
  h: number;
  sampleInsufficient: boolean;
  risk: "low" | "medium";
  windowSec: number;
  toleranceBps: number | null;
  slots: number;
}

export interface SkipItem {
  id: string;
  title?: string;
  reason: string;
}

export interface GuardView {
  dailyBudgetUsdc: number;
  spentTodayUsdc: number;
  todayNetUsdc: number;
  halt: boolean;
  haltReason: string | null;
  consecutiveLosses: number;
  pausedKinds: string[];
}

export interface OpportunityBoard {
  opportunities: OpportunityDecision[];
  skipped: SkipItem[];
  guard: GuardView;
  walletBalanceUsdc: number;
  config: { perTradeCapUsdc: number; dailyBudgetUsdc: number };
}

export interface SopStepView {
  step: string;
  status: "ok" | "fail" | "skip";
  note: string;
}

export interface SopRunOutcome {
  ok: boolean;
  task: {
    id: string;
    kind: string;
    bountyId?: string;
    label: string;
    status: "passed" | "failed" | "skipped" | "intercepted";
    costUsdc: number;
    revenueUsdc: number;
    netUsdc: number;
    failReason?: string;
    walletBalanceUsdc: number;
  };
  decision: { p: number; h: number; ev: number; score: number };
  verify: { checks: Array<{ label: string; passed: boolean }>; passed: boolean; detail?: string };
  steps: SopStepView[];
  intercept?: { avoidedLossUsdc: number };
}
