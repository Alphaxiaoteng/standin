import { compareIntent, Intent, CalldataParams, RehearsalResult } from "./rehearse";

export interface AgentTask {
  id: string;
  description: string;
  declaredIntent: Intent;
  proposedCalldata: CalldataParams;
}

export interface TaskExecutionSummary {
  taskId: string;
  description: string;
  rehearsal: RehearsalResult;
  status: "EXECUTED" | "INTERCEPTED";
  reason?: string;
  reportHash?: string;
}

/**
 * 模拟生成报告 Hash
 */
export function generateReportHash(taskId: string, intent: Intent, calldata: CalldataParams): `0x${string}` {
  // 简易稳定 Hash，模拟 keccak256
  const raw = `${taskId}:${intent.action}:${intent.to}:${intent.amount}:${calldata.action}:${calldata.to}:${calldata.amount}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(64, "0");
  return `0x${hex}`;
}

/**
 * Agent 脚本化运行器：执行任务并过彩排门禁
 */
export class ScriptedAgentRunner {
  private agentAddress: string;

  constructor(agentAddress: string) {
    this.agentAddress = agentAddress;
  }

  public runTask(task: AgentTask): TaskExecutionSummary {
    const rehearsal = compareIntent(task.declaredIntent, task.proposedCalldata);
    const reportHash = generateReportHash(task.id, task.declaredIntent, task.proposedCalldata);

    if (!rehearsal.allowed) {
      return {
        taskId: task.id,
        description: task.description,
        rehearsal,
        status: "INTERCEPTED",
        reason: rehearsal.reasons.join("; "),
        reportHash,
      };
    }

    return {
      taskId: task.id,
      description: task.description,
      rehearsal,
      status: "EXECUTED",
      reportHash,
    };
  }
}
