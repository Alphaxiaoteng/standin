import { describe, it, expect, beforeEach } from "vitest";
import {
  addIntercept,
  addPolicy,
  addRehearsal,
  addTransaction,
  getLatestRehearsal,
  getStats,
  listIntercepts,
  listPolicies,
  listRehearsals,
  listTransactions,
  recordIntercept,
  recordSpend,
  resetStore,
  revokePolicy,
  unitsToUsdc,
  type NewPolicy,
} from "./store";
import { TEST_ADDRESSES, TEST_TOKENS } from "./scenarios";

const LEGIT = TEST_ADDRESSES.LEGIT_API_PROVIDER;
const ATTACKER = TEST_ADDRESSES.PHISHING_ATTACKER;
const USDC = TEST_TOKENS.USDC;

/** 每个用例都从确定的种子态出发，互不干扰 */
beforeEach(() => {
  resetStore();
});

describe("store - 种子数据", () => {
  it("预置至少一条策略，且字段完整", () => {
    const policies = listPolicies();
    expect(policies.length).toBeGreaterThan(0);

    const p = policies[0];
    expect(p.id).toMatch(/^pol-/);
    expect(typeof p.agent).toBe("string");
    expect(p.agent.length).toBeGreaterThan(0);
    expect(p.merchantHash).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(p.maxPerTx).toBeGreaterThan(0);
    expect(p.maxPerWeek).toBeGreaterThan(0);
    expect(p.expires).toBeGreaterThan(Date.now());
    expect(p.active).toBe(true);
  });

  it("预置交易流水，字段可渲染且金额以 USDC 人类单位计价", () => {
    const txs = listTransactions();
    expect(txs.length).toBeGreaterThan(0);

    for (const t of txs) {
      expect(t.id).toMatch(/^tx-/);
      expect(t.ts).toBeGreaterThan(0);
      expect(t.to).toMatch(/^0x/);
      expect(typeof t.amount).toBe("number");
      expect(t.amount).toBeGreaterThan(0);
      expect(t.status).toBe("EXECUTED");
      expect(t.txHash).toMatch(/^0x/);
      expect(t.reportHash).toMatch(/^0x/);
    }
  });

  it("预置拦截记录，含声明 vs 实际收款方", () => {
    const items = listIntercepts();
    expect(items.length).toBeGreaterThan(0);

    for (const i of items) {
      expect(i.id).toMatch(/^it-/);
      expect(i.taskId.length).toBeGreaterThan(0);
      expect(i.scenario.length).toBeGreaterThan(0);
      expect(i.reason.length).toBeGreaterThan(0);
      expect(i.declaredTo).toMatch(/^0x/);
      expect(i.actualTo).toMatch(/^0x/);
      expect(i.reportHash).toMatch(/^0x/);
    }
  });

  it("预置最近一次彩排详情", () => {
    expect(listRehearsals().length).toBeGreaterThan(0);

    const latest = getLatestRehearsal();
    expect(latest).not.toBeNull();
    expect(latest!.id).toMatch(/^rh-/);
    expect(latest!.declaredIntent.to).toMatch(/^0x/);
    expect(latest!.actualCalldata.to).toMatch(/^0x/);
    expect(typeof latest!.allowed).toBe("boolean");
    expect(Array.isArray(latest!.reasons)).toBe(true);
  });

  it("stats 三个指标均为有限数值", () => {
    const s = getStats();
    expect(Number.isFinite(s.todaySpent)).toBe(true);
    expect(Number.isFinite(s.interceptCount)).toBe(true);
    expect(Number.isFinite(s.walletBalance)).toBe(true);
    expect(s.interceptCount).toBeGreaterThan(0);
    expect(s.walletBalance).toBeGreaterThan(0);
  });

  it("列表按时间倒序返回（最新在前）", () => {
    const tx = listTransactions();
    for (let i = 1; i < tx.length; i++) {
      expect(tx[i - 1].ts).toBeGreaterThanOrEqual(tx[i].ts);
    }
    const it = listIntercepts();
    for (let i = 1; i < it.length; i++) {
      expect(it[i - 1].ts).toBeGreaterThanOrEqual(it[i].ts);
    }
  });

  it("resetStore 后统计回到种子基线", () => {
    recordSpend(10);
    recordIntercept();
    resetStore();

    const s = getStats();
    expect(s.todaySpent).toBeCloseTo(1.75, 6);
    expect(s.interceptCount).toBe(2);
    expect(s.walletBalance).toBeCloseTo(248.25, 6);
  });
});

describe("store - 读取隔离", () => {
  it("getStats 返回副本，外部修改不污染存储", () => {
    const before = getStats().interceptCount;
    const s = getStats();
    s.interceptCount = -1;
    expect(getStats().interceptCount).toBe(before);
  });

  it("列表返回副本，外部修改元素不污染存储", () => {
    const before = listTransactions()[0].amount;
    const snapshot = listTransactions();
    snapshot[0].amount = 999999;
    expect(listTransactions()[0].amount).toBe(before);

    const policyBefore = listPolicies()[0].active;
    const policies = listPolicies();
    policies[0].active = false;
    expect(listPolicies()[0].active).toBe(policyBefore);
  });
});

describe("store - 策略增删", () => {
  const newPolicy: NewPolicy = {
    agent: "0xAgent_Test_Bound",
    merchantHash: "0xdeadbeef",
    maxPerTx: 3,
    maxPerWeek: 30,
    expires: Date.now() + 86_400_000,
  };

  it("addPolicy 追加策略并默认启用，返回带 id 的完整对象", () => {
    const before = listPolicies().length;
    const created = addPolicy(newPolicy);

    expect(created.id).toMatch(/^pol-/);
    expect(created.active).toBe(true);
    expect(created.agent).toBe("0xAgent_Test_Bound");
    expect(created.merchantHash).toBe("0xdeadbeef");
    expect(created.maxPerTx).toBe(3);
    expect(created.maxPerWeek).toBe(30);
    expect(created.expires).toBe(newPolicy.expires);

    const after = listPolicies();
    expect(after.length).toBe(before + 1);
    // 新策略置顶，前端无需滚动即可看到刚创建的项
    expect(after[0].id).toBe(created.id);
  });

  it("revokePolicy 软撤销：置为 inactive 但保留审计痕迹", () => {
    const before = listPolicies().length;
    const created = addPolicy({ ...newPolicy, merchantHash: "0xfeedface" });

    expect(revokePolicy(created.id)).toBe(true);

    const found = listPolicies().find((p) => p.id === created.id);
    expect(found).toBeDefined();
    expect(found!.active).toBe(false);
    // 撤销是软删除，记录必须留在列表中供审计
    expect(listPolicies().length).toBe(before + 1);
  });

  it("revokePolicy 对未知 id 返回 false 且不改动任何策略", () => {
    const before = listPolicies();
    expect(revokePolicy("pol-does-not-exist")).toBe(false);

    const after = listPolicies();
    expect(after).toHaveLength(before.length);
    expect(after.every((p) => p.active)).toBe(before.every((p) => p.active));
  });
});

describe("store - 交易与拦截记录追加", () => {
  it("addTransaction 生成 id 并把最新记录排在最前", () => {
    const before = listTransactions().length;
    const record = addTransaction({
      ts: Date.now(),
      to: LEGIT,
      amount: 0.5,
      token: "USDC",
      status: "EXECUTED",
      txHash: "0xabc",
      reportHash: "0xdef",
    });

    expect(record.id).toMatch(/^tx-/);
    const after = listTransactions();
    expect(after.length).toBe(before + 1);
    expect(after[0].id).toBe(record.id);
    expect(after[0].to).toBe(LEGIT);
    expect(after[0].amount).toBe(0.5);
    expect(after[0].token).toBe("USDC");
    expect(after[0].txHash).toBe("0xabc");
    expect(after[0].reportHash).toBe("0xdef");
  });

  it("addIntercept 生成 id 并把最新记录排在最前", () => {
    const before = listIntercepts().length;
    const record = addIntercept({
      ts: Date.now(),
      taskId: "task-test",
      scenario: "phishing",
      reason: "Recipient mismatch",
      declaredTo: LEGIT,
      actualTo: ATTACKER,
      reportHash: "0xdef",
    });

    expect(record.id).toMatch(/^it-/);
    const after = listIntercepts();
    expect(after.length).toBe(before + 1);
    expect(after[0].id).toBe(record.id);
    expect(after[0].scenario).toBe("phishing");
    expect(after[0].declaredTo).toBe(LEGIT);
    expect(after[0].actualTo).toBe(ATTACKER);
    expect(after[0].reason).toBe("Recipient mismatch");
  });

  it("addRehearsal 生成 id 并成为最新彩排", () => {
    const before = listRehearsals().length;
    const record = addRehearsal({
      ts: Date.now(),
      taskId: "task-test",
      description: "测试彩排",
      declaredIntent: {
        action: "transfer",
        token: USDC,
        to: LEGIT,
        amount: "500000",
        amountUsdc: 0.5,
      },
      actualCalldata: {
        action: "transfer",
        token: USDC,
        to: ATTACKER,
        amount: "500000",
        amountUsdc: 0.5,
      },
      allowed: false,
      reasons: ["Recipient mismatch"],
      reportHash: "0xdef",
    });

    expect(record.id).toMatch(/^rh-/);
    expect(listRehearsals().length).toBe(before + 1);
    expect(getLatestRehearsal()!.id).toBe(record.id);
    expect(getLatestRehearsal()!.allowed).toBe(false);
    expect(getLatestRehearsal()!.reasons).toEqual(["Recipient mismatch"]);
  });
});

describe("store - stats 更新", () => {
  it("recordSpend 累加今日支出并扣减余额", () => {
    const before = getStats();
    recordSpend(0.5);
    const after = getStats();

    expect(after.todaySpent).toBeCloseTo(before.todaySpent + 0.5, 6);
    expect(after.walletBalance).toBeCloseTo(before.walletBalance - 0.5, 6);
    expect(after.interceptCount).toBe(before.interceptCount);
  });

  it("recordSpend 不会把余额扣成负数", () => {
    recordSpend(getStats().walletBalance + 1000);
    expect(getStats().walletBalance).toBeGreaterThanOrEqual(0);
  });

  it("recordIntercept 只递增拦截数，不动支出与余额", () => {
    const before = getStats();
    recordIntercept();
    const after = getStats();

    expect(after.interceptCount).toBe(before.interceptCount + 1);
    expect(after.todaySpent).toBeCloseTo(before.todaySpent, 6);
    expect(after.walletBalance).toBeCloseTo(before.walletBalance, 6);
  });

  it("连续记账累加正确且无浮点噪声泄漏", () => {
    const before = getStats();
    recordSpend(0.1);
    recordSpend(0.2);
    recordIntercept();
    recordIntercept();

    const after = getStats();
    expect(after.todaySpent).toBeCloseTo(before.todaySpent + 0.3, 6);
    expect(after.walletBalance).toBeCloseTo(before.walletBalance - 0.3, 6);
    expect(after.interceptCount).toBe(before.interceptCount + 2);
  });
});

describe("store - unitsToUsdc", () => {
  it("最小单位正确换算为 USDC（6 位小数）", () => {
    expect(unitsToUsdc(BigInt(500000))).toBe(0.5);
    expect(unitsToUsdc(BigInt(1000000))).toBe(1);
    expect(unitsToUsdc(BigInt(0))).toBe(0);
  });

  it("无限授权的 2^256-1 超出安全范围时返回 null", () => {
    const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
    expect(unitsToUsdc(MAX_UINT256)).toBeNull();
  });
});
