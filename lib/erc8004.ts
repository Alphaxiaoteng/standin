/**
 * ERC-8004 接入（T6，可选任务）。
 *
 * 地址来源核实：官方仓库 erc-8004/erc-8004-contracts README 的 Monad Testnet
 * 部署清单（2026-10-01 抓取，与本文件常量一致；另有 lib/erc8004.test.ts 链上实测
 * name=AgentIdentity / symbol=AGENT）。
 *
 * 分工：
 *   - registerAgent / giveFeedbackFromBuyer 需要真实钱包（STANDIN_AGENT_PRIVATE_KEY /
 *     STANDIN_FEEDBACK_PRIVATE_KEY，未配置时一律诚实返回 not-configured，绝不伪造）；
 *   - 身份与声誉的"读"走公共 RPC，页面/API 随时可展示；
 *   - 注册结果（agentId、txHash）持久化在账本 KV（agent:identity），重启不丢。
 */

import { createPublicClient, createWalletClient, http, parseAbi, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { WalletClient } from "viem";
import { monadTestnet, EXPLORER } from "./chain";
import { getKv, setKv } from "./ledger";

export const ERC8004_IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
export const ERC8004_REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;

const identityAbi = parseAbi([
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function getAgentWallet(uint256 tokenId) external view returns (address)",
  "function getVersion() external view returns (string)",
  "function register() external returns (uint256)",
  "function register(string tokenURI) external returns (uint256)",
]);

const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash) external",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

export async function probeERC8004() {
  const client = createPublicClient({
    chain: monadTestnet,
    transport: http(),
  });

  try {
    const [name, symbol, version] = await Promise.all([
      client.readContract({ address: ERC8004_IDENTITY, abi: identityAbi, functionName: "name" }),
      client.readContract({ address: ERC8004_IDENTITY, abi: identityAbi, functionName: "symbol" }),
      client.readContract({ address: ERC8004_IDENTITY, abi: identityAbi, functionName: "getVersion" }),
    ]);

    return {
      address: ERC8004_IDENTITY,
      name,
      symbol,
      version,
      alive: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("ERC-8004 probe error:", msg);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* 身份与声誉（读写分离，钱包可注入以便测试）                            */
/* ------------------------------------------------------------------ */

export interface AgentIdentityRecord {
  agentId: number;
  registerTxHash: string;
  registeredAt: number;
  owner: string;
}

export const IDENTITY_KV_KEY = "agent:identity";

export function storedIdentity(): AgentIdentityRecord | null {
  const rec = getKv<AgentIdentityRecord>(IDENTITY_KV_KEY);
  if (!rec || typeof rec.agentId !== "number") return null;
  return rec;
}

export function identityTxUrl(rec: AgentIdentityRecord): string {
  return `${EXPLORER}/tx/${rec.registerTxHash}`;
}

/** 私钥签名器：STANDIN_AGENT_PRIVATE_KEY / STANDIN_FEEDBACK_PRIVATE_KEY */
function walletFromEnv(envKey: "STANDIN_AGENT_PRIVATE_KEY" | "STANDIN_FEEDBACK_PRIVATE_KEY"): WalletClient | null {
  const raw = process.env[envKey];
  if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw)) return null;
  return createWalletClient({
    account: privateKeyToAccount(raw as `0x${string}`),
    chain: monadTestnet,
    transport: http(process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? undefined),
  });
}

/** 测试可注入的最小回执/读取面 */
export interface ReceiptClient {
  waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{
    logs: Array<{ topics: readonly `0x${string}`[] }>;
  }>;
}

export interface SummaryClient {
  readContract(args: {
    address: `0x${string}`;
    abi: unknown;
    functionName: string;
    args: unknown[];
  }): Promise<unknown>;
}

/** 最小签名面：真实 WalletClient 结构兼容，测试可注入假实现 */
export interface ContractWriter {
  account?: { address: `0x${string}` };
  writeContract(args: {
    address: `0x${string}`;
    abi: unknown;
    functionName: string;
    args: unknown[];
  }): Promise<`0x${string}`>;
}

function asWriter(w: WalletClient): ContractWriter {
  return w as unknown as ContractWriter;
}

function publicClient(): ReceiptClient {
  return createPublicClient({ chain: monadTestnet, transport: http(process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? undefined) });
}

/**
 * 注册 Agent 身份（一次）。已有记录则直接返回，不重复上链。
 * 未配置 STANDIN_AGENT_PRIVATE_KEY 时返回 not-configured。
 */
export async function registerAgent(deps: { walletClient?: ContractWriter; publicClient?: ReceiptClient } = {}): Promise<
  | { ok: true; record: AgentIdentityRecord; created: boolean }
  | { ok: false; reason: "not-configured" | "chain-error"; detail?: string }
> {
  const existing = storedIdentity();
  if (existing) return { ok: true, record: existing, created: false };

  const wallet = deps.walletClient ?? (walletFromEnv("STANDIN_AGENT_PRIVATE_KEY") ? asWriter(walletFromEnv("STANDIN_AGENT_PRIVATE_KEY")!) : null);
  if (!wallet) return { ok: false, reason: "not-configured", detail: "未配置 STANDIN_AGENT_PRIVATE_KEY" };

  const client = deps.publicClient ?? publicClient();
  try {
    const txHash = await wallet.writeContract({
      address: ERC8004_IDENTITY,
      abi: identityAbi,
      functionName: "register",
      args: [],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    // register() 铸出的 tokenId 取 ownerOf 逐个确认太贵；直接读 receipt logs 中的 Transfer(to=自address) tokenId
    let agentId = -1;
    for (const log of receipt.logs) {
      // ERC721 Transfer topic0
      if (log.topics[0] !== "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") continue;
      const t3 = log.topics[3];
      if (t3 === undefined) continue;
      agentId = Number(BigInt(t3));
      break;
    }
    if (agentId < 0) {
      return { ok: false, reason: "chain-error", detail: "回执中未找到 mint 的 tokenId" };
    }
    const owner = wallet.account?.address;
    if (!owner) return { ok: false, reason: "chain-error", detail: "钱包缺少账户地址" };
    const record: AgentIdentityRecord = {
      agentId,
      registerTxHash: txHash,
      registeredAt: Date.now(),
      owner,
    };
    setKv(IDENTITY_KV_KEY, record);
    return { ok: true, record, created: true };
  } catch (err) {
    return { ok: false, reason: "chain-error", detail: err instanceof Error ? err.message : String(err) };
  }
}

export interface FeedbackInput {
  agentId: number;
  /** 0..100 之类的标量，内部按 valueDecimals=0 提交 */
  score: number;
  tag1?: string;
  tag2?: string;
  feedbackURI?: string;
}

/**
 * 以买方身份提交声誉反馈。结算确认后由买方（或以买方身份运行的脚本）调用。
 * 合约层面禁止 Agent 为自己刷反馈（self-feedback 会被 revert）。
 */
export async function giveFeedbackFromBuyer(
  input: FeedbackInput,
  deps: { walletClient?: ContractWriter; publicClient?: ReceiptClient } = {},
): Promise<
  | { ok: true; txHash: string }
  | { ok: false; reason: "not-configured" | "chain-error"; detail?: string }
> {
  const wallet = deps.walletClient ?? (walletFromEnv("STANDIN_FEEDBACK_PRIVATE_KEY") ? asWriter(walletFromEnv("STANDIN_FEEDBACK_PRIVATE_KEY")!) : null);
  if (!wallet) return { ok: false, reason: "not-configured", detail: "未配置 STANDIN_FEEDBACK_PRIVATE_KEY" };
  const client = deps.publicClient ?? publicClient();
  try {
    const txHash = await wallet.writeContract({
      address: ERC8004_REPUTATION,
      abi: reputationAbi,
      functionName: "giveFeedback",
      args: [
        BigInt(input.agentId),
        BigInt(Math.round(input.score)),
        0,
        input.tag1 ?? "",
        input.tag2 ?? "",
        "",
        input.feedbackURI ?? "",
        zeroHash,
      ],
    });
    await client.waitForTransactionReceipt({ hash: txHash });
    return { ok: true, txHash };
  } catch (err) {
    return { ok: false, reason: "chain-error", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** 读声誉汇总（count = 反馈条数，value/decimals = 加权分） */
export async function getReputationSummary(
  agentId: number,
  deps: { client?: SummaryClient } = {},
): Promise<{ count: number; value: string } | { ok: false; detail: string }> {
  const client = deps.client ?? (publicClient() as unknown as SummaryClient);
  try {
    const [count, summaryValue, decimals] = (await client.readContract({
      address: ERC8004_REPUTATION,
      abi: reputationAbi,
      functionName: "getSummary",
      args: [BigInt(agentId), [], "", ""],
    })) as [bigint, bigint, number];
    const d = Number(decimals);
    const scaled = 10 ** d;
    return {
      count: Number(count),
      value: d === 0 ? summaryValue.toString() : (Number(summaryValue) / scaled).toFixed(d),
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** 页面聚合：身份 + 反馈数 + 浏览器链接；未注册时如实返回 null 字段 */
export async function getIdentityStatus(): Promise<{
  registered: boolean;
  agentId?: number;
  registerTxHash?: string;
  registerTxUrl?: string;
  feedbackCount?: number;
  reputationValue?: string;
  detail?: string;
}> {
  const rec = storedIdentity();
  if (!rec) return { registered: false, detail: "尚未注册 ERC-8004 身份（需配置 STANDIN_AGENT_PRIVATE_KEY 后调用注册）" };
  const summary = await getReputationSummary(rec.agentId);
  return {
    registered: true,
    agentId: rec.agentId,
    registerTxHash: rec.registerTxHash,
    registerTxUrl: identityTxUrl(rec),
    feedbackCount: "count" in summary ? summary.count : undefined,
    reputationValue: "value" in summary ? summary.value : undefined,
    detail: "detail" in summary ? summary.detail : undefined,
  };
}
