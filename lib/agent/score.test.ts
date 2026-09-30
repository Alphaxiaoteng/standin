import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLES,
  RISK_PENALTY_USDC,
  coldStartPosterior,
  bountySourceHealth,
  observe,
  scoreOpportunity,
  sourcesForKind,
  type ScoreInput,
} from "./score";

const HEALTHY = { name: "coingecko", score: 1, healthy: true };

function input(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    kind: "data_brief",
    rewardUsdc: 2,
    costUsdc: 0.4,
    sourceHealth: [HEALTHY, { name: "coinbase", score: 1, healthy: true }, { name: "hn", score: 1, healthy: true }],
    posterior: { alpha: 6, beta: 2 },
    samples: 6,
    ...over,
  };
}

describe("scoreOpportunity", () => {
  it("computes EV = p·h·reward − cost − riskPenalty and score = EV/cost", () => {
    const r = scoreOpportunity(input());
    // p = 6/8 = 0.75, h = 1
    expect(r.p).toBe(0.75);
    expect(r.h).toBe(1);
    expect(r.ev).toBeCloseTo(0.75 * 2 - 0.4 - RISK_PENALTY_USDC.data_brief, 5);
    expect(r.score).toBeCloseTo(r.ev / 0.4, 5);
    expect(r.risk).toBe("low");
    expect(r.sampleInsufficient).toBe(false);
  });

  it("cold start: α=β=1 → p forced to 0.5 and flagged 样本不足", () => {
    const r = scoreOpportunity(input({ posterior: coldStartPosterior(), samples: 0 }));
    expect(r.p).toBe(0.5);
    expect(r.sampleInsufficient).toBe(true);
    // 样本不足不是 p=0.75 的后验均值
    expect(r.ev).toBeCloseTo(0.5 * 2 - 0.4 - RISK_PENALTY_USDC.data_brief, 5);
  });

  it("infers sample count from the posterior when samples omitted", () => {
    // α+β−2 = 6+2−2 = 6 ≥ 5 → 足够
    const enough = scoreOpportunity(input({ samples: undefined }));
    expect(enough.sampleInsufficient).toBe(false);
    // α+β−2 = 2+2−2 = 2 < 5 → 不足，即使后验均值高达 0.5（冷启动对称）
    const few = scoreOpportunity(input({ posterior: { alpha: 2, beta: 2 }, samples: undefined }));
    expect(few.sampleInsufficient).toBe(true);
    expect(few.p).toBe(0.5);
    // α=4,β=1 → 3 个样本、均值 0.8，仍按不足处理
    const biased = scoreOpportunity(input({ posterior: { alpha: 4, beta: 1 }, samples: undefined }));
    expect(biased.sampleInsufficient).toBe(true);
    expect(biased.p).toBe(0.5);
  });

  it(`marks 样本不足 exactly at ${MIN_SAMPLES - 1} samples but not at ${MIN_SAMPLES}`, () => {
    const four = scoreOpportunity(input({ posterior: { alpha: 4, beta: 1 }, samples: 4 }));
    expect(four.sampleInsufficient).toBe(true);
    const five = scoreOpportunity(input({ posterior: { alpha: 5, beta: 1 }, samples: 5 }));
    expect(five.sampleInsufficient).toBe(false);
    expect(five.p).toBeCloseTo(5 / 6, 4);
  });

  it("multiplies dependent source health into h", () => {
    const r = scoreOpportunity(input({
      sourceHealth: [{ name: "coingecko", score: 0.9, healthy: true }, { name: "coinbase", score: 0.5, healthy: false }],
    }));
    expect(r.h).toBeCloseTo(0.45, 4);
    expect(r.ev).toBeCloseTo(0.75 * 0.45 * 2 - 0.4 - RISK_PENALTY_USDC.data_brief, 5);
  });

  it("penalises spread_watch as medium risk", () => {
    const r = scoreOpportunity(input({ kind: "spread_watch", rewardUsdc: 1, costUsdc: 0.25 }));
    expect(r.risk).toBe("medium");
    expect(r.ev).toBeCloseTo(0.75 * 1 - 0.25 - RISK_PENALTY_USDC.spread_watch, 5);
  });

  it("yields negative EV when cost exceeds expected reward", () => {
    const r = scoreOpportunity(input({ rewardUsdc: 0.5 }));
    expect(r.ev).toBeLessThan(0);
    expect(r.score).toBeLessThan(0);
  });

  it("score is Infinity for a zero-cost opportunity (排最前)", () => {
    const r = scoreOpportunity(input({ costUsdc: 0 }));
    expect(r.score).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("observe / posterior", () => {
  it("starts at α=β=1", () => {
    expect(coldStartPosterior()).toEqual({ alpha: 1, beta: 1 });
  });

  it("counts successes into alpha and failures into beta without mutating input", () => {
    const post = coldStartPosterior();
    const afterWin = observe(post, true);
    expect(afterWin).toEqual({ alpha: 2, beta: 1 });
    expect(observe(afterWin, false)).toEqual({ alpha: 2, beta: 2 });
    expect(post).toEqual({ alpha: 1, beta: 1 });
  });
});

describe("source helpers", () => {
  it("maps kinds to dependent sources", () => {
    expect(sourcesForKind("data_brief")).toEqual(["coingecko", "coinbase", "hn"]);
    expect(sourcesForKind("spread_watch")).toEqual(["coingecko", "coinbase"]);
  });

  it("bountySourceHealth maps names through the health lookup", () => {
    const health = bountySourceHealth({ kind: "spread_watch" }, (name) => ({ name, score: 0.7, healthy: true }));
    expect(health).toEqual([
      { name: "coingecko", score: 0.7, healthy: true },
      { name: "coinbase", score: 0.7, healthy: true },
    ]);
  });
});
