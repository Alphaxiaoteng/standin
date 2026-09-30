import { describe, expect, it } from "vitest";
import { verifyBrief, verifySpreadWatch, type BriefSnapshot } from "./verify";

const DELIVERED = 1_000_000;

function quote(ageMs: number, usd: number) {
  return { usd, fetchedAt: DELIVERED - ageMs };
}

function brief(over: Partial<BriefSnapshot> = {}): BriefSnapshot {
  return {
    btc: { coingecko: quote(1_000, 10_000), coinbase: quote(1_000, 10_000) },
    eth: { coingecko: quote(1_000, 2_000), coinbase: quote(1_000, 2_000) },
    headlines: ["a", "b", "c", "d", "e"],
    hnBoard: ["a", "b", "c", "d", "e", "f"],
    ...over,
  };
}

/** 中点价 10000 时，价差基点 = |高-低|。 */
function btcAtSpread(bps: number) {
  const mid = 10_000;
  const half = (bps / 10_000) * mid / 2;
  return {
    coingecko: quote(1_000, mid - half),
    coinbase: quote(1_000, mid + half),
  };
}

describe("verifyBrief", () => {
  it("passes a complete fresh brief inside the spread band", () => {
    const out = verifyBrief(brief(), DELIVERED);
    expect(out.passed).toBe(true);
    expect(out.reasons).toEqual([]);
  });

  it("passes when every price is 59 seconds old", () => {
    const snap = brief({
      btc: { coingecko: quote(59_000, 10_000), coinbase: quote(59_000, 10_000) },
      eth: { coingecko: quote(59_000, 2_000), coinbase: quote(59_000, 2_000) },
    });
    expect(verifyBrief(snap, DELIVERED).passed).toBe(true);
  });

  it("passes when every price is exactly 60 seconds old", () => {
    const snap = brief({
      btc: { coingecko: quote(60_000, 10_000), coinbase: quote(60_000, 10_000) },
      eth: { coingecko: quote(60_000, 2_000), coinbase: quote(60_000, 2_000) },
    });
    expect(verifyBrief(snap, DELIVERED).passed).toBe(true);
  });

  it("fails at 61 seconds and names the age", () => {
    const snap = brief({
      btc: { coingecko: quote(61_000, 10_000), coinbase: quote(1_000, 10_000) },
    });
    const out = verifyBrief(snap, DELIVERED);
    expect(out.passed).toBe(false);
    expect(out.reasons.some((r) => r.includes("61"))).toBe(true);
  });

  it("passes at 50 bps and on the side below, and fails on the side above", () => {
    expect(verifyBrief(brief({ btc: btcAtSpread(49.9) }), DELIVERED).passed).toBe(true);
    expect(verifyBrief(brief({ btc: btcAtSpread(50) }), DELIVERED).passed).toBe(true);
    const over = verifyBrief(brief({ btc: btcAtSpread(50.1) }), DELIVERED);
    expect(over.passed).toBe(false);
    expect(over.reasons.some((r) => r.includes("基点"))).toBe(true);
  });

  it("fails when a headline is not on the board", () => {
    const out = verifyBrief(brief({ headlines: ["a", "b", "c", "d", "missing"] }), DELIVERED);
    expect(out.passed).toBe(false);
    expect(out.reasons.some((r) => r.includes("missing"))).toBe(true);
  });

  it("fails when a price field is missing", () => {
    const snap = brief();
    snap.eth.coinbase = { usd: Number.NaN, fetchedAt: DELIVERED };
    const out = verifyBrief(snap, DELIVERED);
    expect(out.passed).toBe(false);
  });
});

describe("verifySpreadWatch", () => {
  const window = { windowStart: 0, windowEnd: 60_000, thresholdBps: 50 };

  it("fails when the spread never crosses the threshold", () => {
    const out = verifySpreadWatch({
      ...window,
      samples: [{ spreadBps: 50, at: 10_000 }],
      notifiedAt: 10_000,
    });
    expect(out.passed).toBe(false);
    expect(out.reasons.some((r) => r.includes("未超过阈值"))).toBe(true);
  });

  it("passes when a sample exceeds the threshold and notice lands in the window", () => {
    const out = verifySpreadWatch({
      ...window,
      samples: [{ spreadBps: 50.1, at: 10_000 }],
      notifiedAt: 12_000,
    });
    expect(out.passed).toBe(true);
  });

  it("fails when the notice is outside the window", () => {
    const out = verifySpreadWatch({
      ...window,
      samples: [{ spreadBps: 80, at: 10_000 }],
      notifiedAt: 70_000,
    });
    expect(out.passed).toBe(false);
    expect(out.reasons.some((r) => r.includes("未按时通知"))).toBe(true);
  });
});
