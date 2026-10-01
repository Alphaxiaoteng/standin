import { describe, expect, it } from "vitest";
import { findPayment, timestampToBlock, type MinimalClient } from "./settlementWatcher";

const BUYER = "0x1111111111111111111111111111111111111111" as const;
const AGENT = "0x2222222222222222222222222222222222222222" as const;
const SINCE = 1_700_000_000_000; // Unix ms

interface Log {
  value: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
}

/** 简单链模型：每块 12 秒，块 0 时间戳 = SINCE - 1000*12s；日志按块号放置 */
function fakeClient(logs: Log[], opts: { failGetLogs?: boolean } = {}): MinimalClient {
  const blockTs = (bn: bigint) => BigInt(Math.floor(SINCE / 1000) - 1000 + Number(bn) * 12);
  return {
    async getBlockNumber() {
      return 500n;
    },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return { timestamp: blockTs(blockNumber) };
    },
    async getLogs(args) {
      if (opts.failGetLogs) throw new Error("RPC 429 rate limited");
      return logs
        .filter((l) => l.blockNumber >= args.fromBlock && l.blockNumber <= args.toBlock)
        .filter((l) => l.from.toLowerCase() === args.args.from.toLowerCase() && l.to.toLowerCase() === args.args.to.toLowerCase())
        .map((l) => ({ args: { value: l.value }, blockNumber: l.blockNumber, transactionHash: l.txHash }));
    },
  };
}

function log(over: Partial<Log> = {}): Log {
  return {
    value: 2_000_000n, // 2 USDC
    blockNumber: 300n, // 时间戳 = SINCE - 1000s + 3600s = SINCE + 2600s > SINCE
    txHash: "0xabc0000000000000000000000000000000000000000000000000000000000001",
    from: BUYER,
    to: AGENT,
    ...over,
  };
}

const Q = {
  buyer: BUYER,
  agent: AGENT,
  minValueUsdc: 1.2,
  since: SINCE,
};

describe("findPayment（链上付款回执匹配）", () => {
  it("finds a matching transfer and returns txHash + block", async () => {
    const r = await findPayment({ ...Q, client: fakeClient([log()]) });
    expect(r.status).toBe("found");
    if (r.status !== "found") return;
    expect(r.txHash).toBe(log().txHash);
    expect(r.blockNumber).toBe(300n);
    expect(r.value).toBe(2_000_000n);
  });

  it("returns not_found when the amount is below the reward", async () => {
    const r = await findPayment({ ...Q, client: fakeClient([log({ value: 500_000n })]) }); // 0.5 USDC < 1.2
    expect(r.status).toBe("not_found");
  });

  it("returns not_found when the payer differs (from is filtered)", async () => {
    const r = await findPayment({
      ...Q,
      client: fakeClient([log({ from: "0x9999999999999999999999999999999999999999" })]),
    });
    expect(r.status).toBe("not_found");
  });

  it("returns not_found when the transfer predates acceptance", async () => {
    // 块 0 时间戳 = SINCE - 12000s，块 50 = SINCE - 11400s：过早
    const r = await findPayment({
      ...Q,
      client: fakeClient([log({ blockNumber: 50n, txHash: "0xabc02" })]),
    });
    expect(r.status).toBe("not_found");
  });

  it("returns unknown (never not_found) when the RPC fails", async () => {
    const r = await findPayment({ ...Q, client: fakeClient([], { failGetLogs: true }) });
    expect(r.status).toBe("unknown");
    if (r.status !== "unknown") return;
    expect(r.reason).toContain("429");
  });

  it("maps a timestamp to the first block at or after it", async () => {
    const client = fakeClient([]);
    const bn = await timestampToBlock(client, SINCE);
    const ts = (await client.getBlock({ blockNumber: bn })).timestamp;
    const prev = bn > 0n ? (await client.getBlock({ blockNumber: bn - 1n })).timestamp : null;
    expect(ts >= SINCE / 1000).toBe(true);
    if (prev !== null) expect(prev < SINCE / 1000).toBe(true);
  });

  it("handles non-whole-second timestamps without BigInt errors", async () => {
    // 回归：1790245352.396 这类毫秒精度时间戳曾被直接 BigInt() 转换而抛错
    const client = fakeClient([]);
    const bn = await timestampToBlock(client, SINCE + 396);
    expect(bn).toBeTypeOf("bigint");
  });
});
