import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  Ledger,
  getLedger,
  resetStore,
  settle,
  recordTrade,
  addCost,
  addRevenue,
  getLedgerSummary,
  listLedgerEntries,
  withRollback,
  isHalted,
  getHaltReason,
  setHalted,
  getKv,
  setKv,
  getStats,
  recordSpend,
  recordIntercept,
  addTransaction,
  addPolicy,
  revokePolicy,
  toDateKey,
} from "./ledger";

const TEST_DIR = resolve(process.cwd(), ".data");
const CRASH_TEST_DB = resolve(TEST_DIR, "test-crash-recovery.json");
const ROLLBACK_TEST_DB = resolve(TEST_DIR, "test-rollback.json");

function cleanupFile(p: string) {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    // 忽略清理异常
  }
}

describe("Ledger - 账本存盘与模拟崩溃重启恢复", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    cleanupFile(CRASH_TEST_DB);
  });

  afterEach(() => {
    cleanupFile(CRASH_TEST_DB);
  });

  it("模拟崩溃重启恢复：写入数据、关闭账本、重新打开读取数据并断言一致", () => {
    // 1. 初始化一个独立落盘的 Ledger 实例
    const ledgerBeforeCrash = new Ledger({ storagePath: CRASH_TEST_DB });
    expect(ledgerBeforeCrash.isOpen()).toBe(true);

    const initialBalance = ledgerBeforeCrash.getStats().walletBalance;

    // 2. 模拟写入日常操作：支出、收入、结算、KV 状态
    ledgerBeforeCrash.addCost(2.5, {
      taskId: "task-test-cost",
      description: "购买验证集",
    });

    ledgerBeforeCrash.addRevenue(4.0, {
      taskId: "task-test-rev",
      description: "交付双源价格简报",
    });

    const settledEntry = ledgerBeforeCrash.settle({
      taskId: "task-bounty-settle",
      taskType: "data_brief",
      description: "悬赏任务自动结算",
      costUsdc: 0.4,
      revenueUsdc: 0.8,
      status: "SUCCESS",
      txHash: "0x1111222233334444555566667777888899990000aaaa",
      reportHash: "0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef",
    });

    ledgerBeforeCrash.setKv("guard_consecutive_losses", 2);
    ledgerBeforeCrash.setKv("beta_prior_data_brief", { alpha: 5, beta: 2 });

    const statsBeforeCrash = ledgerBeforeCrash.getStats();
    const summaryBeforeCrash = ledgerBeforeCrash.getLedgerSummary();
    const entriesBeforeCrash = ledgerBeforeCrash.listLedgerEntries(10);

    expect(statsBeforeCrash.walletBalance).toBeCloseTo(initialBalance - 2.5 + 4.0 - 0.4 + 0.8, 6);
    expect(summaryBeforeCrash.entryCount).toBeGreaterThanOrEqual(3);

    // 3. 模拟应用进程突然崩溃/关闭数据库
    ledgerBeforeCrash.close();
    expect(ledgerBeforeCrash.isOpen()).toBe(false);

    // 此时落盘文件必须确确实实存在于磁盘
    expect(existsSync(CRASH_TEST_DB)).toBe(true);

    // 4. 模拟进程重启，重新实例化打开相同路径的账本
    const ledgerAfterRestart = new Ledger({ storagePath: CRASH_TEST_DB });
    expect(ledgerAfterRestart.isOpen()).toBe(true);

    // 5. 断言恢复后的数据与崩溃前完全一致
    const statsAfter = ledgerAfterRestart.getStats();
    expect(statsAfter.walletBalance).toBeCloseTo(statsBeforeCrash.walletBalance, 6);
    expect(statsAfter.todaySpent).toBeCloseTo(statsBeforeCrash.todaySpent, 6);
    expect(statsAfter.interceptCount).toBe(statsBeforeCrash.interceptCount);

    const summaryAfter = ledgerAfterRestart.getLedgerSummary();
    expect(summaryAfter.revenueUsdc).toBeCloseTo(summaryBeforeCrash.revenueUsdc, 6);
    expect(summaryAfter.costUsdc).toBeCloseTo(summaryBeforeCrash.costUsdc, 6);
    expect(summaryAfter.netUsdc).toBeCloseTo(summaryBeforeCrash.netUsdc, 6);
    expect(summaryAfter.entryCount).toBe(summaryBeforeCrash.entryCount);

    // 断言条目与 KV 均完好恢复
    const entriesAfter = ledgerAfterRestart.listLedgerEntries(10);
    expect(entriesAfter[0].id).toBe(settledEntry.id);
    expect(entriesAfter[0].taskId).toBe("task-bounty-settle");
    expect(entriesAfter[0].txHash).toBe(settledEntry.txHash);
    expect(entriesAfter[0].netUsdc).toBeCloseTo(0.4, 6);

    expect(ledgerAfterRestart.getKv("guard_consecutive_losses")).toBe(2);
    expect(ledgerAfterRestart.getKv("beta_prior_data_brief")).toEqual({ alpha: 5, beta: 2 });

    ledgerAfterRestart.close();
  });
});

describe("Ledger - 回滚机制与写失败停机 (PRD §三/§四)", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    cleanupFile(ROLLBACK_TEST_DB);
  });

  afterEach(() => {
    cleanupFile(ROLLBACK_TEST_DB);
  });

  it("结算写失败时自动回滚内存变动并停机（禁止继续花钱）", () => {
    const ledger = new Ledger({ storagePath: ROLLBACK_TEST_DB });
    const initialStats = ledger.getStats();
    const initialEntriesCount = ledger.listLedgerEntries().length;

    // 故意让 flush 抛出异常（模拟底层存储介质写失败）
    ledger.flush = () => {
      throw new Error("Disk I/O error: disk full");
    };

    expect(() => {
      ledger.settle({
        taskId: "task-failing-settle",
        description: "本单尝试结算但遭遇落盘故障",
        costUsdc: 1.0,
        revenueUsdc: 2.0,
        status: "SUCCESS",
      });
    }).toThrow("Disk I/O error: disk full");

    // 回滚断言：内存中变动已撤回
    expect(ledger.getStats().walletBalance).toBeCloseTo(initialStats.walletBalance, 6);
    expect(ledger.getStats().todaySpent).toBeCloseTo(initialStats.todaySpent, 6);
    expect(ledger.listLedgerEntries().length).toBe(initialEntriesCount);

    // 停机断言：系统已置为停机状态 (isHalted = true) 并记录原因
    expect(ledger.isHalted()).toBe(true);
    expect(ledger.getHaltReason()).toContain("Settlement write failure");

    // 停机后再次尝试结算，必须被严格拒绝，禁止继续花钱
    expect(() => {
      ledger.settle({
        taskId: "task-another",
        description: "停机后被拒绝的操作",
        costUsdc: 0.1,
        revenueUsdc: 0,
        status: "SUCCESS",
      });
    }).toThrow(/Ledger is halted/);
  });

  it("withRollback 事务包裹：若业务逻辑抛出异常，状态自动还原", () => {
    const ledger = new Ledger({ storagePath: ROLLBACK_TEST_DB });
    const initialBalance = ledger.getStats().walletBalance;

    expect(() => {
      ledger.withRollback(() => {
        ledger.recordSpend(5.0);
        expect(ledger.getStats().walletBalance).toBeCloseTo(initialBalance - 5.0, 6);
        throw new Error("Mid-transaction business failure");
      });
    }).toThrow("Mid-transaction business failure");

    // 验证状态已恢复到事务前
    expect(ledger.getStats().walletBalance).toBeCloseTo(initialBalance, 6);
  });
});

describe("Ledger - 默认单例与 API 接口契约", () => {
  beforeEach(() => {
    resetStore();
  });

  it("getLedgerSummary 返回契约要求的形状并准确汇总", () => {
    const today = toDateKey();
    const summaryBefore = getLedgerSummary(today);
    expect(typeof summaryBefore.revenueUsdc).toBe("number");
    expect(typeof summaryBefore.costUsdc).toBe("number");
    expect(typeof summaryBefore.netUsdc).toBe("number");
    expect(typeof summaryBefore.avoidLossUsdc).toBe("number");
    expect(typeof summaryBefore.entryCount).toBe("number");
    expect(summaryBefore.dateKey).toBe(today);

    // 记录一单收入与成本
    settle({
      taskId: "task-summary-test",
      description: "测试汇总计算",
      costUsdc: 0.5,
      revenueUsdc: 1.2,
      status: "SUCCESS",
      avoidLossUsdc: 0,
    });

    const summaryAfter = getLedgerSummary(today);
    expect(summaryAfter.revenueUsdc).toBeCloseTo(summaryBefore.revenueUsdc + 1.2, 6);
    expect(summaryAfter.costUsdc).toBeCloseTo(summaryBefore.costUsdc + 0.5, 6);
    expect(summaryAfter.netUsdc).toBeCloseTo(summaryBefore.netUsdc + 0.7, 6);
    expect(summaryAfter.entryCount).toBe(summaryBefore.entryCount + 1);
  });

  it("recordTrade 接口支持 SOP 流转与错误捕获", () => {
    const okRes = recordTrade({
      kind: "data_brief",
      cost: 0.4,
      revenue: 0.6,
      status: "passed",
      taskId: "sop-trade-1",
    });

    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.id).toMatch(/^led-/);
      expect(okRes.entry.netUsdc).toBeCloseTo(0.2, 6);
      expect(okRes.entry.status).toBe("SUCCESS");
    }
  });

  it("addCost 与 addRevenue 正确联动金库余额", () => {
    const before = getStats();
    addCost(1.5, { taskId: "task-cost-1", description: "调用 API 消耗" });
    const mid = getStats();
    expect(mid.todaySpent).toBeCloseTo(before.todaySpent + 1.5, 6);
    expect(mid.walletBalance).toBeCloseTo(before.walletBalance - 1.5, 6);

    addRevenue(3.0, { taskId: "task-rev-1", description: "结算悬赏赏金" });
    const after = getStats();
    expect(after.walletBalance).toBeCloseTo(mid.walletBalance + 3.0, 6);
  });

  it("KV 存取用于 Guard / 状态持久化", () => {
    setKv("agent_status", "ACTIVE");
    setKv("today_quota", { max: 10, current: 2 });

    expect(getKv("agent_status")).toBe("ACTIVE");
    expect(getKv("today_quota")).toEqual({ max: 10, current: 2 });
    expect(getKv("non_existent")).toBeUndefined();
  });
});
