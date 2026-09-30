import { describe, it, expect } from "vitest";
import { ScriptedAgentRunner } from "./runner";
import {
  scenarioAllowed,
  scenarioBlockedRecipient,
  scenarioBlockedInfiniteApproval,
} from "./scenarios";

describe("Scripted Agent Execution & Rehearsal Flow", () => {
  const runner = new ScriptedAgentRunner("0xAgentMockAddress");

  it("Scenario 1: Legitimate payment passes rehearsal gate", () => {
    const res = runner.runTask(scenarioAllowed);
    expect(res.status).toBe("EXECUTED");
    expect(res.rehearsal.allowed).toBe(true);
    expect(res.rehearsal.reasons).toHaveLength(0);
    expect(res.reportHash).toBeDefined();
  });

  it("Scenario 2: Malicious redirect is intercepted before on-chain execution", () => {
    const res = runner.runTask(scenarioBlockedRecipient);
    expect(res.status).toBe("INTERCEPTED");
    expect(res.rehearsal.allowed).toBe(false);
    expect(res.reason).toContain("Recipient mismatch");
  });

  it("Scenario 3: Dangerous infinite approval is blocked completely", () => {
    const res = runner.runTask(scenarioBlockedInfiniteApproval);
    expect(res.status).toBe("INTERCEPTED");
    expect(res.rehearsal.allowed).toBe(false);
    expect(res.reason).toContain("Infinite approval detected");
  });
});
