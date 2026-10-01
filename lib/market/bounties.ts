/**
 * 悬赏模型与存储（PRD §二/§六）：内置演示买方（标 DEMO BUYER），支持第三方发布。
 * 发布记录落盘 .data/bounties.json（路径可注入/STANDIN_BOUNTIES_PATH），重启不丢。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type BountyKind = "data_brief" | "spread_watch";

/** 结算状态：pending=等待买方链上付款；confirmed=已确认（demo 为演示结算，第三方须有链上回执）；unpaid=过期未付 */
export type SettlementStatus = "pending" | "confirmed" | "unpaid";

export interface Bounty {
  id: string;
  kind: BountyKind;
  title: string;
  description: string;
  /** 报酬（USDC，人类单位） */
  rewardUsdc: number;
  /** Agent 执行成本（USDC） */
  costUsdc: number;
  /** 任务 A 新鲜度窗口 / 任务 B 监测窗口（秒） */
  windowSec: number;
  /** 任务 B 价差容忍带（基点）；任务 A 为 null */
  toleranceBps: number | null;
  status: "open" | "claimed" | "done" | "failed" | "cancelled";
  buyer: string;
  buyerType: "demo" | "third_party";
  /** 第三方买方收款退回地址 / 付款来源地址（第三方发布必填，demo 无） */
  buyerAddress?: string;
  /** 链上付款回执：watcher 匹配到的 USDC Transfer */
  payoutTxHash?: string;
  payoutBlockNumber?: number;
  settlement: SettlementStatus;
  createdAt: number;
  expiresAt: number;
}

export interface NewBountyInput {
  kind: BountyKind;
  title?: string;
  description?: string;
  rewardUsdc: number;
  costUsdc?: number;
  windowSec?: number;
  toleranceBps?: number;
  buyerType?: "demo" | "third_party";
  buyerName?: string;
  /** 第三方买方钱包地址（buyerType=third_party 时必填，由 API 层校验格式） */
  buyerAddress?: string;
  /** 测试注入：覆盖当前时刻 */
  now?: number;
  /** 测试注入：自定义 id */
  id?: string;
}

/** 内置演示买方（PRD §二：系统内置 2 到 3 个买方，界面标 DEMO BUYER） */
export const DEMO_BUYERS = ["QUANT DESK (DEMO BUYER)", "RESEARCH LAB (DEMO BUYER)"] as const;

export const DEFAULT_COST_USDC = { data_brief: 0.4, spread_watch: 0.25 } as const;
export const DEFAULT_WINDOW_SEC = { data_brief: 60, spread_watch: 600 } as const;
/** 任务 A 验收带 50bps 在 verify.ts；此处仅作展示默认 */
export const DEFAULT_TOLERANCE_BPS = { data_brief: null, spread_watch: 50 } as const;

const DEFAULT_TITLES: Record<BountyKind, string> = {
  data_brief: "BTC/ETH 双源价格简报",
  spread_watch: "BTC 双源价差监测",
};

const DEFAULT_DESCRIPTIONS: Record<BountyKind, string> = {
  data_brief: "采集 BTC、ETH 双源价格与 5 条 HN 热点，数据不得早于 60 秒，两源价差在容忍带内。",
  spread_watch: "监测窗口内两源 BTC 价差，一旦越过阈值即通知买方，窗口结束后回放判定。",
};

interface BountyStoreFile {
  version: 1;
  seq: number;
  bounties: Bounty[];
}

const STORE_VERSION = 1;

function defaultStorePath(): string {
  return resolve(process.cwd(), ".data/bounties.json");
}

function isBountyKind(v: unknown): v is BountyKind {
  return v === "data_brief" || v === "spread_watch";
}

function reviveBounty(raw: unknown): Bounty | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isBountyKind(r.kind)) return null;
  const reward = typeof r.rewardUsdc === "number" ? r.rewardUsdc : NaN;
  if (!Number.isFinite(reward)) return null;
  const status = r.status;
  const num = (v: unknown, fallback: number | null): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const buyerType = r.buyerType === "third_party" ? "third_party" : "demo";
  // 旧文件无 settlement：按买方类型给缺省（demo=演示结算即确认，第三方=待付款）
  const settlement: SettlementStatus =
    r.settlement === "confirmed" || r.settlement === "unpaid" || r.settlement === "pending"
      ? r.settlement
      : buyerType === "demo"
        ? "confirmed"
        : "pending";
  return {
    id: typeof r.id === "string" ? r.id : `bnty-malformed-${Math.random().toString(36).slice(2, 8)}`,
    kind: r.kind,
    title: typeof r.title === "string" ? r.title : DEFAULT_TITLES[r.kind],
    description: typeof r.description === "string" ? r.description : DEFAULT_DESCRIPTIONS[r.kind],
    rewardUsdc: reward,
    costUsdc: num(r.costUsdc, DEFAULT_COST_USDC[r.kind]) as number,
    windowSec: num(r.windowSec, DEFAULT_WINDOW_SEC[r.kind]) as number,
    toleranceBps: num(r.toleranceBps, DEFAULT_TOLERANCE_BPS[r.kind]),
    status: status === "claimed" || status === "done" || status === "failed" || status === "cancelled" ? status : "open",
    buyer: typeof r.buyer === "string" ? r.buyer : DEMO_BUYERS[0],
    buyerType,
    buyerAddress: typeof r.buyerAddress === "string" ? r.buyerAddress : undefined,
    payoutTxHash: typeof r.payoutTxHash === "string" ? r.payoutTxHash : undefined,
    payoutBlockNumber:
      typeof r.payoutBlockNumber === "number" && Number.isFinite(r.payoutBlockNumber)
        ? r.payoutBlockNumber
        : undefined,
    settlement,
    createdAt: num(r.createdAt, 0) as number,
    expiresAt: num(r.expiresAt, 0) as number,
  };
}
function seedBountyStore(now: number): BountyStoreFile {
  return {
    version: STORE_VERSION,
    seq: 3,
    bounties: [
      {
        id: "bnty-seed-01",
        kind: "data_brief",
        title: "BTC/ETH 双源价格简报",
        description: "要求 BTC 和 ETH 双源价格加 5 条科技热点，数据延迟 ≤ 60s，价差带 ≤ 50bps。",
        rewardUsdc: 1.2,
        costUsdc: 0.4,
        windowSec: 60,
        toleranceBps: 50,
        status: "open",
        buyer: DEMO_BUYERS[0],
        buyerType: "demo",
        settlement: "pending",
        createdAt: now,
        expiresAt: now + 3600 * 24 * 1000,
      },
      {
        id: "bnty-seed-02",
        kind: "spread_watch",
        title: "BTC 双源价差监测",
        description: "监测 10 分钟内两源 BTC 价差是否超过 50 个基点并及时通知。",
        rewardUsdc: 0.8,
        costUsdc: 0.25,
        windowSec: 600,
        toleranceBps: 50,
        status: "open",
        buyer: DEMO_BUYERS[1],
        buyerType: "demo",
        settlement: "pending",
        createdAt: now,
        expiresAt: now + 3600 * 24 * 1000,
      },
      {
        id: "bnty-seed-03",
        kind: "data_brief",
        title: "高频快报 · 价差研判",
        description: "深度聚合多源快报，核验真实深度，超时或越带将判定验收未通过记亏。",
        rewardUsdc: 2.5,
        costUsdc: 0.5,
        windowSec: 45,
        toleranceBps: 30,
        status: "open",
        buyer: DEMO_BUYERS[0],
        buyerType: "demo",
        settlement: "pending",
        createdAt: now,
        expiresAt: now + 3600 * 24 * 1000,
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 存储层（模块级缓存 + globalThis，dev 下模块可能重复求值）              */
/* ------------------------------------------------------------------ */

interface Registry {
  cache: Map<string, BountyStoreFile>;
}

const globalForBounties = globalThis as unknown as { __standinBountyStore?: Registry };
const registry: Registry = (globalForBounties.__standinBountyStore ??= { cache: new Map() });

function loadStore(path: string): BountyStoreFile {
  const cached = registry.cache.get(path);
  if (cached) return cached;
  let store: BountyStoreFile;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const bounties = (raw as BountyStoreFile | null)?.bounties;
    if (typeof raw === "object" && raw !== null && Array.isArray(bounties)) {
      const file = raw as Partial<BountyStoreFile>;
      store = {
        version: STORE_VERSION,
        seq: typeof file.seq === "number" && Number.isInteger(file.seq) ? file.seq : 0,
        bounties: bounties.map(reviveBounty).filter((b): b is Bounty => b !== null),
      };
    } else {
      store = { version: STORE_VERSION, seq: 0, bounties: [] };
    }
  } catch {
    store = { version: STORE_VERSION, seq: 0, bounties: [] };
  }
  registry.cache.set(path, store);
  return store;
}

function persist(path: string, store: BountyStoreFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

function newId(now: number): string {
  return `bnty-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addBounty(input: NewBountyInput, overrides: { path?: string } = {}): Bounty {
  const now = input.now ?? Date.now();
  const kind = isBountyKind(input.kind) ? input.kind : "data_brief";
  const buyerType = input.buyerType === "third_party" ? "third_party" : "demo";
  const buyer = input.buyerName ?? (buyerType === "demo" ? DEMO_BUYERS[0] : "第三方买方");
  const bounty: Bounty = {
    id: input.id ?? newId(now),
    kind,
    title: input.title ?? DEFAULT_TITLES[kind],
    description: input.description ?? DEFAULT_DESCRIPTIONS[kind],
    rewardUsdc: input.rewardUsdc,
    costUsdc: input.costUsdc ?? DEFAULT_COST_USDC[kind],
    windowSec: input.windowSec ?? DEFAULT_WINDOW_SEC[kind],
    toleranceBps: input.toleranceBps ?? DEFAULT_TOLERANCE_BPS[kind],
    status: "open",
    buyer,
    buyerType,
    buyerAddress: buyerType === "third_party" ? input.buyerAddress : undefined,
    settlement: "pending",
    createdAt: now,
    expiresAt: now + (input.windowSec ?? DEFAULT_WINDOW_SEC[kind]) * 1_000,
  };
  const path = overrides.path ?? process.env.STANDIN_BOUNTIES_PATH ?? defaultStorePath();
  const store = loadStore(path);
  store.bounties.push(bounty);
  store.seq += 1;
  persist(path, store);
  return { ...bounty };
}

export function listBounties(overrides: { path?: string } = {}): Bounty[] {
  const path = overrides.path ?? process.env.STANDIN_BOUNTIES_PATH ?? defaultStorePath();
  return loadStore(path).bounties.map((b) => ({ ...b })).sort((a, b) => b.createdAt - a.createdAt);
}

export function getBounty(id: string, overrides: { path?: string } = {}): Bounty | null {
  const path = overrides.path ?? process.env.STANDIN_BOUNTIES_PATH ?? defaultStorePath();
  const found = loadStore(path).bounties.find((b) => b.id === id);
  return found ? { ...found } : null;
}

export function updateBountyStatus(id: string, status: Bounty["status"], overrides: { path?: string } = {}): Bounty | null {
  const path = overrides.path ?? process.env.STANDIN_BOUNTIES_PATH ?? defaultStorePath();
  const store = loadStore(path);
  const found = store.bounties.find((b) => b.id === id);
  if (!found) return null;
  found.status = status;
  persist(path, store);
  return { ...found };
}

/** 结算回写：watcher 确认或过期时调用 */
export function updateBountySettlement(
  id: string,
  patch: {
    settlement: SettlementStatus;
    payoutTxHash?: string;
    payoutBlockNumber?: number;
    status?: Bounty["status"];
  },
  overrides: { path?: string } = {},
): Bounty | null {
  const path = overrides.path ?? process.env.STANDIN_BOUNTIES_PATH ?? defaultStorePath();
  const store = loadStore(path);
  const found = store.bounties.find((b) => b.id === id);
  if (!found) return null;
  found.settlement = patch.settlement;
  if (patch.payoutTxHash !== undefined) found.payoutTxHash = patch.payoutTxHash;
  if (patch.payoutBlockNumber !== undefined) found.payoutBlockNumber = patch.payoutBlockNumber;
  if (patch.status !== undefined) found.status = patch.status;
  persist(path, store);
  return { ...found };
}

/** 测试用：清空内存缓存（落盘文件由测试用临时路径隔离） */
export function resetBountyCache(): void {
  registry.cache.clear();
}

/** 业务端预热：若当前无任何悬赏，自动初始化 PRD §二 要求的 3 条 DEMO BUYER 悬赏 */
export function ensureSeedBounties(overrides: { path?: string } = {}): Bounty[] {
  const path = overrides.path ?? process.env.STANDIN_BOUNTIES_PATH ?? defaultStorePath();
  const store = loadStore(path);
  if (store.bounties.length === 0) {
    const seeded = seedBountyStore(Date.now());
    store.bounties = seeded.bounties;
    store.seq = seeded.seq;
    persist(path, store);
  }
  return listBounties(overrides);
}
