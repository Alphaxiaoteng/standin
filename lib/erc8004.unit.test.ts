import { describe, it, expect } from "vitest";
import type { WalletClient } from "viem";
import {
  giveFeedbackFromBuyer,
  getIdentityStatus,
  getReputationSummary,
  registerAgent,
  storedIdentity,
  type ReceiptClient,
  type SummaryClient,
} from "./erc8004";
import { setKv } from "./ledger";

const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1" as const;

const ERC721_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function fakeWallet(): { wallet: WalletClient; calls: unknown[] } {
  const calls: unknown[] = [];
  const wallet = {
    account: { address: OWNER },
    writeContract: async (args: unknown) => {
      calls.push(args);
      return "0xdeadbeef" as `0x${string}`;
    },
  } as unknown as WalletClient;
  return { wallet, calls };
}

function receiptClient(tokenId = 7n): ReceiptClient {
  return {
    waitForTransactionReceipt: async () => ({
      logs: [{ topics: [ERC721_TRANSFER_TOPIC, "0x0", "0x0", `0x${tokenId.toString(16).padStart(64, "0")}`] }],
    }),
  };
}

describe("ERC-8004 registerAgent", () => {
  it("returns not-configured without a wallet", async () => {
    const r = await registerAgent();
    expect(r).toMatchObject({ ok: false, reason: "not-configured" });
  });

  it("reports chain-error when the receipt has no mint log (须先于成功注册跑)", async () => {
    const { wallet } = fakeWallet();
    const empty: ReceiptClient = {
      waitForTransactionReceipt: async () => ({ logs: [] }),
    };
    const r = await registerAgent({ walletClient: wallet, publicClient: empty });
    expect(r).toMatchObject({ ok: false, reason: "chain-error" });
    expect(storedIdentity()).toBeNull();
  });

  it("registers once, extracts tokenId from the mint log, persists and is idempotent", async () => {
    const { wallet, calls } = fakeWallet();
    const first = await registerAgent({ walletClient: wallet, publicClient: receiptClient(7n) });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);
    expect(first.record.agentId).toBe(7);
    expect(first.record.registerTxHash).toBe("0xdeadbeef");
    expect(storedIdentity()?.agentId).toBe(7);

    // 幂等：不再发起链上交易
    const second = await registerAgent({ walletClient: wallet });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("ERC-8004 giveFeedbackFromBuyer", () => {
  it("returns not-configured without a buyer wallet", async () => {
    const r = await giveFeedbackFromBuyer({ agentId: 7, score: 100 });
    expect(r).toMatchObject({ ok: false, reason: "not-configured" });
  });

  it("submits feedback with valueDecimals=0 and empty evidence hash", async () => {
    const { wallet, calls } = fakeWallet();
    const r = await giveFeedbackFromBuyer(
      { agentId: 7, score: 100, tag1: "data_brief", tag2: "settlement-confirmed" },
      { walletClient: wallet, publicClient: receiptClient() },
    );
    expect(r).toMatchObject({ ok: true, txHash: "0xdeadbeef" });
    expect(calls).toHaveLength(1);
    const call = calls[0] as { functionName: string; args: unknown[] };
    expect(call.functionName).toBe("giveFeedback");
    expect(call.args[0]).toBe(7n);
    expect(call.args[1]).toBe(100n); // int128 value
    expect(call.args[2]).toBe(0); // valueDecimals
    expect(call.args[3]).toBe("data_brief");
    expect(call.args[4]).toBe("settlement-confirmed");
  });
});

describe("ERC-8004 reads", () => {
  const summaryClient = (result: unknown, shouldThrow = false): SummaryClient => ({
    readContract: async () => {
      if (shouldThrow) throw new Error("connection refused");
      return result;
    },
  });

  it("parses getSummary count/value/decimals", async () => {
    const r = await getReputationSummary(7, { client: summaryClient([3n, 4850n, 2n]) });
    if (!("count" in r)) {
      expect.unreachable("expected success result");
      return;
    }
    expect(r.count).toBe(3);
    expect(r.value).toBe("48.50");
  });

  it("returns honest error detail when the chain read fails", async () => {
    const r = await getReputationSummary(7, { client: summaryClient(null, true) });
    expect(r).toMatchObject({ ok: false });
  });

  it("getIdentityStatus reports unregistered honestly", async () => {
    // 前面的 registerAgent 成功用例会污染共享 KV，使 storedIdentity() 非空，
    // 从而让 getIdentityStatus 走 registered 分支去 await 实时 RPC（并行负载下 5s 超时）。
    // 本用例验证的是"未注册"分支，先清掉身份键，保证确定性、不联网。
    setKv("agent:identity", undefined);
    const status = await getIdentityStatus();
    expect(status.registered).toBe(false);
    expect(status.detail).toContain("尚未注册");
  });
});
