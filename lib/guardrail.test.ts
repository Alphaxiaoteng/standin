/**
 * 红绿灯控制台数据契约：/guardrail 展示的裁决、逐字段证据与避免损失口径
 * 必须全部来自 runScenario → compareIntent → ledger 的真实推导，任何环节失真都要在此暴露。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { runScenario } from "./runtime";
import {
  getStats,
  listIntercepts,
  listRehearsals,
  listTransactions,
  resetStore,
} from "./store";
import { deriveAvoidedLoss } from "./agent/avoidedLoss";
import { TEST_ADDRESSES } from "./scenarios";

beforeEach(() => {
  resetStore();
});

describe("guardrail 红绿灯：绿灯放行分支", () => {
  it("allowed 返回 EXECUTED，彩排记录逐字段一致（全绿证据）", () => {
    const out = runScenario("allowed");

    expect(out.summary.status).toBe("EXECUTED");
    expect(out.summary.rehearsal.allowed).toBe(true);
    expect(out.summary.rehearsal.reasons).toHaveLength(0);
    expect(out.rehearsalId).toMatch(/^rh-/);

    const r = listRehearsals().find((x) => x.id === out.rehearsalId);
    expect(r).toBeDefined();
    expect(r!.declaredIntent.to).toBe(r!.actualCalldata.to);
    expect(r!.declaredIntent.token).toBe(r!.actualCalldata.token);
    expect(r!.declaredIntent.action).toBe(r!.actualCalldata.action);
    expect(r!.declaredIntent.amount).toBe(r!.actualCalldata.amount);
    expect(r!.allowed).toBe(true);
    expect(r!.reasons).toHaveLength(0);
  });

  it("放行记录同时带本地报告哈希与本地流水号，二者是不同字段", () => {
    const out = runScenario("allowed");

    expect(out.summary.reportHash).toMatch(/^0x[0-9a-f]{64}$/);

    const tx = listTransactions().find((t) => t.id === out.transactionId);
    expect(tx).toBeDefined();
    expect(tx!.reportHash).toBe(out.summary.reportHash);
    // txHash 与 reportHash 来源不同：本地流水号 ≠ 彩排报告哈希（均不广播）
    expect(tx!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(tx!.txHash).not.toBe(tx!.reportHash);
  });
});

describe("guardrail 红绿灯：红灯拦截分支", () => {
  it("phishing 返回 INTERCEPTED，证据含声明 vs 实际收款方且金额可量化", () => {
    const out = runScenario("phishing");

    expect(out.summary.status).toBe("INTERCEPTED");
    expect(out.summary.reason).toContain("Recipient mismatch");
    expect(out.interceptId).toBeDefined();
    expect(out.transactionId).toBeUndefined();

    const r = listRehearsals().find((x) => x.id === out.rehearsalId);
    expect(r!.declaredIntent.to).toBe(TEST_ADDRESSES.LEGIT_API_PROVIDER);
    expect(r!.actualCalldata.to).toBe(TEST_ADDRESSES.PHISHING_ATTACKER);
    expect(r!.allowed).toBe(false);

    const it = listIntercepts().find((x) => x.id === out.interceptId);
    expect(it!.avoidedLossUsdc === undefined || it!.avoidedLossUsdc === null).toBe(true);
    const avoided = deriveAvoidedLoss(it!, listRehearsals());
    expect(avoided).toBe(0.5);
  });

  it("infinite 返回 INTERCEPTED，实际 calldata 为 2^256-1 且降级为 null", () => {
    const out = runScenario("infinite");

    expect(out.summary.status).toBe("INTERCEPTED");
    expect(out.summary.reason).toContain("Infinite approval");

    const r = listRehearsals().find((x) => x.id === out.rehearsalId);
    expect(r!.actualCalldata.amountUsdc).toBeNull();
    expect(r!.actualCalldata.action).toBe("approve");
    expect(BigInt(r!.actualCalldata.amount)).toBe((BigInt(1) << BigInt(256)) - BigInt(1));
    // 声明侧 1 USDC 仍可读：金额不一致本身就是逐字段证据
    expect(r!.declaredIntent.amountUsdc).toBe(1);
    expect(r!.declaredIntent.amount).toBe("1000000");

    const it = listIntercepts().find((x) => x.id === out.interceptId);
    const avoided = deriveAvoidedLoss(it!, listRehearsals());
    expect(avoided).toBe(1);
  });

  it("拦截分支绝不产生交易，钱包与支出统计保持不动", () => {
    const before = getStats();
    const txBefore = listTransactions().length;
    runScenario("phishing");
    runScenario("infinite");

    expect(listTransactions()).toHaveLength(txBefore);
    expect(getStats().todaySpent).toBeCloseTo(before.todaySpent, 6);
    expect(getStats().walletBalance).toBeCloseTo(before.walletBalance, 6);
    expect(getStats().interceptCount).toBe(before.interceptCount + 2);
  });
});
