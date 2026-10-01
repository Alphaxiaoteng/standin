/**
 * 链上结算确认（T5，设计见 docs/T5_SETTLEMENT_DESIGN.md）。
 *
 * findPayment：在演示 USDC 合约上找"买方 → Agent"的 Transfer 事件，
 * 匹配金额与验收时刻之后，返回交易哈希或"未找到"。
 * 任何 RPC 异常都返回 unknown——"查不到"绝不等于"没付钱"，不得据此判 unpaid。
 *
 * pollPendingSettlements：遍历 pending 的第三方悬赏做确认或过期判定，
 * confirmed 才调 ledger.settle 记收入（带 payoutTxHash 与区块号）。
 */

import { createPublicClient, http } from "viem";
import { monadTestnet, CANONICAL, EXPLORER } from "../chain";
import {
  listBounties,
  updateBountySettlement,
  type Bounty,
} from "../market/bounties";
import { getLedger, settle } from "../ledger";

const USDC_DECIMALS = 6;
/** eth_getLogs 单段扫描的区块数：2026-10-01 实测 testnet-rpc.monad.xyz 限制 100 块窗口 */
const SCAN_STEP = 90;
/** 单次轮询最多扫描的区块总量（90/段 × 100 段），防止首次回扫拖垮请求 */
const MAX_SCAN_BLOCKS = 9_000;

export function agentAddress(): `0x${string}` | null {
  const raw = process.env.STANDIN_AGENT_ADDRESS;
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  return raw.toLowerCase() as `0x${string}`;
}

export function usdcAddress(): `0x${string}` {
  return CANONICAL.testUsdc;
}

export interface PaymentQuery {
  buyer: `0x${string}`;
  agent: `0x${string}`;
  /** 最小金额（USDC 人类单位，含 6 位小数换算在函数内做） */
  minValueUsdc: number;
  /** 验收时刻（Unix ms）；只认区块时间晚于它的转账 */
  since: number;
  /** 测试注入 */
  client?: MinimalClient;
}

/** findPayment 依赖的最小客户端面（viem PublicClient 的子集，测试可注入 fake） */
export interface MinimalClient {
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  getLogs(args: {
    address: `0x${string}`;
    event: unknown;
    args: { from: `0x${string}`; to: `0x${string}` };
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<Array<{ args?: { value?: unknown }; blockNumber?: bigint; transactionHash?: `0x${string}` | null }>>;
}

export type PaymentResult =
  | { status: "found"; txHash: `0x${string}`; blockNumber: bigint; value: bigint }
  | { status: "not_found" }
  | { status: "unknown"; reason: string };

/** 二分法把 Unix ms 时间戳映射到区块号（该区块 timestamp >= since 的最早区块） */
export async function timestampToBlock(
  client: MinimalClient,
  sinceMs: number,
): Promise<bigint> {
  const sinceSec = Math.floor(sinceMs / 1000);
  const latest = await client.getBlockNumber();
  const latestTs = (await client.getBlock({ blockNumber: latest })).timestamp;
  if (BigInt(sinceSec) >= latestTs) return latest + 1n;

  let lo = 0n;
  let hi = latest;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const ts = (await client.getBlock({ blockNumber: mid })).timestamp;
    if (ts >= BigInt(sinceSec)) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

const TRANSFER_EVENT = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;

/** 真实 viem 客户端适配到 MinimalClient（只暴露 findPayment 需要的三个方法） */
function realClient(): MinimalClient {
  const c = createPublicClient({
    chain: monadTestnet,
    transport: http(process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? undefined),
  });
  return {
    getBlockNumber: () => c.getBlockNumber(),
    getBlock: (args) => c.getBlock(args),
    getLogs: async (args) =>
      (await c.getLogs({
        address: args.address,
        event: TRANSFER_EVENT,
        args: { from: args.args.from, to: args.args.to },
        fromBlock: args.fromBlock,
        toBlock: args.toBlock,
      })) as unknown as Awaited<ReturnType<MinimalClient["getLogs"]>>,
  };
}

export async function findPayment(q: PaymentQuery): Promise<PaymentResult> {
  const client = q.client ?? realClient();
  const minValue = BigInt(Math.ceil(q.minValueUsdc * 10 ** USDC_DECIMALS));

  try {
    const fromBlock = await timestampToBlock(client, q.since);
    const latest = await client.getBlockNumber();
    if (fromBlock > latest) return { status: "not_found" };
    if (latest - fromBlock > BigInt(MAX_SCAN_BLOCKS)) {
      // 起点太远：只扫最近 MAX_SCAN_BLOCKS 块；扫不到按 unknown 处理（不判未付）
      return { status: "unknown", reason: `扫描窗口超过 ${MAX_SCAN_BLOCKS} 块，需人工核对` };
    }

    for (let start = fromBlock; start <= latest; start += BigInt(SCAN_STEP)) {
      const end = start + BigInt(SCAN_STEP) - 1n > latest ? latest : start + BigInt(SCAN_STEP) - 1n;
      const logs = await client.getLogs({
        address: usdcAddress(),
        event: TRANSFER_EVENT,
        args: { from: q.buyer, to: q.agent },
        fromBlock: start,
        toBlock: end,
      });
      for (const log of logs) {
        const value = log.args?.value;
        if (typeof value !== "bigint" || value < minValue) continue;
        const blockNumber = log.blockNumber;
        const txHash = log.transactionHash;
        if (blockNumber === undefined || !txHash) continue;
        const ts = (await client.getBlock({ blockNumber })).timestamp;
        if (ts * 1000n <= BigInt(q.since)) continue;
        return { status: "found", txHash, blockNumber, value };
      }
      if (end >= latest) break;
    }
    return { status: "not_found" };
  } catch (err) {
    return { status: "unknown", reason: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------------------------------------------ */
/* 悬赏级轮询                                                          */
/* ------------------------------------------------------------------ */

export interface SettlementPollOutcome {
  bountyId: string;
  result: "confirmed" | "unpaid" | "pending" | "skipped";
  txHash?: string;
  detail?: string;
}

function explorerTxUrl(txHash: string): string {
  return `${EXPLORER}/tx/${txHash}`;
}

/** 遍历 pending 第三方悬赏：确认入账 / 过期判 unpaid / 其余保持 pending */
export async function pollPendingSettlements(
  now = Date.now(),
  hooks: { onConfirmed?: (bounty: Bounty, revenueUsdc: number) => void } = {},
): Promise<SettlementPollOutcome[]> {
  const agent = agentAddress();
  const pending = listBounties().filter(
    (b: Bounty) => b.buyerType === "third_party" && b.settlement === "pending",
  );
  const outcomes: SettlementPollOutcome[] = [];

  for (const bounty of pending) {
    if (!bounty.buyerAddress) {
      outcomes.push({ bountyId: bounty.id, result: "skipped", detail: "买方地址缺失，无法核对付款" });
      continue;
    }
    if (!agent) {
      outcomes.push({ bountyId: bounty.id, result: "skipped", detail: "未配置 STANDIN_AGENT_ADDRESS，无法核对收款地址" });
      continue;
    }

    if (now > bounty.expiresAt) {
      // 过期：只有链上"确实没有"付款才判 unpaid；unknown 保持 pending
      const r = await findPayment({
        buyer: bounty.buyerAddress as `0x${string}`,
        agent,
        minValueUsdc: bounty.rewardUsdc,
        since: bounty.createdAt,
      });
      if (r.status === "not_found") {
        updateBountySettlement(bounty.id, { settlement: "unpaid", status: "failed" });
        settle({
          taskId: bounty.id,
          taskType: bounty.kind,
          description: `${bounty.title}：买方未在期限内链上付款，收入 0，成本已花`,
          costUsdc: 0, // 成本已在交付时入账，不重复记
          revenueUsdc: 0,
          status: "FAILED",
          reason: "过期未收到链上付款（settlement=unpaid）",
          meta: { settlement: "unpaid", buyerType: bounty.buyerType },
        });
        outcomes.push({ bountyId: bounty.id, result: "unpaid" });
      } else if (r.status === "unknown") {
        outcomes.push({ bountyId: bounty.id, result: "pending", detail: `链上查询失败：${r.reason}` });
      } else {
        confirmBounty(bounty, r, now);
        hooks.onConfirmed?.(bounty, bounty.rewardUsdc);
        outcomes.push({ bountyId: bounty.id, result: "confirmed", txHash: r.txHash });
      }
      continue;
    }

    const r = await findPayment({
      buyer: bounty.buyerAddress as `0x${string}`,
      agent,
      minValueUsdc: bounty.rewardUsdc,
      since: bounty.createdAt,
    });
    if (r.status === "found") {
      confirmBounty(bounty, r, now);
      hooks.onConfirmed?.(bounty, bounty.rewardUsdc);
      outcomes.push({ bountyId: bounty.id, result: "confirmed", txHash: r.txHash });
    } else if (r.status === "unknown") {
      outcomes.push({ bountyId: bounty.id, result: "pending", detail: `链上查询失败：${r.reason}` });
    } else {
      outcomes.push({ bountyId: bounty.id, result: "pending", detail: "链上尚未见到匹配转账" });
    }
  }
  return outcomes;
}

/** 确认入账：settlement=confirmed + 收入账（billing=onchain）+ 余额增加 */
function confirmBounty(bounty: Bounty, r: Extract<PaymentResult, { status: "found" }>, now: number): void {
  updateBountySettlement(bounty.id, {
    settlement: "confirmed",
    status: "done",
    payoutTxHash: r.txHash,
    payoutBlockNumber: Number(r.blockNumber),
  });
  const revenue = bounty.rewardUsdc;
  settle({
    taskId: bounty.id,
    taskType: bounty.kind,
    description: `${bounty.title}：链上付款确认（USDC Transfer）`,
    costUsdc: 0,
    revenueUsdc: revenue,
    status: "SUCCESS",
    txHash: r.txHash,
    meta: {
      billing: "onchain",
      buyerType: bounty.buyerType,
      payoutBlockNumber: Number(r.blockNumber),
      explorerUrl: explorerTxUrl(r.txHash),
      confirmedAt: now,
    },
  });
  getLedger().creditBalance(revenue);
}
