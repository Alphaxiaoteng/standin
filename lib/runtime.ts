import {
  scenarioAllowed,
  scenarioBlockedRecipient,
  scenarioBlockedInfiniteApproval,
  TEST_TOKENS,
} from "./scenarios";
import { ScriptedAgentRunner, TaskExecutionSummary, AgentTask } from "./runner";
import type { Intent, CalldataParams } from "./rehearse";
import {
  addIntercept,
  addRehearsal,
  addTransaction,
  recordIntercept,
  recordSpend,
  txHash,
  unitsToUsdc,
  type RehearsalSideView,
} from "./store";
import { CANONICAL } from "./chain";

export type ScenarioKind = "allowed" | "phishing" | "infinite";

const SCENARIOS: Record<ScenarioKind, AgentTask> = {
  allowed: scenarioAllowed,
  phishing: scenarioBlockedRecipient,
  infinite: scenarioBlockedInfiniteApproval,
};

export function isScenarioKind(value: unknown): value is ScenarioKind {
  return value === "allowed" || value === "phishing" || value === "infinite";
}

function toView(src: Intent | CalldataParams): RehearsalSideView {
  const view: RehearsalSideView = {
    action: src.action,
    token: src.token,
    to: src.to,
    amount: src.amount.toString(),
    amountUsdc: unitsToUsdc(src.amount),
  };
  if ("memo" in src && src.memo !== undefined) view.memo = src.memo;
  return view;
}

/** 代币地址 → 展示符号；未知地址退化为短地址 */
function tokenSymbol(address: string): string {
  const lower = address.toLowerCase();
  if (lower === TEST_TOKENS.USDC.toLowerCase() || lower === CANONICAL.testUsdc.toLowerCase()) {
    return "USDC";
  }
  if (lower === CANONICAL.wrappedMon.toLowerCase()) return "WMON";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export interface RunOutcome {
  summary: TaskExecutionSummary;
  /** 本次彩排详情记录 id */
  rehearsalId: string;
  /** 放行时落库的交易记录 id */
  transactionId?: string;
  /** 拦截时落库的拦截记录 id */
  interceptId?: string;
}

/**
 * 跑一次剧本：彩排门禁 → 落库（交易 / 拦截 / 彩排详情）→ 更新统计。
 * 全流程在内存态完成；链上金库放款由 PaymentVault 在彩排一致后执行，
 * 此处以测试网伪 txHash 表示已广播。
 */
export function runScenario(kind: ScenarioKind): RunOutcome {
  const task = SCENARIOS[kind];
  const runner = new ScriptedAgentRunner("0xAgent_ERC8004_Identity_Bound");
  const summary = runner.runTask(task);
  const ts = Date.now();

  const actualView = toView(task.proposedCalldata);
  const rehearsal = addRehearsal({
    ts,
    taskId: summary.taskId,
    description: summary.description,
    declaredIntent: toView(task.declaredIntent),
    actualCalldata: actualView,
    allowed: summary.rehearsal.allowed,
    reasons: [...summary.rehearsal.reasons],
    reportHash: summary.reportHash ?? "0x",
  });

  if (summary.status === "EXECUTED") {
    const amount = actualView.amountUsdc ?? 0;
    const record = addTransaction({
      ts,
      to: task.proposedCalldata.to,
      amount,
      token: tokenSymbol(task.proposedCalldata.token),
      status: "EXECUTED",
      txHash: txHash(),
      reportHash: summary.reportHash ?? "0x",
    });
    recordSpend(amount);
    return { summary, rehearsalId: rehearsal.id, transactionId: record.id };
  }

  const record = addIntercept({
    ts,
    taskId: summary.taskId,
    scenario: kind,
    reason: summary.reason ?? summary.rehearsal.reasons.join("; "),
    declaredTo: task.declaredIntent.to,
    actualTo: task.proposedCalldata.to,
    reportHash: summary.reportHash ?? "0x",
  });
  recordIntercept();
  return { summary, rehearsalId: rehearsal.id, interceptId: record.id };
}
