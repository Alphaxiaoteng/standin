import { describe, expect, it } from "vitest";
import { BUDGET_FRACTION, selectOpportunities, type Candidate, type SelectOptions } from "./select";

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    id: "c1",
    kind: "data_brief",
    title: "简报悬赏",
    costUsdc: 0.4,
    ev: 0.8,
    score: 2,
    sampleInsufficient: false,
    sourceHealth: [{ name: "coingecko", healthy: true, score: 1 }],
    ...over,
  };
}

function opts(over: Partial<SelectOptions> = {}): SelectOptions {
  return {
    perTradeCapUsdc: 5,
    remainingBudgetUsdc: 10,
    balanceUsdc: 20,
    ...over,
  };
}

describe("selectOpportunities filtering (放弃理由)", () => {
  it("selects a healthy positive-EV candidate", () => {
    const r = selectOpportunities([candidate()], opts());
    expect(r.selected).toHaveLength(1);
    expect(r.skipped).toHaveLength(0);
    expect(r.selected[0].stakeUsdc).toBe(0.4);
  });

  it("skips EV ≤ 0", () => {
    const r = selectOpportunities([candidate({ ev: 0 })], opts());
    expect(r.selected).toHaveLength(0);
    expect(r.skipped[0].reason).toContain("EV ≤ 0");
  });

  it("skips when a dependent source is unhealthy (健康度 < 0.6)", () => {
    const r = selectOpportunities([candidate({
      sourceHealth: [{ name: "coingecko", healthy: false, score: 0.4 }],
    })], opts());
    expect(r.skipped[0].reason).toBe("源健康度低于 0.6（coingecko）");
  });

  it("skips when cost exceeds the per-trade cap (单笔上限)", () => {
    const r = selectOpportunities([candidate({ costUsdc: 6 })], opts({ perTradeCapUsdc: 5 }));
    expect(r.skipped[0].reason).toBe("超出单笔上限");
  });

  it("skips when balance is insufficient (余额不足)", () => {
    const r = selectOpportunities([candidate({ costUsdc: 2 })], opts({ balanceUsdc: 1 }));
    expect(r.skipped[0].reason).toBe("余额不足");
  });

  it("skips paused kinds (连亏 3 单被止损暂停)", () => {
    const r = selectOpportunities([candidate()], opts({ pausedKinds: ["data_brief"] }));
    expect(r.skipped[0].reason).toBe("止损暂停该任务类型");
  });

  it("flags but does not skip insufficient samples by default; can hard-skip via option", () => {
    const flagged = selectOpportunities([candidate({ sampleInsufficient: true })], opts());
    expect(flagged.selected).toHaveLength(1);
    expect(flagged.selected[0].sampleInsufficient).toBe(true);
    const hard = selectOpportunities([candidate({ sampleInsufficient: true })], opts({ allowInsufficientSamples: false }));
    expect(hard.skipped[0].reason).toContain("样本不足");
  });

  it("accumulates multiple reasons separated by ；", () => {
    const r = selectOpportunities([candidate({ ev: -1, costUsdc: 9 })], opts({ perTradeCapUsdc: 5, balanceUsdc: 3 }));
    expect(r.skipped[0].reason).toBe("EV ≤ 0；超出单笔上限；余额不足");
  });
});

describe("ordering and budget", () => {
  it("picks in score order until the budget runs out, skipping the rest with 预算不足", () => {
    // 预算 10 → 35% = 3.5；三个单各需 3.4 ≤ 3.5 仓位，前两单消耗 6.8，第三单超剩余 3.2
    const a = candidate({ id: "a", title: "A", score: 3, costUsdc: 3.4 });
    const b = candidate({ id: "b", title: "B", score: 2, costUsdc: 3.4 });
    const c = candidate({ id: "c", title: "C", score: 1, costUsdc: 3.4 });
    const r = selectOpportunities([a, b, c], opts({ remainingBudgetUsdc: 10, perTradeCapUsdc: 5 }));
    expect(r.selected.map((s) => s.id)).toEqual(["a", "b"]);
    expect(r.skipped).toContainEqual({ id: "c", title: "C", reason: "预算不足" });
  });

  it("spends exactly what candidates cost, never more than the budget", () => {
    // 预算 7.8 → 35% = 2.73；四个候选各 2.6，选满前 3 个（7.8）刚好花尽，第 4 个因超预算放弃
    const list = [
      candidate({ id: "x", title: "X", costUsdc: 2.6, score: 4 }),
      candidate({ id: "y", title: "Y", costUsdc: 2.6, score: 3 }),
      candidate({ id: "z", title: "Z", costUsdc: 2.6, score: 2 }),
      candidate({ id: "w", title: "W", costUsdc: 2.6, score: 1 }),
    ];
    const r = selectOpportunities(list, opts({ remainingBudgetUsdc: 7.8, perTradeCapUsdc: 5 }));
    expect(r.selected.map((s) => s.id)).toEqual(["x", "y", "z"]);
    expect(r.skipped).toContainEqual({ id: "w", title: "W", reason: "预算不足" });
  });
});

describe("position sizing (仓位)", () => {
  it("stake = min(单笔上限, 今日预算 35%)", () => {
    // 上限 5，预算 10 → 35% = 3.5 → min = 3.5
    const r = selectOpportunities([candidate({ costUsdc: 3.5 })], opts());
    expect(BUDGET_FRACTION).toBe(0.35);
    expect(r.selected[0].stakeUsdc).toBe(3.5);
    // 成本超过仓位 → 不执行
    const tooBig = selectOpportunities([candidate({ costUsdc: 3.6 })], opts());
    expect(tooBig.selected).toHaveLength(0);
    expect(tooBig.skipped[0].reason).toBe("仓位小于成本");
  });

  it("caps the stake at the per-trade cap when 35% of budget is larger", () => {
    // 预算 100 → 35% = 35，上限 5 → min = 5
    const r = selectOpportunities([candidate({ costUsdc: 5 })], opts({ remainingBudgetUsdc: 100 }));
    expect(r.selected).toHaveLength(1);
    const over = selectOpportunities([candidate({ costUsdc: 5.1 })], opts({ remainingBudgetUsdc: 100 }));
    expect(over.selected).toHaveLength(0);
  });

  it("halves the stake after 2 consecutive losses of the same kind (连亏减半)", () => {
    const r = selectOpportunities([candidate({ costUsdc: 1 })], opts({
      consecutiveLossesByKind: { data_brief: 2 },
      remainingBudgetUsdc: 10,
      balanceUsdc: 10,
    }));
    expect(r.selected[0].stakeHalved).toBe(true);
    // 实际动用 1，连亏减半标记为 true（上限从 3.5 降到 1.75，成本 1 能通过）
    expect(r.selected[0].stakeUsdc).toBe(1);
  });

  it("does not halve on the first loss", () => {
    const r = selectOpportunities([candidate({ costUsdc: 1 })], opts({ consecutiveLossesByKind: { data_brief: 1 } }));
    expect(r.selected[0].stakeHalved).toBe(false);
  });

  it("rejects when the halved stake is below cost", () => {
    // 35% × 2 = 0.7 → 减半 0.35 < 成本 1
    const r = selectOpportunities([candidate({ costUsdc: 1 })], opts({ remainingBudgetUsdc: 2 }));
    expect(r.selected).toHaveLength(0);
    expect(r.skipped[0].reason).toBe("仓位小于成本");
  });
});
