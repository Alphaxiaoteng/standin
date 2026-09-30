import { keccak256, toHex } from "viem";
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
 * 彩排报告哈希：keccak256(任务标识 + 声明意图 + 实际 calldata)。
 * 设计上该哈希将由 StandInAnchor 合约锚定（合约已通过 forge test，尚未部署），
 * 因此必须是真实 keccak256，
 * 而不是可碰撞的 32 位近似值——否则两个不同的彩排结果可能产生同一哈希。
 */
export function generateReportHash(taskId: string, intent: Intent, calldata: CalldataParams): `0x${string}` {
  const raw = `${taskId}:${intent.action}:${intent.to}:${intent.amount}:${calldata.action}:${calldata.to}:${calldata.amount}`;
  return keccak256(toHex(raw));
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
