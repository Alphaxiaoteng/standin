import { describe, it, expect } from "vitest";
import { ScriptedAgentRunner } from "./runner";
import { scenarioAllowed, scenarioBlockedRecipient } from "./scenarios";

describe("E2E Integration: Rehearsal to On-Chain Gate Contract Binding", () => {
  const runner = new ScriptedAgentRunner("0xAgentMockAddress");

  it("Full cycle: Legitimate task yields approved reportHash suitable for PaymentVault release", () => {
    // 1. Agent 执行任务并彩排
    const result = runner.runTask(scenarioAllowed);
    expect(result.status).toBe("EXECUTED");
    expect(result.reportHash).toBeDefined();

    // 2. 模拟准备提交给 StandInAnchor 的数据
    const anchorPayload = {
      reportHash: result.reportHash!,
      to: scenarioAllowed.proposedCalldata.to,
      amount: scenarioAllowed.proposedCalldata.amount,
      token: scenarioAllowed.proposedCalldata.token,
      allowed: result.rehearsal.allowed,
      reason: "Rehearsal verification passed",
    };

    expect(anchorPayload.allowed).toBe(true);
    expect(anchorPayload.amount).toBe(500000n);

    // 3. 验证此时具备调用 PaymentVault.release 的必要凭据
    const vaultCallParams = {
      reportHash: anchorPayload.reportHash,
      to: anchorPayload.to,
      amount: anchorPayload.amount,
      token: anchorPayload.token,
    };
    expect(vaultCallParams.to).toBe(scenarioAllowed.declaredIntent.to);
    expect(vaultCallParams.amount).toBe(scenarioAllowed.declaredIntent.amount);
  });

  it("Full cycle: Intercepted task never issues valid anchor release payload", () => {
    // 1. Agent 遭遇被注入钓鱼的任务
    const result = runner.runTask(scenarioBlockedRecipient);
    expect(result.status).toBe("INTERCEPTED");

    // 2. 拦截状态下，即便生成了报告哈希，其 allowed 也恒为 false
    const anchorPayload = {
      reportHash: result.reportHash!,
      to: scenarioBlockedRecipient.proposedCalldata.to,
      amount: scenarioBlockedRecipient.proposedCalldata.amount,
      token: scenarioBlockedRecipient.proposedCalldata.token,
      allowed: result.rehearsal.allowed,
      reason: result.reason,
    };

    expect(anchorPayload.allowed).toBe(false);
    // 合约层在 release 时校验 require(rAllowed, "report not allowed")，从密码学与状态机根源上杜绝转账
  });
});
