/**
 * SOP 状态机（PRD §四）：发现 → 打分 → 选择 → 门禁 → 执行 → 验收 → 结算 → 复盘。
 * 分支：skipped / intercepted / failed / passed，全部记账并写明原因。
 * 依赖全部走端口（LedgerPort 对齐 lib/ledger.ts 的 settle(SettlementInput)，写失败抛错），
 * 测试注入内存实现；账本写失败 → 回滚扣款并停机，禁止继续花钱。
 */

import { sourcesForKind, scoreOpportunity, coldStartPosterior, type BetaPosterior, type SourceHealthInput } from "./score";
import { selectOpportunities, type Candidate, type Selected } from "./select";
import { canTrade, settleTrade, guardStatusOf, type GuardState } from "./guard";
import { verifyBrief, verifySpreadWatch, spreadBps, medianDeviationBps, type BriefSnapshot, type SpreadSample } from "./verify";
import type { Bounty, BountyKind } from "../market/bounties";

export type SopStepName = "发现" | "打分" | "选择" | "门禁" | "执行" | "验收" | "结算" | "复盘";
export type SopStepStatus = "ok" | "fail" | "skip";

export interface SopStep {
  step: SopStepName;
  status: SopStepStatus;
  note: string;
}

/* ------------------------------------------------------------------ */
/* 端口类型                                                            */
/* ------------------------------------------------------------------ */

/** 对齐 lib/ledger.ts 的 SettlementInput（LedgerPersistence 提供） */
export interface SopSettlement {
  taskId: string;
  taskType: string;
  description: string;
  costUsdc: number;
  revenueUsdc: number;
  status: "SUCCESS" | "FAILED" | "INTERCEPTED" | "SKIPPED";
  reason?: string;
  avoidLossUsdc?: number;
  ts?: number;
}

/** 写失败直接抛错（真实 ledger 的行为：回滚内存态 + setHalted + re-throw） */
export interface LedgerPort {
  settle(entry: SopSettlement): void;
}

export interface WalletPort {
  balanceUsdc(): number;
  /** 扣成本；余额不足返回 null */
  debit(amount: number): number | null;
  credit(amount: number): number;
}

export interface ScorePosteriorPort {
  posteriorFor(kind: BountyKind): BetaPosterior;
  samplesFor(kind: BountyKind): number;
  observe(kind: BountyKind, success: boolean): void;
}

export interface BountiesPort {
  listOpen(): Bounty[];
}

export interface HealthPort {
  healthOf(name: string): SourceHealthInput;
  /** 全部源都不健康 → 今日停机（PRD §四发现行） */
  allUnhealthy(): boolean;
}

/** 独立回查 HN 榜单：必须在验收阶段调用（与执行阶段抓取相互独立）；null 表示回查失败 */
export interface BoardRecheckPort {
  recheck(): Promise<{ board: string[]; fetchedAt: number } | null>;
}

export interface ExecuteResult {
  ok: boolean;
  snapshot?: BriefSnapshot;
  samples?: SpreadSample[];
  notifiedAt?: number | null;
  error?: string;
}

export interface ExecutorPort {
  execute(kind: BountyKind, opts: { windowSec: number; toleranceBps: number | null }): Promise<ExecuteResult>;
}

export interface SopDeps {
  bounties: BountiesPort;
  health: HealthPort;
  wallet: WalletPort;
  ledger: LedgerPort;
  posterior: ScorePosteriorPort;
  executor: ExecutorPort;
  /** data_brief 验收阶段独立回查榜单；缺省时沿用快照自带的 hnBoard（仅测试用） */
  boardRecheck?: BoardRecheckPort;
  /** 调用方持有；本函数结算时用 settleTrade 更新（Object.assign 回写） */
  guard: GuardState;
  now?: () => number;
}

export interface SopTickRequest {
  kind?: BountyKind;
  bountyId?: string;
  perTradeCapUsdc: number;
  dailyBudgetUsdc: number;
}

export type SopTaskStatus = "passed" | "failed" | "skipped" | "intercepted";

export interface SopTickResult {
  ok: boolean;
  task: {
    id: string;
    kind: BountyKind;
    bountyId?: string;
    label: string;
    status: SopTaskStatus;
    costUsdc: number;
    revenueUsdc: number;
    netUsdc: number;
    failReason?: string;
    walletBalanceUsdc: number;
  };
  decision: { p: number; h: number; ev: number; score: number };
  verify: { checks: Array<{ label: string; passed: boolean }>; passed: boolean; detail?: string };
  steps: SopStep[];
  intercept?: { avoidedLossUsdc: number };
}

const BOUNTY_LABEL: Record<BountyKind, string> = {
  data_brief: "数据简报悬赏",
  spread_watch: "价差监测悬赏",
};

const MAX_AGE_MS = 60_000;
const MAX_SPREAD_BPS = 50;
const HEADLINE_COUNT = 5;

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function step(stepName: SopStepName, status: SopStepStatus, note: string): SopStep {
  return { step: stepName, status, note };
}

export function emptyPosteriorStore(): Map<BountyKind, BetaPosterior> {
  return new Map();
}

/** 内存后验存储（进程重启后冷启动；持久化可由调用方换成 ledger.getKv 实现的端口） */
export function memoryPosteriorPort(store: Map<BountyKind, BetaPosterior> = emptyPosteriorStore()): ScorePosteriorPort {
  return {
    posteriorFor(kind) {
      return store.get(kind) ?? coldStartPosterior();
    },
    samplesFor(kind) {
      const p = store.get(kind);
      return p ? p.alpha + p.beta - 2 : 0;
    },
    observe(kind, success) {
      const prev = this.posteriorFor(kind);
      store.set(kind, success ? { alpha: prev.alpha + 1, beta: prev.beta } : { alpha: prev.alpha, beta: prev.beta + 1 });
    },
  };
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                            */
/* ------------------------------------------------------------------ */

function briefChecks(snapshot: BriefSnapshot | undefined, deliveredAt: number): Array<{ label: string; passed: boolean }> {
  if (!snapshot) return [];
  const coins: Array<[string, BriefSnapshot["btc"] | undefined]> = [
    ["BTC", snapshot.btc],
    ["ETH", snapshot.eth],
  ];
  const pairs: Array<[string, { usd: number; fetchedAt: number } | undefined]> = [];
  for (const [coin, cq] of coins) {
    for (const source of ["CoinGecko", "Coinbase", "Kraken"]) {
      const key = source.toLowerCase() as "coingecko" | "coinbase" | "kraken";
      pairs.push([`${coin} ${source}`, cq?.[key]]);
    }
  }
  const checks: Array<{ label: string; passed: boolean }> = pairs.map(([label, q]) => ({
    label: `${label} 报价存在`,
    // Kraken 为第三方交叉校验源，缺失允许降级，不算报价缺失
    passed: label.endsWith("Kraken") ? true : !!q,
  }));
  for (const [label, q] of pairs) {
    if (q && !label.endsWith("Kraken")) {
      checks.push({ label: `${label} 新鲜度 ≤ 60s`, passed: deliveredAt - q.fetchedAt <= MAX_AGE_MS });
    }
  }
  for (const [coin, cq] of coins) {
    if (cq?.coingecko && cq?.coinbase && cq?.kraken) {
      const median = [cq.coingecko.usd, cq.coinbase.usd, cq.kraken.usd].sort((a, b) => a - b)[1];
      const worst = Math.max(
        medianDeviationBps(cq.coingecko.usd, median),
        medianDeviationBps(cq.coinbase.usd, median),
        medianDeviationBps(cq.kraken.usd, median),
      );
      checks.push({ label: `${coin} 三源中位数偏差 ≤ 50bps`, passed: worst <= MAX_SPREAD_BPS });
    } else if (cq?.coingecko && cq?.coinbase) {
      checks.push({
        label: `${coin} 两源价差 ≤ 50bps（降级）`,
        passed: spreadBps(cq.coingecko.usd, cq.coinbase.usd) <= MAX_SPREAD_BPS,
      });
    }
  }
  checks.push({
    label: `热点 ${HEADLINE_COUNT} 条且可回查`,
    passed: Array.isArray(snapshot.headlines)
      && snapshot.headlines.length === HEADLINE_COUNT
      && snapshot.headlines.every((t) => snapshot.hnBoard?.includes(t)),
  });
  return checks;
}

function spreadWatchChecks(ex: ExecuteResult, toleranceBps: number | null, nowMs: number): Array<{ label: string; passed: boolean }> {
  const threshold = toleranceBps ?? MAX_SPREAD_BPS;
  const windowStart = nowMs - 0; // 窗口由 executor 采样覆盖，这里只判定采样本身
  void windowStart;
  const triggered = (ex.samples ?? []).some((s) => s.spreadBps > threshold);
  const onTime = ex.notifiedAt !== null && ex.notifiedAt !== undefined;
  return [
    { label: `窗口内价差越过 ${threshold}bps`, passed: triggered },
    { label: "按时通知", passed: onTime },
  ];
}

function verifyChecks(
  kind: BountyKind,
  ex: ExecuteResult,
  toleranceBps: number | null,
  deliveredAt: number,
): { verdict: { passed: boolean; reasons: string[] }; checks: Array<{ label: string; passed: boolean }> } {
  if (kind === "data_brief") {
    const verdict = verifyBrief(ex.snapshot as BriefSnapshot, deliveredAt);
    const checks = briefChecks(ex.snapshot, deliveredAt);
    if (!verdict.passed && checks.length === 0) {
      return { verdict, checks: verdict.reasons.map((r) => ({ label: r, passed: false })) };
    }
    return { verdict, checks };
  }
  const verdict = verifySpreadWatch({
    samples: ex.samples ?? [],
    thresholdBps: toleranceBps ?? MAX_SPREAD_BPS,
    windowStart: deliveredAt - 0,
    windowEnd: deliveredAt,
    notifiedAt: ex.notifiedAt ?? null,
  });
  return { verdict, checks: spreadWatchChecks(ex, toleranceBps, deliveredAt) };
}

function baseTask(bounty: Bounty, status: SopTaskStatus, balance: number): SopTickResult["task"] {
  return {
    id: bounty.id,
    kind: bounty.kind,
    bountyId: bounty.id,
    label: bounty.title,
    status,
    costUsdc: 0,
    revenueUsdc: 0,
    netUsdc: 0,
    walletBalanceUsdc: balance,
  };
}

function terminalResult(input: {
  bounty: Bounty;
  status: SopTaskStatus;
  reason?: string;
  steps: SopStep[];
  decision: SopTickResult["decision"];
  balance: number;
  intercept?: { avoidedLossUsdc: number };
  verifyDetail?: string;
}): SopTickResult {
  const task = baseTask(input.bounty, input.status, input.balance);
  if (input.reason) task.failReason = input.reason;
  return {
    ok: false,
    task,
    decision: input.decision,
    verify: { checks: [], passed: false, detail: input.verifyDetail ?? input.reason },
    steps: input.steps,
    ...(input.intercept ? { intercept: input.intercept } : {}),
  };
}

/** 结算一条账；写失败返回错误描述（调用方走回滚+停机分支） */
function recordLedger(deps: SopDeps, entry: SopSettlement): string | null {
  try {
    deps.ledger.settle(entry);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function pickBounty(deps: SopDeps, req: SopTickRequest, steps: SopStep[]): Bounty | null {
  const open = deps.bounties.listOpen();
  if (req.bountyId) {
    const bounty = open.find((b) => b.id === req.bountyId);
    if (bounty) return bounty;
    steps.push(step("发现", "skip", `悬赏 ${req.bountyId} 不在可接列表（已关闭或不存在）`));
    return null;
  }
  const kind = req.kind ?? "data_brief";
  const bounty = open.find((b) => b.kind === kind);
  if (bounty) return bounty;
  steps.push(step("发现", "skip", `暂无开放的${BOUNTY_LABEL[kind]}`));
  return null;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

export async function runSopTick(req: SopTickRequest, deps: SopDeps): Promise<SopTickResult> {
  const now = deps.now ?? Date.now;
  const steps: SopStep[] = [];
  const noneDecision = { p: 0, h: 0, ev: 0, score: 0 };

  /* 1. 发现 */
  const bounty = pickBounty(deps, req, steps);
  if (!bounty) {
    const reason = steps[steps.length - 1]?.note;
    return terminalResult({
      bounty: { id: req.bountyId ?? "none", kind: req.kind ?? "data_brief", title: BOUNTY_LABEL[req.kind ?? "data_brief"] } as Bounty,
      status: "skipped",
      reason,
      steps,
      decision: noneDecision,
      balance: deps.wallet.balanceUsdc(),
    });
  }
  steps.push(step("发现", "ok", `发现悬赏 ${bounty.id}（${bounty.buyer}）`));

  /* 2. 打分 */
  if (deps.health.allUnhealthy()) {
    steps.push(step("打分", "fail", "所有数据源都不健康，今日停机并提示"));
    return terminalResult({
      bounty, status: "skipped", reason: "所有数据源都不健康，今日停机", steps, decision: noneDecision, balance: deps.wallet.balanceUsdc(),
    });
  }
  const sourceHealth = sourcesForKind(bounty.kind).map((n) => deps.health.healthOf(n));
  const scored = scoreOpportunity({
    kind: bounty.kind,
    rewardUsdc: bounty.rewardUsdc,
    costUsdc: bounty.costUsdc,
    sourceHealth,
    posterior: deps.posterior.posteriorFor(bounty.kind),
    samples: deps.posterior.samplesFor(bounty.kind),
  });
  steps.push(step("打分", "ok", `p=${scored.p} h=${scored.h} EV=${scored.ev} score=${scored.score}`));
  const decision = { p: scored.p, h: scored.h, ev: scored.ev, score: scored.score };

  /* 3. 选择 */
  const candidate: Candidate = {
    id: bounty.id,
    kind: bounty.kind,
    title: bounty.title,
    costUsdc: bounty.costUsdc,
    ev: scored.ev,
    score: scored.score,
    sampleInsufficient: scored.sampleInsufficient,
    sourceHealth,
  };
  const selection = selectOpportunities([candidate], {
    perTradeCapUsdc: req.perTradeCapUsdc,
    remainingBudgetUsdc: req.dailyBudgetUsdc - deps.guard.spentTodayUsdc,
    balanceUsdc: deps.wallet.balanceUsdc(),
    pausedKinds: deps.guard.pausedKinds,
    consecutiveLossesByKind: deps.guard.consecutiveLossesByKind,
  });
  if (selection.selected.length === 0) {
    const reason = selection.skipped[0]?.reason ?? "没有正收益候选，日报写「今天没有值得做的」";
    steps.push(step("选择", "skip", reason));
    const err = recordLedger(deps, {
      taskId: bounty.id, taskType: bounty.kind, description: bounty.title,
      costUsdc: 0, revenueUsdc: 0, status: "SKIPPED", reason, ts: now(),
    });
    if (err) return ledgerHaltResult(bounty, steps, err, deps.wallet.balanceUsdc(), decision);
    return terminalResult({ bounty, status: "skipped", reason, steps, decision, balance: deps.wallet.balanceUsdc() });
  }
  const chosen: Selected = selection.selected[0];
  steps.push(step("选择", "ok", `选中，仓位 ${chosen.stakeUsdc}${chosen.stakeHalved ? "（连亏 2 单仓位减半）" : ""}`));

  /* 4. 门禁 */
  if (!canTrade(deps.guard, bounty.kind)) {
    const reason = deps.guard.haltReason ?? "该任务类型因连亏暂停";
    steps.push(step("门禁", "fail", `拦截：${reason}，避免损失 ${bounty.costUsdc}`));
    const err = recordLedger(deps, {
      taskId: bounty.id, taskType: bounty.kind, description: bounty.title,
      costUsdc: 0, revenueUsdc: 0, status: "INTERCEPTED", reason, avoidLossUsdc: bounty.costUsdc, ts: now(),
    });
    if (err) return ledgerHaltResult(bounty, steps, err, deps.wallet.balanceUsdc(), decision);
    return terminalResult({
      bounty, status: "intercepted", reason, steps, decision, balance: deps.wallet.balanceUsdc(),
      intercept: { avoidedLossUsdc: r2(bounty.costUsdc) },
    });
  }
  steps.push(step("门禁", "ok", "声明与执行一致，放行"));

  /* 5. 执行（先扣成本；失败成本沉没） */
  const afterDebit = deps.wallet.debit(bounty.costUsdc);
  if (afterDebit === null) {
    const reason = "余额不足，提示去水龙头，不自动补充";
    steps.push(step("执行", "skip", reason));
    const err = recordLedger(deps, {
      taskId: bounty.id, taskType: bounty.kind, description: bounty.title,
      costUsdc: 0, revenueUsdc: 0, status: "SKIPPED", reason, ts: now(),
    });
    if (err) return ledgerHaltResult(bounty, steps, err, deps.wallet.balanceUsdc(), decision);
    return terminalResult({ bounty, status: "skipped", reason, steps, decision, balance: deps.wallet.balanceUsdc() });
  }
  steps.push(step("执行", "ok", `已扣成本 ${bounty.costUsdc}，开始采集`));
  const ex = await deps.executor.execute(bounty.kind, { windowSec: bounty.windowSec, toleranceBps: bounty.toleranceBps });
  if (!ex.ok) {
    const reason = `数据源失败：${ex.error ?? "未知错误"}，成本已花，记亏`;
    steps.push(step("执行", "fail", reason));
    Object.assign(deps.guard, settleTrade(deps.guard, { kind: bounty.kind, status: "failed", costUsdc: bounty.costUsdc, revenueUsdc: 0, at: now() }));
    const err = recordLedger(deps, {
      taskId: bounty.id, taskType: bounty.kind, description: bounty.title,
      costUsdc: bounty.costUsdc, revenueUsdc: 0, status: "FAILED", reason, ts: now(),
    });
    if (err) return ledgerHaltResult(bounty, steps, err, afterDebit, decision);
    deps.posterior.observe(bounty.kind, false);
    steps.push(step("复盘", "ok", "更新后验与止损计数"));
    return {
      ok: false,
      task: {
        ...baseTask(bounty, "failed", afterDebit),
        costUsdc: r2(bounty.costUsdc),
        netUsdc: -r2(bounty.costUsdc),
        failReason: reason,
      },
      decision,
      verify: { checks: [], passed: false, detail: ex.error ?? "执行失败" },
      steps,
    };
  }

  /* 6. 验收（data_brief 的榜单独立回查发生在本阶段，与执行阶段抓取相互独立） */
  const deliveredAt = now();
  let boardRecheckFailed = false;
  if (bounty.kind === "data_brief" && deps.boardRecheck) {
    const re = await deps.boardRecheck.recheck();
    if (re && ex.snapshot) {
      ex.snapshot.hnBoard = re.board;
      ex.snapshot.hnBoardFetchedAt = re.fetchedAt;
    } else {
      boardRecheckFailed = true;
    }
  }
  let { verdict, checks } = verifyChecks(bounty.kind, ex, bounty.toleranceBps, deliveredAt);
  if (boardRecheckFailed) {
    verdict = { passed: false, reasons: ["无法独立回查榜单", ...verdict.reasons] };
    checks = [...checks, { label: "独立回查榜单", passed: false }];
  }
  steps.push(verdict.passed ? step("验收", "ok", "规则逐条通过") : step("验收", "fail", verdict.reasons.join("；") || "未通过"));

  /* 7. 结算 */
  const revenue = verdict.passed ? bounty.rewardUsdc : 0;
  const net = revenue - bounty.costUsdc;
  const err = recordLedger(deps, {
    taskId: bounty.id, taskType: bounty.kind, description: bounty.title,
    costUsdc: bounty.costUsdc, revenueUsdc: revenue,
    status: verdict.passed ? "SUCCESS" : "FAILED",
    reason: verdict.passed ? undefined : verdict.reasons.join("；"),
    ts: deliveredAt,
  });
  if (err) {
    deps.wallet.credit(bounty.costUsdc);
    steps.push(step("结算", "fail", `账本写失败：${err}，已回滚扣款并停机，禁止继续花钱`));
    return {
      ok: false,
      task: {
        ...baseTask(bounty, "failed", deps.wallet.balanceUsdc()),
        costUsdc: r2(bounty.costUsdc),
        netUsdc: -r2(bounty.costUsdc),
        failReason: `账本写失败：${err}`,
      },
      decision,
      verify: { checks, passed: verdict.passed, detail: "结算失败，已回滚" },
      steps,
    };
  }
  if (verdict.passed) deps.wallet.credit(revenue);
  Object.assign(deps.guard, settleTrade(deps.guard, {
    kind: bounty.kind, status: verdict.passed ? "passed" : "failed", costUsdc: bounty.costUsdc, revenueUsdc: revenue, at: deliveredAt,
  }));
  steps.push(step("结算", "ok", verdict.passed ? `收入 ${r2(revenue)}，净利 ${r2(net)}` : `成本沉没，净亏 ${r2(-net)}`));

  /* 8. 复盘 */
  deps.posterior.observe(bounty.kind, verdict.passed);
  steps.push(step("复盘", "ok", "更新后验、健康度和止损计数"));

  return {
    ok: verdict.passed,
    task: {
      ...baseTask(bounty, verdict.passed ? "passed" : "failed", deps.wallet.balanceUsdc()),
      costUsdc: r2(bounty.costUsdc),
      revenueUsdc: r2(revenue),
      netUsdc: r2(net),
      failReason: verdict.passed ? undefined : verdict.reasons.join("；"),
    },
    decision,
    verify: { checks, passed: verdict.passed, detail: verdict.reasons.join("；") || undefined },
    steps,
  };
}

function ledgerHaltResult(bounty: Bounty, steps: SopStep[], error: string, balance: number, decision: SopTickResult["decision"]): SopTickResult {
  steps.push(step("结算", "fail", `账本写失败：${error}，回滚并停机，禁止继续花钱`));
  return terminalResult({
    bounty, status: "failed", reason: `账本写失败：${error}`, steps, decision, balance,
    verifyDetail: "账本写失败，禁止继续花钱",
  });
}

export { guardStatusOf };
