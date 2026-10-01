import { describe, expect, it } from "vitest";
import { initialGuardState } from "./guard";
import {
  memoryPosteriorPort,
  runSopTick,
  type BountiesPort,
  type ExecuteResult,
  type ExecutorPort,
  type HealthPort,
  type LedgerPort,
  type SopDeps,
  type SopSettlement,
  type SopTickRequest,
  type WalletPort,
} from "./sop";
import type { BriefSnapshot } from "./verify";
import type { Bounty } from "../market/bounties";

const NOW = 1_760_000_000_000;

function sampleBrief(ageMs = 10_000, spreadBps = 10): BriefSnapshot {
  const at = NOW - ageMs;
  const btcMid = 10_000;
  const btcHalf = (spreadBps / 10_000) * btcMid / 2;
  const headlines = ["h1", "h2", "h3", "h4", "h5"];
  return {
    btc: { coingecko: { usd: btcMid - btcHalf, fetchedAt: at }, coinbase: { usd: btcMid + btcHalf, fetchedAt: at } },
    eth: { coingecko: { usd: 2_000, fetchedAt: at }, coinbase: { usd: 2_000, fetchedAt: at } },
    headlines,
    hnBoard: [...headlines, "h6", "h7"],
  };
}

function sampleBounty(over: Partial<Bounty> = {}): Bounty {
  return {
    id: "bnty-1",
    kind: "data_brief",
    title: "BTC/ETH 双源价格简报",
    description: "采集两源价格与热点",
    rewardUsdc: 2.0,
    costUsdc: 0.4,
    windowSec: 60,
    toleranceBps: null,
    status: "open",
    buyer: "QUANT DESK (DEMO BUYER)",
    buyerType: "demo",
    createdAt: NOW - 1_000,
    expiresAt: NOW + 59_000,
    ...over,
  };
}

interface TestRig {
  bounties: Bounty[];
  walletBalance: number;
  ledgerEntries: SopSettlement[];
  throwOnLedgerSettle?: boolean;
  executorResult?: ExecuteResult;
  allUnhealthy?: boolean;
  deps: SopDeps;
  req: SopTickRequest;
}

function createRig(over: Partial<TestRig> = {}): TestRig {
  const bounties: Bounty[] = over.bounties ?? [sampleBounty()];
  let walletBalance = over.walletBalance ?? 20;
  const ledgerEntries: SopSettlement[] = over.ledgerEntries ?? [];

  const bountiesPort: BountiesPort = {
    listOpen: () => bounties.filter((b) => b.status === "open"),
  };

  const healthPort: HealthPort = {
    healthOf: (name) => ({ name, score: 1, healthy: true }),
    allUnhealthy: () => !!over.allUnhealthy,
  };

  const walletPort: WalletPort = {
    balanceUsdc: () => walletBalance,
    debit: (amount) => {
      if (walletBalance < amount) return null;
      walletBalance = Math.round((walletBalance - amount) * 1e6) / 1e6;
      return walletBalance;
    },
    credit: (amount) => {
      walletBalance = Math.round((walletBalance + amount) * 1e6) / 1e6;
      return walletBalance;
    },
  };

  const ledgerPort: LedgerPort = {
    settle: (entry) => {
      if (over.throwOnLedgerSettle) throw new Error("SQLite disk I/O error");
      ledgerEntries.push({ ...entry });
    },
  };

  const executorPort: ExecutorPort = {
    execute: async () => over.executorResult ?? { ok: true, snapshot: sampleBrief() },
  };

  const guard = initialGuardState(10, NOW);
  const deps: SopDeps = {
    bounties: bountiesPort,
    health: healthPort,
    wallet: walletPort,
    ledger: ledgerPort,
    posterior: memoryPosteriorPort(),
    executor: executorPort,
    guard,
    now: () => NOW,
  };

  const req: SopTickRequest = {
    kind: "data_brief",
    perTradeCapUsdc: 5,
    dailyBudgetUsdc: 10,
  };

  return {
    bounties,
    get walletBalance() {
      return walletBalance;
    },
    set walletBalance(v) {
      walletBalance = v;
    },
    ledgerEntries,
    deps,
    req,
  };
}

describe("runSopTick happy path (8 步全绿)", () => {
  it("executes, passes verification, earns revenue, updates ledger and posterior", async () => {
    const rig = createRig();
    const res = await runSopTick(rig.req, rig.deps);

    expect(res.ok).toBe(true);
    expect(res.task.status).toBe("passed");
    expect(res.task.costUsdc).toBe(0.4);
    expect(res.task.revenueUsdc).toBe(2);
    expect(res.task.netUsdc).toBe(1.6);
    expect(res.task.walletBalanceUsdc).toBe(21.6); // 20 - 0.4 + 2

    // 步骤全覆盖
    const stepNames = res.steps.map((s) => s.step);
    expect(stepNames).toEqual(["发现", "打分", "选择", "门禁", "执行", "验收", "结算", "复盘"]);
    expect(res.steps.every((s) => s.status === "ok")).toBe(true);

    // 账本落盘
    expect(rig.ledgerEntries).toHaveLength(1);
    expect(rig.ledgerEntries[0]).toMatchObject({
      taskId: "bnty-1",
      costUsdc: 0.4,
      revenueUsdc: 2,
      status: "SUCCESS",
    });

    // 验收打勾界面字段
    expect(res.verify.passed).toBe(true);
    expect(res.verify.checks.length).toBeGreaterThanOrEqual(4);
    expect(res.verify.checks.every((c) => c.passed)).toBe(true);

    // 复盘更新了后验：α 从 1 升到 2
    expect(rig.deps.posterior.posteriorFor("data_brief").alpha).toBe(2);
  });
});

describe("runSopTick real data verification failures (真实裁决，不是脚本)", () => {
  it("fails verification and books a real loss when price quote is expired (> 60s)", async () => {
    const rig = createRig({
      // 报价已过期 65 秒
      executorResult: { ok: true, snapshot: sampleBrief(65_000) },
    });

    const res = await runSopTick(rig.req, rig.deps);
    expect(res.ok).toBe(false);
    expect(res.task.status).toBe("failed");
    expect(res.task.costUsdc).toBe(0.4);
    expect(res.task.revenueUsdc).toBe(0);
    expect(res.task.netUsdc).toBe(-0.4);
    expect(res.task.failReason).toContain("已过期 65 秒");
    expect(res.task.walletBalanceUsdc).toBe(19.6); // 扣了成本，没收到报酬

    // 账本如实记录亏损
    expect(rig.ledgerEntries[0]).toMatchObject({
      status: "FAILED",
      costUsdc: 0.4,
      revenueUsdc: 0,
    });
    expect(rig.ledgerEntries[0].reason).toContain("已过期 65 秒");

    // 失败也更新后验：β 升到 2
    expect(rig.deps.posterior.posteriorFor("data_brief").beta).toBe(2);
  });

  it("fails verification when spread exceeds 50bps band", async () => {
    const rig = createRig({
      // 价差 80 基点 > 50 容忍带（PRD §八实测现象）
      executorResult: { ok: true, snapshot: sampleBrief(10_000, 80) },
    });

    const res = await runSopTick(rig.req, rig.deps);
    expect(res.ok).toBe(false);
    expect(res.task.status).toBe("failed");
    expect(res.task.failReason).toContain("超过容忍带");
  });

  it("fails at execution when data source times out, sinks cost and books a loss", async () => {
    const rig = createRig({
      executorResult: { ok: false, error: "CoinGecko 请求超时" },
    });

    const res = await runSopTick(rig.req, rig.deps);
    expect(res.ok).toBe(false);
    expect(res.task.status).toBe("failed");
    expect(res.task.costUsdc).toBe(0.4);
    expect(res.task.netUsdc).toBe(-0.4);
    expect(res.task.walletBalanceUsdc).toBe(19.6);
    expect(rig.ledgerEntries[0].status).toBe("FAILED");
    expect(rig.ledgerEntries[0].reason).toContain("超时");
  });
});

describe("runSopTick safety gates and skip branches", () => {
  it("intercepts at the guard gate when daily loss reaches 30% and quantifies avoided loss", async () => {
    const rig = createRig();
    // 预先让 guard 处于 halt 状态（亏损达到 30% 预算 3.0）
    rig.deps.guard.halt = true;
    rig.deps.guard.haltReason = "今日已停手，避免继续亏损 3.00";

    const res = await runSopTick(rig.req, rig.deps);
    expect(res.ok).toBe(false);
    expect(res.task.status).toBe("intercepted");
    expect(res.task.costUsdc).toBe(0); // 拦截未花钱
    expect(res.intercept?.avoidedLossUsdc).toBe(0.4); // 避免了 0.4 的损失
    expect(res.task.walletBalanceUsdc).toBe(20);

    // 账本记一笔 INTERCEPTED
    expect(rig.ledgerEntries[0]).toMatchObject({
      status: "INTERCEPTED",
      avoidLossUsdc: 0.4,
    });
  });

  it("skips in selection when balance is insufficient (去水龙头提示)", async () => {
    const rig = createRig({ walletBalance: 0.1 }); // 成本 0.4 > 余额 0.1
    const res = await runSopTick(rig.req, rig.deps);
    expect(res.ok).toBe(false);
    expect(res.task.status).toBe("skipped");
    expect(res.task.failReason).toContain("余额不足");
    expect(rig.ledgerEntries[0].status).toBe("SKIPPED");
  });

  it("skips and halts when all data sources are unhealthy", async () => {
    const rig = createRig({ allUnhealthy: true });
    const res = await runSopTick(rig.req, rig.deps);
    expect(res.ok).toBe(false);
    expect(res.task.failReason).toContain("所有数据源都不健康，今日停机");
    // 不花钱
    expect(res.task.costUsdc).toBe(0);
  });

  it("skips when no open bounties exist", async () => {
    const rig = createRig({ bounties: [] });
    const res = await runSopTick(rig.req, rig.deps);
    expect(res.ok).toBe(false);
    expect(res.task.status).toBe("skipped");
    expect(res.task.failReason).toContain("暂无开放");
  });
});

describe("runSopTick board recheck (验收阶段独立回查榜单)", () => {
  it("fails verification and books a loss when the independent recheck fails", async () => {
    const rig = createRig();
    rig.deps.boardRecheck = { recheck: async () => null };

    const res = await runSopTick(rig.req, rig.deps);
    expect(res.ok).toBe(false);
    expect(res.task.status).toBe("failed");
    expect(res.task.failReason).toContain("无法独立回查榜单");
    expect(res.task.netUsdc).toBe(-0.4);
    expect(rig.ledgerEntries[0]).toMatchObject({ status: "FAILED", costUsdc: 0.4, revenueUsdc: 0 });
    expect(rig.ledgerEntries[0].reason).toContain("无法独立回查榜单");
  });

  it("judges against the rechecked board, not the executor-provided one", async () => {
    const rig = createRig();
    // 回查到的榜单不含执行阶段的任何热点 → 交付内容不可回查，必须判负
    rig.deps.boardRecheck = { recheck: async () => ({ board: ["x1", "x2", "x3", "x4", "x5"], fetchedAt: NOW }) };

    const res = await runSopTick(rig.req, rig.deps);
    expect(res.ok).toBe(false);
    expect(res.task.failReason).toContain("热点不在榜单");
  });

  it("passes when the rechecked board contains the delivered headlines", async () => {
    // 执行阶段快照故意带空榜单：只有回查成功才能通过验收
    const snap = sampleBrief();
    snap.hnBoard = [];
    const rig = createRig({ executorResult: { ok: true, snapshot: snap } });
    rig.deps.boardRecheck = {
      recheck: async () => ({ board: ["h1", "h2", "h3", "h4", "h5", "h6"], fetchedAt: NOW }),
    };

    const res = await runSopTick(rig.req, rig.deps);
    expect(res.ok).toBe(true);
    expect(res.task.status).toBe("passed");
  });
});

describe("runSopTick spread_watch 通知回放（验收只认独立通知存储）", () => {
  function spreadBounty(): Bounty {
    return sampleBounty({ id: "bnty-sp", kind: "spread_watch", title: "BTC 双源价差监测", toleranceBps: 50 });
  }

  function spreadResult(notifiedAt: number | null): ExecuteResult {
    return {
      ok: true,
      // 验收窗口为 [deliveredAt, deliveredAt]，采样须恰在 NOW 才算窗口内
      samples: [{ spreadBps: 80, at: NOW }],
      notifiedAt,
    };
  }

  function spreadRig(executorResult: ExecuteResult): TestRig {
    return createRig({
      bounties: [spreadBounty()],
      executorResult,
    });
  }

  const spreadReq: SopTickRequest = { kind: "spread_watch", perTradeCapUsdc: 5, dailyBudgetUsdc: 10 };

  it("passes when the breach was notified in the independent store", async () => {
    const rig = spreadRig(spreadResult(NOW));
    rig.deps.notices = { latestFor: (id) => (id === "bnty-sp" ? { at: NOW } : null) };

    const res = await runSopTick(spreadReq, rig.deps);
    expect(res.ok).toBe(true);
    expect(res.task.status).toBe("passed");
  });

  it("fails when the store has no notice even though the executor claims one (防自证)", async () => {
    const rig = spreadRig(spreadResult(NOW));
    rig.deps.notices = { latestFor: () => null };

    const res = await runSopTick(spreadReq, rig.deps);
    expect(res.ok).toBe(false);
    expect(res.task.status).toBe("failed");
    expect(res.task.failReason).toContain("未按时通知");
    expect(rig.ledgerEntries[0]).toMatchObject({ status: "FAILED", revenueUsdc: 0 });
  });

  it("fails when the notice timestamp falls outside the window", async () => {
    const rig = spreadRig(spreadResult(null));
    rig.deps.notices = { latestFor: () => ({ at: NOW + 999_999 }) };

    const res = await runSopTick(spreadReq, rig.deps);
    expect(res.ok).toBe(false);
    expect(res.task.failReason).toContain("未按时通知");
  });

  it("passes with the executor-reported sampling window (回归：样本早于交付时刻)", async () => {
    // live 验证发现：验收窗口曾固定为 [deliveredAt, deliveredAt]，
    // 而采样都在执行期间 → 真实环境永远"未超过阈值"。
    const rig = spreadRig({
      ok: true,
      samples: [{ spreadBps: 80, at: NOW - 20_000 }],
      notifiedAt: NOW - 15_000,
      windowStart: NOW - 30_000,
      windowEnd: NOW - 1_000,
    });
    rig.deps.notices = { latestFor: (id) => (id === "bnty-sp" ? { at: NOW - 15_000 } : null) };

    const res = await runSopTick(spreadReq, rig.deps);
    expect(res.ok).toBe(true);
    expect(res.task.status).toBe("passed");
  });
});

describe("runSopTick 结算证据（漏洞 C：收入必须有链上证据）", () => {
  it("third-party pass books PENDING with zero revenue and no wallet credit", async () => {
    const thirdParty = sampleBounty({
      id: "bnty-3p",
      buyerType: "third_party",
      buyer: "COMMUNITY BUYER",
      buyerAddress: "0x1111111111111111111111111111111111111111",
    });
    const rig = createRig({ bounties: [thirdParty] });
    const res = await runSopTick(rig.req, rig.deps);

    // 交付通过
    expect(res.task.status).toBe("passed");
    // 但收入为 0：等链上付款确认
    expect(res.task.revenueUsdc).toBe(0);
    expect(res.task.netUsdc).toBe(-0.4);
    // 钱包没有 credit：20 - 0.4，不加报酬
    expect(res.task.walletBalanceUsdc).toBe(19.6);

    const entry = rig.ledgerEntries[0];
    expect(entry.status).toBe("PENDING");
    expect(entry.costUsdc).toBe(0.4);
    expect(entry.revenueUsdc).toBe(0);
    expect(entry.meta).toMatchObject({ billing: "onchain", buyerAddress: "0x1111111111111111111111111111111111111111" });

    // guard 今日收入不包含未确认的报酬
    expect(rig.deps.guard.revenueTodayUsdc).toBe(0);
    expect(rig.deps.guard.costTodayUsdc).toBe(0.4);
  });

  it("demo pass books demo-billed revenue immediately", async () => {
    const rig = createRig();
    const res = await runSopTick(rig.req, rig.deps);

    expect(res.task.revenueUsdc).toBe(2);
    expect(res.task.walletBalanceUsdc).toBe(21.6);
    expect(rig.ledgerEntries[0]).toMatchObject({ status: "SUCCESS", revenueUsdc: 2 });
    expect(rig.ledgerEntries[0].meta).toMatchObject({ billing: "demo" });
  });

  it("third-party verification failure still books a plain loss", async () => {
    const thirdParty = sampleBounty({
      id: "bnty-3p-fail",
      buyerType: "third_party",
      buyerAddress: "0x1111111111111111111111111111111111111111",
    });
    const rig = createRig({
      bounties: [thirdParty],
      executorResult: { ok: true, snapshot: sampleBrief(65_000) }, // 过期报价
    });
    const res = await runSopTick(rig.req, rig.deps);
    expect(res.task.status).toBe("failed");
    expect(rig.ledgerEntries[0]).toMatchObject({ status: "FAILED", costUsdc: 0.4, revenueUsdc: 0 });
  });
});

describe("runSopTick ledger crash rollback (PRD §四 结算回滚并停机)", () => {
  it("rolls back wallet debit when ledger write fails, prohibiting further spend", async () => {
    const rig = createRig({ throwOnLedgerSettle: true });
    const res = await runSopTick(rig.req, rig.deps);

    expect(res.ok).toBe(false);
    expect(res.task.status).toBe("failed");
    expect(res.task.failReason).toContain("账本写失败");
    // 扣款已退还
    expect(res.task.walletBalanceUsdc).toBe(20);
    // 结算步骤标红
    const settleStep = res.steps.find((s) => s.step === "结算");
    expect(settleStep?.status).toBe("fail");
    expect(settleStep?.note).toContain("已回滚扣款并停机");
  });
});
