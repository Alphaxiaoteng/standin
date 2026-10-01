import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COST_USDC,
  DEFAULT_WINDOW_SEC,
  DEMO_BUYERS,
  addBounty,
  getBounty,
  listBounties,
  resetBountyCache,
  updateBountyStatus,
  updateBountySettlement,
  type Bounty,
} from "./bounties";

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), "bounties-")), "bounties.json");
}

const T0 = 1_760_000_000_000;

function fresh(over: { path?: string } = {}) {
  resetBountyCache();
  return over;
}

describe("addBounty", () => {
  it("creates a data_brief bounty with demo buyer defaults", () => {
    const path = tmpPath();
    fresh({ path });
    const b = addBounty({ kind: "data_brief", rewardUsdc: 2, now: T0 }, { path });
    expect(b.id).toMatch(/^bnty-/);
    expect(b.kind).toBe("data_brief");
    expect(b.title).toContain("双源价格简报");
    expect(b.buyer).toBe(DEMO_BUYERS[0]);
    expect(b.buyerType).toBe("demo");
    expect(b.status).toBe("open");
    expect(b.rewardUsdc).toBe(2);
    expect(b.costUsdc).toBe(DEFAULT_COST_USDC.data_brief);
    expect(b.windowSec).toBe(DEFAULT_WINDOW_SEC.data_brief);
    expect(b.toleranceBps).toBeNull();
    expect(b.createdAt).toBe(T0);
    expect(b.expiresAt).toBe(T0 + DEFAULT_WINDOW_SEC.data_brief * 1_000);
  });

  it("defaults spread_watch tolerance to 50bps and window to 600s", () => {
    const path = tmpPath();
    fresh({ path });
    const b = addBounty({ kind: "spread_watch", rewardUsdc: 1.5, now: T0 }, { path });
    expect(b.toleranceBps).toBe(50);
    expect(b.windowSec).toBe(600);
    expect(b.expiresAt).toBe(T0 + 600_000);
  });

  it("marks third-party buyer and honours buyerName", () => {
    const path = tmpPath();
    fresh({ path });
    const b = addBounty({ kind: "data_brief", rewardUsdc: 3, buyerType: "third_party", buyerName: "Alice Ventures" }, { path });
    expect(b.buyerType).toBe("third_party");
    expect(b.buyer).toBe("Alice Ventures");
  });

  it("persists to disk and survives a cache reset (重启数据仍在)", () => {
    const path = tmpPath();
    fresh({ path });
    const b = addBounty({ kind: "data_brief", rewardUsdc: 2, now: T0 }, { path });
    expect(existsSync(path)).toBe(true);
    resetBountyCache();
    const reloaded = getBounty(b.id, { path });
    expect(reloaded).not.toBeNull();
    expect(reloaded?.rewardUsdc).toBe(2);
    expect(reloaded?.buyer).toBe(DEMO_BUYERS[0]);
  });

  it("writes valid JSON on disk", () => {
    const path = tmpPath();
    fresh({ path });
    addBounty({ kind: "spread_watch", rewardUsdc: 1, now: T0 }, { path });
    const raw = JSON.parse(readFileSync(path, "utf8")) as { bounties: Bounty[]; seq: number };
    expect(raw.bounties).toHaveLength(1);
    expect(raw.seq).toBe(1);
    expect(raw.bounties[0].kind).toBe("spread_watch");
  });
});

describe("listBounties", () => {
  it("returns bounties newest first (createdAt 倒序)", () => {
    const path = tmpPath();
    fresh({ path });
    addBounty({ kind: "data_brief", rewardUsdc: 1, now: T0, id: "old" }, { path });
    addBounty({ kind: "spread_watch", rewardUsdc: 1, now: T0 + 5_000, id: "new" }, { path });
    addBounty({ kind: "data_brief", rewardUsdc: 1, now: T0 + 2_000, id: "mid" }, { path });
    const list = listBounties({ path });
    expect(list.map((b) => b.id)).toEqual(["new", "mid", "old"]);
  });

  it("returns an empty list, not fake data, when nothing published", () => {
    const path = tmpPath();
    fresh({ path });
    expect(listBounties({ path })).toEqual([]);
  });

  it("returns defensive copies (mutation does not corrupt the store)", () => {
    const path = tmpPath();
    fresh({ path });
    addBounty({ kind: "data_brief", rewardUsdc: 1, now: T0 }, { path });
    const list = listBounties({ path });
    list[0].status = "done";
    expect(listBounties({ path })[0].status).toBe("open");
  });
});

describe("updateBountyStatus", () => {
  it("updates status and persists it", () => {
    const path = tmpPath();
    fresh({ path });
    const b = addBounty({ kind: "data_brief", rewardUsdc: 1, now: T0 }, { path });
    const updated = updateBountyStatus(b.id, "claimed", { path });
    expect(updated?.status).toBe("claimed");
    resetBountyCache();
    expect(getBounty(b.id, { path })?.status).toBe("claimed");
  });

  it("returns null for unknown id", () => {
    const path = tmpPath();
    fresh({ path });
    expect(updateBountyStatus("nope", "done", { path })).toBeNull();
  });
});

describe("storage robustness", () => {
  it("drops malformed persisted rows instead of crashing", () => {
    const path = tmpPath();
    fresh({ path });
    addBounty({ kind: "data_brief", rewardUsdc: 1, now: T0, id: "good" }, { path });
    resetBountyCache();
    // 手工写坏一行
    const raw = JSON.parse(readFileSync(path, "utf8")) as { bounties: unknown[] };
    raw.bounties.push({ kind: "nope" }, null, { kind: "data_brief" });
    writeFileSync(path, JSON.stringify(raw), "utf8");
    const list = listBounties({ path });
    expect(list.map((b) => b.id)).toEqual(["good"]);
  });

  it("starts from an empty store when the file is corrupt JSON", () => {
    const path = tmpPath();
    writeFileSync(path, "{not json", "utf8");
    resetBountyCache();
    expect(listBounties({ path })).toEqual([]);
    const b = addBounty({ kind: "data_brief", rewardUsdc: 1 }, { path });
    expect(b.id).toMatch(/^bnty-/);
  });
});

describe("T5 结算字段（settlement / buyerAddress / payoutTxHash）", () => {
  it("defaults settlement by buyer type when reviving legacy files", () => {
    const path = tmpPath();
    writeFileSync(path, JSON.stringify({
      version: 1, seq: 2,
      bounties: [
        { id: "legacy-demo", kind: "data_brief", rewardUsdc: 1, buyerType: "demo", createdAt: T0, expiresAt: T0 + 1000 },
        { id: "legacy-3p", kind: "data_brief", rewardUsdc: 1, buyerType: "third_party", createdAt: T0, expiresAt: T0 + 1000 },
      ],
    }), "utf8");
    resetBountyCache();
    const list = listBounties({ path });
    const byId = Object.fromEntries(list.map((b) => [b.id, b]));
    expect(byId["legacy-demo"].settlement).toBe("confirmed");
    expect(byId["legacy-3p"].settlement).toBe("pending");
  });

  it("addBounty stamps third-party buyerAddress and pending settlement", () => {
    const path = tmpPath();
    fresh({ path });
    const b = addBounty({
      kind: "data_brief", rewardUsdc: 1.5,
      buyerType: "third_party", buyerName: "COMMUNITY BUYER",
      buyerAddress: "0x1111111111111111111111111111111111111111",
    }, { path });
    expect(b.buyerAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(b.settlement).toBe("pending");
    const demo = addBounty({ kind: "data_brief", rewardUsdc: 1, buyerAddress: "0xignored" }, { path });
    expect(demo.buyerAddress).toBeUndefined();
  });

  it("updateBountySettlement persists payout receipt", () => {
    const path = tmpPath();
    fresh({ path });
    const b = addBounty({ kind: "data_brief", rewardUsdc: 1, id: "pay-me", buyerType: "third_party" }, { path });
    const updated = updateBountySettlement("pay-me", {
      settlement: "confirmed", status: "done",
      payoutTxHash: "0xdead", payoutBlockNumber: 12345,
    }, { path });
    expect(updated).toMatchObject({ settlement: "confirmed", status: "done", payoutTxHash: "0xdead", payoutBlockNumber: 12345 });
    resetBountyCache();
    expect(getBounty("pay-me", { path })).toMatchObject({ settlement: "confirmed", payoutTxHash: "0xdead" });
    void b;
  });
});
