import { describe, it, expect, beforeEach } from "vitest";
import { runScenario, isScenarioKind } from "./runtime";
import {
  getStats,
  getLatestRehearsal,
  listIntercepts,
  listTransactions,
  resetStore,
} from "./store";
import { TEST_ADDRESSES } from "./scenarios";

const LEGIT = TEST_ADDRESSES.LEGIT_API_PROVIDER;
const ATTACKER = TEST_ADDRESSES.PHISHING_ATTACKER;
const MAX_UINT256_DECIMAL =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

beforeEach(() => {
  resetStore();
});

describe('runtime - runScenario("allowed")', () => {
  it("返回 EXECUTED 并产生一条交易", () => {
    const txBefore = listTransactions().length;
    const statsBefore = getStats();

    const out = runScenario("allowed");

    expect(out.summary.status).toBe("EXECUTED");
    expect(out.summary.rehearsal.allowed).toBe(true);
    expect(out.summary.rehearsal.reasons).toHaveLength(0);
    expect(out.summary.reportHash).toMatch(/^0x/);

    // 放行落库交易，且不产生拦截
    expect(out.transactionId).toBeDefined();
    expect(out.interceptId).toBeUndefined();

    const txs = listTransactions();
    expect(txs.length).toBe(txBefore + 1);
    const created = txs.find((t) => t.id === out.transactionId);
    expect(created).toBeDefined();
    expect(created!.status).toBe("EXECUTED");
    expect(created!.to).toBe(LEGIT);
    // 人类单位 0.5 USDC，而非最小单位 500000
    expect(created!.amount).toBe(0.5);
    expect(created!.token).toBe("USDC");
    expect(created!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(created!.reportHash).toBe(out.summary.reportHash);

    // 放行记账：支出累加、余额扣减、拦截数不变
    const after = getStats();
    expect(after.todaySpent).toBeCloseTo(statsBefore.todaySpent + 0.5, 6);
    expect(after.walletBalance).toBeCloseTo(statsBefore.walletBalance - 0.5, 6);
    expect(after.interceptCount).toBe(statsBefore.interceptCount);
  });

  it("不产生拦截记录，并写入可展示的彩排详情", () => {
    const itBefore = listIntercepts().length;
    const out = runScenario("allowed");

    expect(listIntercepts().length).toBe(itBefore);
    expect(out.rehearsalId).toMatch(/^rh-/);

    const latest = getLatestRehearsal();
    expect(latest!.id).toBe(out.rehearsalId);
    expect(latest!.allowed).toBe(true);
    expect(latest!.reasons).toHaveLength(0);
    expect(latest!.declaredIntent.to).toBe(LEGIT);
    expect(latest!.actualCalldata.to).toBe(LEGIT);
    // bigint 序列化为字符串，便于 JSON 传输
    expect(latest!.declaredIntent.amount).toBe("500000");
    expect(latest!.declaredIntent.amountUsdc).toBe(0.5);
    expect(latest!.actualCalldata.amount).toBe("500000");
    expect(latest!.reportHash).toMatch(/^0x/);
  });
});

describe('runtime - runScenario("phishing")', () => {
  it("返回 INTERCEPTED，原因含收款方不符", () => {
    const itBefore = listIntercepts().length;
    const txBefore = listTransactions().length;
    const statsBefore = getStats();

    const out = runScenario("phishing");

    expect(out.summary.status).toBe("INTERCEPTED");
    expect(out.summary.rehearsal.allowed).toBe(false);
    expect(out.summary.reason).toContain("Recipient mismatch");

    // 拦截落库，且绝不产生交易——资金分毫未动
    expect(out.interceptId).toBeDefined();
    expect(out.transactionId).toBeUndefined();
    expect(listTransactions().length).toBe(txBefore);

    const items = listIntercepts();
    expect(items.length).toBe(itBefore + 1);
    const created = items.find((i) => i.id === out.interceptId);
    expect(created).toBeDefined();
    expect(created!.scenario).toBe("phishing");
    expect(created!.reason).toContain("Recipient mismatch");
    // 声明 vs 实际收款方的差异是拦截的核心证据
    expect(created!.declaredTo).toBe(LEGIT);
    expect(created!.actualTo).toBe(ATTACKER);
    expect(created!.declaredTo).not.toBe(created!.actualTo);
    expect(created!.reportHash).toMatch(/^0x/);

    const after = getStats();
    expect(after.interceptCount).toBe(statsBefore.interceptCount + 1);
    expect(after.todaySpent).toBeCloseTo(statsBefore.todaySpent, 6);
    expect(after.walletBalance).toBeCloseTo(statsBefore.walletBalance, 6);
  });

  it("写入的彩排详情标记 allowed=false 且带归因", () => {
    runScenario("phishing");

    const latest = getLatestRehearsal();
    expect(latest!.allowed).toBe(false);
    expect(latest!.reasons).toContain("Recipient mismatch: declared " + LEGIT + ", actual " + ATTACKER);
    expect(latest!.declaredIntent.to).toBe(LEGIT);
    expect(latest!.actualCalldata.to).toBe(ATTACKER);
    expect(latest!.reportHash).toMatch(/^0x/);
  });
});

describe('runtime - runScenario("infinite")', () => {
  it("返回 INTERCEPTED，原因含无限授权", () => {
    const itBefore = listIntercepts().length;
    const txBefore = listTransactions().length;
    const statsBefore = getStats();

    const out = runScenario("infinite");

    expect(out.summary.status).toBe("INTERCEPTED");
    expect(out.summary.rehearsal.allowed).toBe(false);
    expect(out.summary.reason).toContain("Infinite approval");

    expect(out.interceptId).toBeDefined();
    expect(out.transactionId).toBeUndefined();
    expect(listTransactions().length).toBe(txBefore);

    const created = listIntercepts().find((i) => i.id === out.interceptId);
    expect(created).toBeDefined();
    expect(created!.scenario).toBe("infinite");
    expect(created!.reason).toContain("Infinite approval");
    expect(listIntercepts().length).toBe(itBefore + 1);

    expect(getStats().interceptCount).toBe(statsBefore.interceptCount + 1);
    expect(getStats().todaySpent).toBeCloseTo(statsBefore.todaySpent, 6);
    expect(getStats().walletBalance).toBeCloseTo(statsBefore.walletBalance, 6);
  });

  it("无限授权的金额降级为 null 而非数值失真", () => {
    runScenario("infinite");

    const latest = getLatestRehearsal();
    expect(latest!.allowed).toBe(false);
    expect(latest!.reasons).toContain("Infinite approval detected");

    // 2^256-1 无法用 number 精确表示，必须降级为 null 而不是给出错误数字
    expect(latest!.actualCalldata.amountUsdc).toBeNull();
    expect(latest!.actualCalldata.amount).toBe(MAX_UINT256_DECIMAL);
    // 声明侧（1 USDC）仍应可读
    expect(latest!.declaredIntent.amountUsdc).toBe(1);
    expect(latest!.declaredIntent.amount).toBe("1000000");
    expect(latest!.actualCalldata.action).toBe("approve");
  });
});

describe("runtime - 重复运行累计 stats", () => {
  it("连续三次放行：支出累加 1.5 USDC、余额同步扣减、产生三条交易", () => {
    const before = getStats();
    const txBefore = listTransactions().length;

    runScenario("allowed");
    runScenario("allowed");
    runScenario("allowed");

    const after = getStats();
    expect(after.todaySpent).toBeCloseTo(before.todaySpent + 1.5, 6);
    expect(after.walletBalance).toBeCloseTo(before.walletBalance - 1.5, 6);
    expect(after.interceptCount).toBe(before.interceptCount);
    expect(listTransactions().length).toBe(txBefore + 3);
  });

  it("连续两次拦截：拦截数累加 2，资金不变", () => {
    const before = getStats();

    runScenario("phishing");
    runScenario("infinite");

    const after = getStats();
    expect(after.interceptCount).toBe(before.interceptCount + 2);
    expect(after.todaySpent).toBeCloseTo(before.todaySpent, 6);
    expect(after.walletBalance).toBeCloseTo(before.walletBalance, 6);
  });

  it("混合运行后统计与流水/拦截条数保持一致", () => {
    const before = getStats();
    const itBefore = listIntercepts().length;
    const txBefore = listTransactions().length;

    runScenario("allowed");
    runScenario("phishing");
    runScenario("infinite");
    runScenario("allowed");

    const after = getStats();
    expect(after.todaySpent).toBeCloseTo(before.todaySpent + 1, 6);
    expect(after.walletBalance).toBeCloseTo(before.walletBalance - 1, 6);
    expect(after.interceptCount).toBe(before.interceptCount + 2);
    expect(listTransactions().length).toBe(txBefore + 2);
    expect(listIntercepts().length).toBe(itBefore + 2);
  });

  it("每次运行都留下独立的彩排详情记录", () => {
    const ids: string[] = [];
    for (const kind of ["allowed", "phishing", "infinite"] as const) {
      ids.push(runScenario(kind).rehearsalId);
    }
    expect(new Set(ids).size).toBe(3);
    // 彩排详情始终反映最后一次运行
    expect(getLatestRehearsal()!.id).toBe(ids[2]);
    expect(getLatestRehearsal()!.allowed).toBe(false);
  });
});

describe("runtime - isScenarioKind", () => {
  it("只接受三个已知剧本", () => {
    expect(isScenarioKind("allowed")).toBe(true);
    expect(isScenarioKind("phishing")).toBe(true);
    expect(isScenarioKind("infinite")).toBe(true);
  });

  it("拒绝未知剧本标识", () => {
    expect(isScenarioKind("evil")).toBe(false);
    expect(isScenarioKind("")).toBe(false);
    expect(isScenarioKind(undefined)).toBe(false);
    expect(isScenarioKind(null)).toBe(false);
    expect(isScenarioKind(1)).toBe(false);
    expect(isScenarioKind({})).toBe(false);
  });
});
