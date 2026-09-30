import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW,
  HEALTHY_THRESHOLD,
  LATENCY_PENALTY_FLOOR,
  RATE_LIMIT_BACKOFF_BASE_MS,
  SourceHealthTracker,
  TIMEOUT_STREAK_LIMIT,
  allSourceHealth,
  latencyFactor,
  recordFailure,
  recordSuccess,
  resetHealthRegistry,
  sourceHealth,
} from "./health";

describe("latencyFactor", () => {
  it("is 1 within target latency", () => {
    expect(latencyFactor(2_999, 3_000)).toBe(1);
    expect(latencyFactor(0, 3_000)).toBe(1);
  });

  it("decays beyond target and never drops below the floor", () => {
    expect(latencyFactor(6_000, 3_000)).toBeCloseTo(0.5, 4);
    expect(latencyFactor(30_000, 3_000)).toBe(LATENCY_PENALTY_FLOOR);
  });
});

describe("SourceHealthTracker scoring", () => {
  it("starts healthy on cold start (no samples)", () => {
    const t = new SourceHealthTracker("coingecko");
    const h = t.health();
    expect(h.samples).toBe(0);
    expect(h.score).toBe(1);
    expect(h.healthy).toBe(true);
  });

  it("stays healthy when everything succeeds", () => {
    const t = new SourceHealthTracker("coingecko");
    for (let i = 0; i < 5; i++) t.record({ ok: true, latencyMs: 100 }, i);
    const h = t.health();
    expect(h.healthy).toBe(true);
    expect(h.score).toBe(1);
    expect(h.failureRate).toBe(0);
  });

  it("drops below 0.6 once failure rate exceeds 40%", () => {
    const t = new SourceHealthTracker("coingecko");
    // 10 samples, 5 failures → failureRate 0.5 → score 0.5 < 0.6
    for (let i = 0; i < 10; i++) t.record({ ok: i % 2 === 0, latencyMs: 100, error: "HTTP 500" }, i);
    const h = t.health();
    expect(h.failureRate).toBe(0.5);
    expect(h.score).toBeLessThan(HEALTHY_THRESHOLD);
    expect(h.healthy).toBe(false);
  });

  it("stays healthy with a few failures (success rate 90%)", () => {
    const t = new SourceHealthTracker("coingecko");
    for (let i = 0; i < 10; i++) t.record({ ok: i !== 0, latencyMs: 100, error: "HTTP 500" }, i);
    expect(t.health().healthy).toBe(true);
    expect(t.health().score).toBeCloseTo(0.9, 4);
  });

  it("applies latency discount: fast failures tolerated less when slow", () => {
    const t = new SourceHealthTracker("coingecko");
    // 全成功但全部慢 6 倍 → 折扣 0.5 → score 0.5 → 不健康
    for (let i = 0; i < 5; i++) t.record({ ok: true, latencyMs: 18_000 }, i);
    const h = t.health();
    expect(h.score).toBe(LATENCY_PENALTY_FLOOR);
    expect(h.healthy).toBe(false);
  });

  it("keeps only the sliding window", () => {
    const t = new SourceHealthTracker("coingecko", { window: 5 });
    // 先 4 次失败，再 5 次成功 → 窗口里只剩 5 次成功
    for (let i = 0; i < 4; i++) t.record({ ok: false, latencyMs: 10, error: "HTTP 500" }, i);
    for (let i = 4; i < 9; i++) t.record({ ok: true, latencyMs: 10 }, i);
    const h = t.health();
    expect(h.samples).toBe(5);
    expect(h.failureRate).toBe(0);
    expect(h.healthy).toBe(true);
  });

  it("defaults window to 20 samples", () => {
    const t = new SourceHealthTracker("coingecko");
    for (let i = 0; i < DEFAULT_WINDOW + 10; i++) t.record({ ok: true, latencyMs: 10 }, i);
    expect(t.health().samples).toBe(DEFAULT_WINDOW);
  });
});

describe("timeout streak and rate limiting", () => {
  it("marks unhealthy after 3 consecutive timeouts even if score is high", () => {
    const t = new SourceHealthTracker("coingecko");
    for (let i = 0; i < 9; i++) t.record({ ok: true, latencyMs: 10 }, i);
    t.record({ ok: false, latencyMs: 8_000, error: "超时" });
    t.record({ ok: false, latencyMs: 8_000, error: "超时" });
    const beforeThird = t.health();
    expect(beforeThird.consecutiveTimeouts).toBe(2);
    expect(beforeThird.healthy).toBe(true);
    t.record({ ok: false, latencyMs: 8_000, error: "超时" });
    const h = t.health();
    expect(h.consecutiveTimeouts).toBe(TIMEOUT_STREAK_LIMIT);
    expect(h.healthy).toBe(false);
  });

  it("resets the timeout streak after a success (healthy once score clears 0.6)", () => {
    const t = new SourceHealthTracker("coingecko", { window: 4 });
    for (let i = 0; i < 3; i++) t.record({ ok: false, latencyMs: 8_000, error: "超时" }, i);
    expect(t.health().healthy).toBe(false);
    expect(t.health().consecutiveTimeouts).toBe(3);
    // 窗口=4：3 次成功后仍残留 1 个超时样本 → failureRate 1/4、延迟折扣 (3+0.5)/4 → score 0.6563 ≥ 0.6
    for (let i = 0; i < 3; i++) t.record({ ok: true, latencyMs: 10 }, 10 + i);
    const h = t.health();
    expect(h.consecutiveTimeouts).toBe(0);
    expect(h.score).toBeCloseTo(0.6563, 4);
    expect(h.healthy).toBe(true);
    // 第 4 次成功把最后的超时样本挤出窗口 → 完全恢复
    t.record({ ok: true, latencyMs: 10 }, 20);
    expect(t.health().score).toBe(1);
  });

  it("backs off exponentially on repeated 429 and reports rateLimited", () => {
    const t = new SourceHealthTracker("coingecko");
    t.record({ ok: false, latencyMs: 10, error: "源限流" }, 0);
    const first = t.health(1);
    expect(first.rateLimited).toBe(true);
    expect(first.retryAfterAt).toBe(RATE_LIMIT_BACKOFF_BASE_MS);
    t.record({ ok: false, latencyMs: 10, error: "源限流" }, 100);
    const second = t.health(200);
    expect(second.retryAfterAt).toBe(100 + RATE_LIMIT_BACKOFF_BASE_MS * 2);
  });

  it("clears rate limit once the backoff window passes", () => {
    const t = new SourceHealthTracker("coingecko");
    t.record({ ok: false, latencyMs: 10, error: "源限流" }, 0);
    expect(t.health(RATE_LIMIT_BACKOFF_BASE_MS - 1).rateLimited).toBe(true);
    expect(t.health(RATE_LIMIT_BACKOFF_BASE_MS).rateLimited).toBe(false);
  });

  it("treats HTTP 429 error string as rate limiting", () => {
    const t = new SourceHealthTracker("coingecko");
    t.record({ ok: false, latencyMs: 10, error: "HTTP 429" }, 0);
    expect(t.health(1).rateLimited).toBe(true);
  });
});

describe("shared registry", () => {
  it("accumulates per-source stats across recordSuccess/recordFailure", () => {
    resetHealthRegistry();
    recordSuccess("coinbase", 100, 1);
    recordFailure("coinbase", "HTTP 500", 100, 2);
    recordSuccess("coinbase", 100, 3);
    const h = sourceHealth("coinbase");
    expect(h.samples).toBe(3);
    expect(h.failureRate).toBeCloseTo(1 / 3, 4);
    expect(h.healthy).toBe(true);
  });

  it("lists all data sources", () => {
    resetHealthRegistry();
    recordSuccess("coingecko", 100, 1);
    const all = allSourceHealth();
    expect(all.map((s) => s.name).sort()).toEqual(["coinbase", "coingecko", "hn"]);
    expect(all.every((s) => s.healthy)).toBe(true);
  });
});
