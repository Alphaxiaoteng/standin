/**
 * 账本持久化层 (PRD §三/§四/§八)
 *
 * 1. 替代 store.ts 作为核心状态容器。
 * 2. 状态落盘到 .data/ledger.json，进程重启数据不丢失。
 * 3. 支持 settle 结算、recordTrade、addCost、addRevenue，并实现“账本写��败则回滚并停机”。
 * 4. 兼容 store.ts 所有历史接口，确保原测试全绿并对外无缝迁移。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

export interface Policy {
  id: string;
  agent: string;
  merchantHash: string;
  /** 单笔上限（USDC） */
  maxPerTx: number;
  /** 每周上限（USDC） */
  maxPerWeek: number;
  /** 过期时间（Unix 毫秒） */
  expires: number;
  active: boolean;
}

export interface TransactionRecord {
  id: string;
  /** Unix 毫秒 */
  ts: number;
  to: string;
  /** USDC 金额（人类单位，如 0.5） */
  amount: number;
  token: string;
  status: "EXECUTED";
  /** 本地流水号（非链上哈希：不广播任何交易） */
  txHash: string;
  reportHash: string;
}

export interface InterceptRecord {
  id: string;
  /** Unix 毫秒 */
  ts: number;
  taskId: string;
  /** 剧本标识：allowed / phishing / infinite */
  scenario: string;
  reason: string;
  declaredTo: string;
  actualTo: string;
  reportHash: string;
}

export interface RehearsalSideView {
  action: "transfer" | "approve";
  token: string;
  to: string;
  /** 最小单位原始值（字符串，保留无限授权的巨大数值） */
  amount: string;
  /** 人类可读 USDC 数值；超出安全整数范围时为 null */
  amountUsdc: number | null;
  memo?: string;
}

export interface RehearsalRecord {
  id: string;
  /** Unix 毫秒 */
  ts: number;
  taskId: string;
  description: string;
  declaredIntent: RehearsalSideView;
  actualCalldata: RehearsalSideView;
  allowed: boolean;
  reasons: string[];
  reportHash: string;
}

export interface Stats {
  /** 今日已放行支出（USDC） */
  todaySpent: number;
  /** 累计拦截次数 */
  interceptCount: number;
  /** 本地账本余额（USDC，非链上金库） */
  walletBalance: number;
}

export type LedgerEntryStatus = "SUCCESS" | "FAILED" | "INTERCEPTED" | "SKIPPED";

export interface SettlementInput {
  taskId: string;
  taskType?: string;
  description: string;
  costUsdc: number;
  revenueUsdc: number;
  status: LedgerEntryStatus;
  reason?: string;
  avoidLossUsdc?: number;
  txHash?: string;
  reportHash?: string;
  meta?: Record<string, unknown>;
  ts?: number;
}

export interface LedgerEntry extends SettlementInput {
  id: string;
  ts: number;
  dateKey: string; // "YYYY-MM-DD"
  netUsdc: number; // revenueUsdc - costUsdc
}

export interface LedgerSummary {
  /** 当日总收入（USDC，人类单位） */
  revenueUsdc: number;
  /** 当日总成本（USDC） */
  costUsdc: number;
  /** 收入 - 成本 */
  netUsdc: number;
  /** 门禁累计避免损失（可量化部分；无则 0） */
  avoidLossUsdc?: number;
  /** 当日账本条数 */
  entryCount: number;
  /** YYYY-MM-DD */
  dateKey: string;
}

export interface NewPolicy {
  agent: string;
  merchantHash: string;
  maxPerTx: number;
  maxPerWeek: number;
  expires: number;
}

export interface TradeInput {
  kind?: string;
  cost?: number;
  revenue?: number;
  net?: number;
  ts?: number;
  status: "passed" | "failed" | "skipped" | "intercepted" | LedgerEntryStatus;
  reason?: string;
  taskId?: string;
  description?: string;
  avoidLossUsdc?: number;
  txHash?: string;
  reportHash?: string;
  meta?: Record<string, unknown>;
}

export type TradeResult =
  | { ok: true; id: string; entry: LedgerEntry }
  | { ok: false; error: string };

export interface LedgerFileSchema {
  version: 1;
  stats: Stats;
  policies: Policy[];
  transactions: TransactionRecord[];
  intercepts: InterceptRecord[];
  rehearsals: RehearsalRecord[];
  entries: LedgerEntry[];
  kv: Record<string, unknown>;
  halted: boolean;
  haltReason: string | null;
}

export interface LedgerOptions {
  storagePath?: string | null; // null 表示纯内存，用于隔离测试
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

const USDC_DECIMALS = 6;
const MAX_SAFE_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

export function unitsToUsdc(units: bigint): number | null {
  if (units > MAX_SAFE_UNITS) return null;
  return Number(units) / 10 ** USDC_DECIMALS;
}

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function txHash(): string {
  return `0x${randomHex(32)}`;
}

export function reportHash(): string {
  return `0x${randomHex(32)}`;
}

export function shortId(prefix: string): string {
  return `${prefix}-${randomHex(4)}`;
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function toDateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function defaultStoragePath(): string {
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, "standin"))) {
    return resolve(cwd, "standin/.data/ledger.json");
  }
  return resolve(cwd, ".data/ledger.json");
}

/* ------------------------------------------------------------------ */
/* 种子数据                                                            */
/* ------------------------------------------------------------------ */

export const LEGIT_API_PROVIDER = "0x2222222222222222222222222222222222222222";
export const PHISHING_ATTACKER = "0x9999999999999999999999999999999999999999";
export const DATA_MARKETPLACE = "0x4a7D3b1E9f2C8b05D6e1A3f7C9b2E4d8A0C61B33";
export const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

export const ALLOWED_MERCHANTS = [LEGIT_API_PROVIDER.toLowerCase(), DATA_MARKETPLACE.toLowerCase()];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function seedState(): LedgerFileSchema {
  const now = Date.now();
  const todayKey = toDateKey(now);

  const initialEntries: LedgerEntry[] = [
    {
      id: "led-seed-1",
      ts: now - 42 * MINUTE,
      dateKey: todayKey,
      taskId: "task-01-purchase-api",
      taskType: "data_brief",
      description: "采购第三方数据源 API 额度 (0.5 USDC)",
      costUsdc: 0.5,
      revenueUsdc: 0,
      netUsdc: -0.5,
      status: "SUCCESS",
      txHash: "0x5b1e9a72f4c0d8361eab57c94d2f8106ba37c5e94d0f61a8b23c7e5d1094fbc7",
      reportHash: "0x71c0a5f83e2d94b6071a35c8fe6d42b9807c1ae3d5b09f6274c8e301af5b7d92",
    },
    {
      id: "led-seed-2",
      ts: now - 3 * HOUR,
      dateKey: todayKey,
      taskId: "task-marketplace-purchase",
      taskType: "spread_watch",
      description: "采购数据市场套利数据包 (1.25 USDC)",
      costUsdc: 1.25,
      revenueUsdc: 0,
      netUsdc: -1.25,
      status: "SUCCESS",
      txHash: "0x2d84f0c9157be36a40d8c2f5b91e7a63cd0f8452b7a19e3d6c50f8b2a41e9705",
      reportHash: "0x33ab6c05d9e741f2b8c503ae67d19f428bc0a75e31d8f0942b6c7a5e103dcf86",
    },
    {
      id: "led-seed-3",
      ts: now - 5 * HOUR,
      dateKey: todayKey,
      taskId: "task-02-prompt-injection-redirect",
      description: "钓鱼攻击收款重定向拦截",
      costUsdc: 0,
      revenueUsdc: 0,
      netUsdc: 0,
      avoidLossUsdc: 5.0,
      status: "INTERCEPTED",
      reason: `Recipient mismatch: declared ${LEGIT_API_PROVIDER}, actual ${PHISHING_ATTACKER}`,
      reportHash: "0x1e5c90a7b3d84f26c0a71e95b42d8f3076ca1b94e5d02f8397b6c0a41ed5f28b",
    },
    {
      id: "led-seed-4",
      ts: now - 29 * HOUR,
      dateKey: toDateKey(now - 29 * HOUR),
      taskId: "task-03-infinite-approve-trap",
      description: "无限授权恶意合约拦截",
      costUsdc: 0,
      revenueUsdc: 0,
      netUsdc: 0,
      avoidLossUsdc: 50.0,
      status: "INTERCEPTED",
      reason: "Infinite approval detected; Amount exceeds declared",
      reportHash: "0x06b8f1a4c7d92e530b8a41f6c95d2073ea4b8c1d70e5f3942a6c8b0d31f5e7a9",
    },
  ];

  return {
    version: 1,
    policies: [
      {
        id: "pol-8f21a0",
        agent: "0xAgent_ERC8004_Identity_Bound",
        merchantHash: "0x9f2c41ab7d0e5b83c6a1f94e2d70b3855ac91fe6d4c07b23a18e5d09c3f7b614",
        maxPerTx: 5,
        maxPerWeek: 50,
        expires: now + 30 * DAY,
        active: true,
      },
    ],
    transactions: [
      {
        id: "tx-3c19ad",
        ts: now - 42 * MINUTE,
        to: LEGIT_API_PROVIDER,
        amount: 0.5,
        token: "USDC",
        status: "EXECUTED",
        txHash: "0x5b1e9a72f4c0d8361eab57c94d2f8106ba37c5e94d0f61a8b23c7e5d1094fbc7",
        reportHash: "0x71c0a5f83e2d94b6071a35c8fe6d42b9807c1ae3d5b09f6274c8e301af5b7d92",
      },
      {
        id: "tx-a07f52",
        ts: now - 3 * HOUR,
        to: DATA_MARKETPLACE,
        amount: 1.25,
        token: "USDC",
        status: "EXECUTED",
        txHash: "0x2d84f0c9157be36a40d8c2f5b91e7a63cd0f8452b7a19e3d6c50f8b2a41e9705",
        reportHash: "0x33ab6c05d9e741f2b8c503ae67d19f428bc0a75e31d8f0942b6c7a5e103dcf86",
      },
      {
        id: "tx-9be410",
        ts: now - 27 * HOUR,
        to: LEGIT_API_PROVIDER,
        amount: 2,
        token: "USDC",
        status: "EXECUTED",
        txHash: "0x8f7c2b0149ae5d36b70c8f2a41d9e53c6b08f74a15e2d903c7b6a4e1f8c05d37",
        reportHash: "0x4c9e0a7b13f285d60a7ce941b32d5f8076ca1b94e5d02f8397b6c0a41ed5f28b",
      },
      {
        id: "tx-14d7c8",
        ts: now - 3 * DAY,
        to: DATA_MARKETPLACE,
        amount: 4.8,
        token: "USDC",
        status: "EXECUTED",
        txHash: "0xd0a34f7b921e56c84073a1f9b52d8e06c3a74b19f0e8d527b6c1a4930f7e5b82",
        reportHash: "0xaf102b7c5d83e904a6f1c72b8d05e39471ba0c85e6f3d0419c7b2a8e5d60f37b",
      },
    ],
    intercepts: [
      {
        id: "it-6ad3f1",
        ts: now - 5 * HOUR,
        taskId: "task-02-prompt-injection-redirect",
        scenario: "phishing",
        reason: `Recipient mismatch: declared ${LEGIT_API_PROVIDER}, actual ${PHISHING_ATTACKER}`,
        declaredTo: LEGIT_API_PROVIDER,
        actualTo: PHISHING_ATTACKER,
        reportHash: "0x1e5c90a7b3d84f26c0a71e95b42d8f3076ca1b94e5d02f8397b6c0a41ed5f28b",
      },
      {
        id: "it-c502be",
        ts: now - 29 * HOUR,
        taskId: "task-03-infinite-approve-trap",
        scenario: "infinite",
        reason: "Infinite approval detected; Amount exceeds declared: declared 1000000, actual 115792089237316195423570985008687907853269984665640564039457584007913129639935",
        declaredTo: LEGIT_API_PROVIDER,
        actualTo: LEGIT_API_PROVIDER,
        reportHash: "0x06b8f1a4c7d92e530b8a41f6c95d2073ea4b8c1d70e5f3942a6c8b0d31f5e7a9",
      },
    ],
    rehearsals: [
      {
        id: "rh-2b8e05",
        ts: now - 42 * MINUTE,
        taskId: "task-01-purchase-api",
        description: "采购第三方数据源 API 额度 (0.5 USDC)",
        declaredIntent: {
          action: "transfer",
          token: USDC,
          to: LEGIT_API_PROVIDER,
          amount: "500000",
          amountUsdc: 0.5,
          memo: "Purchase 500 queries of crypto sentiment data",
        },
        actualCalldata: {
          action: "transfer",
          token: USDC,
          to: LEGIT_API_PROVIDER,
          amount: "500000",
          amountUsdc: 0.5,
        },
        allowed: true,
        reasons: [],
        reportHash: "0x71c0a5f83e2d94b6071a35c8fe6d42b9807c1ae3d5b09f6274c8e301af5b7d92",
      },
    ],
    stats: {
      todaySpent: 1.75,
      interceptCount: 2,
      walletBalance: 248.25,
    },
    entries: initialEntries,
    kv: {},
    halted: false,
    haltReason: null,
  };
}

/* ------------------------------------------------------------------ */
/* Ledger 核心类                                                       */
/* ------------------------------------------------------------------ */

export class Ledger {
  private filePath: string | null;
  private state: LedgerFileSchema;
  private closed = false;

  constructor(options?: LedgerOptions) {
    this.filePath = options?.storagePath !== undefined
      ? options.storagePath
      : defaultStoragePath();
    this.state = this.loadOrSeed();
  }

  private loadOrSeed(): LedgerFileSchema {
    if (!this.filePath) {
      return seedState();
    }

    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<LedgerFileSchema>;
        if (parsed && parsed.version === 1 && parsed.stats) {
          const seed = seedState();
          return {
            version: 1,
            stats: { ...seed.stats, ...(parsed.stats ?? {}) },
            policies: parsed.policies ?? seed.policies,
            transactions: parsed.transactions ?? seed.transactions,
            intercepts: parsed.intercepts ?? seed.intercepts,
            rehearsals: parsed.rehearsals ?? seed.rehearsals,
            entries: parsed.entries ?? seed.entries,
            kv: parsed.kv ?? {},
            halted: parsed.halted ?? false,
            haltReason: parsed.haltReason ?? null,
          };
        }
      }
    } catch {
      // 读文件损坏时优雅回退并刷新
    }

    const seeded = seedState();
    this.state = seeded;
    this.flush();
    return seeded;
  }

  public flush(): void {
    if (this.closed || !this.filePath) return;
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    const json = JSON.stringify(this.state, null, 2);
    writeFileSync(tmp, json, "utf8");
    renameSync(tmp, this.filePath);
  }

  public close(): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
  }

  public isOpen(): boolean {
    return !this.closed;
  }

  public reset(): void {
    this.state = seedState();
    this.flush();
  }

  /* --- 止损停机状态 --- */

  public isHalted(): boolean {
    return this.state.halted;
  }

  public getHaltReason(): string | null {
    return this.state.haltReason;
  }

  public setHalted(halted: boolean, reason?: string | null): void {
    this.state.halted = halted;
    this.state.haltReason = halted ? (reason ?? "Agent manually halted or hit circuit breaker") : null;
    this.flush();
  }

  /* --- 通用事务与回滚 --- */

  public withRollback<T>(action: () => T): T {
    if (this.closed) throw new Error("Ledger is closed");
    const snapshot = structuredClone(this.state);
    try {
      const result = action();
      this.flush();
      return result;
    } catch (err) {
      this.state = snapshot;
      try {
        this.flush();
      } catch {
        // 忽略回滚存盘二次错误
      }
      throw err;
    }
  }

  /* --- 结算 Settle (带写失败自动回滚与停机) --- */

  public settle(input: SettlementInput): LedgerEntry {
    if (this.closed) throw new Error("Ledger is closed");
    if (this.state.halted) {
      throw new Error(`Ledger is halted (${this.state.haltReason}); cannot settle new entries.`);
    }

    const snapshot = structuredClone(this.state);
    const ts = input.ts ?? Date.now();
    const dateKey = toDateKey(ts);
    const cost = Math.max(0, Number(input.costUsdc) || 0);
    const revenue = Math.max(0, Number(input.revenueUsdc) || 0);
    const netUsdc = round6(revenue - cost);

    const entry: LedgerEntry = {
      ...input,
      id: shortId("led"),
      ts,
      dateKey,
      costUsdc: cost,
      revenueUsdc: revenue,
      netUsdc,
    };

    try {
      this.state.entries.unshift(entry);
      if (this.state.entries.length > 500) {
        this.state.entries.length = 500;
      }

      if (cost > 0) {
        this.state.stats.todaySpent = round6(this.state.stats.todaySpent + cost);
      }
      if (revenue > 0 || cost > 0) {
        this.state.stats.walletBalance = round6(
          Math.max(0, this.state.stats.walletBalance - cost + revenue),
        );
      }
      if (input.status === "INTERCEPTED") {
        this.state.stats.interceptCount += 1;
      }

      this.flush();
      return { ...entry };
    } catch (err) {
      // 结算写盘失败：回滚在内存中的账本变动并停机
      this.state = snapshot;
      this.state.halted = true;
      this.state.haltReason = `Settlement write failure: ${err instanceof Error ? err.message : String(err)}`;
      try {
        this.flush();
      } catch {
        // 允许静默失败
      }
      throw err;
    }
  }

  public recordTrade(entry: TradeInput): TradeResult {
    try {
      let normalizedStatus: LedgerEntryStatus = "SUCCESS";
      if (entry.status === "passed" || entry.status === "SUCCESS") {
        normalizedStatus = "SUCCESS";
      } else if (entry.status === "failed" || entry.status === "FAILED") {
        normalizedStatus = "FAILED";
      } else if (entry.status === "intercepted" || entry.status === "INTERCEPTED") {
        normalizedStatus = "INTERCEPTED";
      } else if (entry.status === "skipped" || entry.status === "SKIPPED") {
        normalizedStatus = "SKIPPED";
      }

      const settled = this.settle({
        taskId: entry.taskId ?? shortId("trade"),
        taskType: entry.kind,
        description: entry.description ?? `Trade execution: ${entry.kind ?? "task"}`,
        costUsdc: entry.cost ?? 0,
        revenueUsdc: entry.revenue ?? 0,
        status: normalizedStatus,
        reason: entry.reason,
        avoidLossUsdc: entry.avoidLossUsdc,
        txHash: entry.txHash,
        reportHash: entry.reportHash,
        meta: entry.meta,
        ts: entry.ts,
      });
      return { ok: true, id: settled.id, entry: settled };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public addCost(amountUsdc: number, meta?: { taskId?: string; description?: string }): void {
    const cost = round6(Math.max(0, amountUsdc));
    this.settle({
      taskId: meta?.taskId ?? shortId("cost"),
      description: meta?.description ?? `Cost expenditure of ${cost} USDC`,
      costUsdc: cost,
      revenueUsdc: 0,
      status: "SUCCESS",
    });
  }

  public addRevenue(amountUsdc: number, meta?: { taskId?: string; description?: string }): void {
    const rev = round6(Math.max(0, amountUsdc));
    this.settle({
      taskId: meta?.taskId ?? shortId("rev"),
      description: meta?.description ?? `Revenue payout of ${rev} USDC`,
      costUsdc: 0,
      revenueUsdc: rev,
      status: "SUCCESS",
    });
  }

  /* --- 汇总查询 --- */

  public getLedgerSummary(dateKey: string = toDateKey()): LedgerSummary {
    const matching = this.state.entries.filter((e) => e.dateKey === dateKey);
    let revenueUsdc = 0;
    let costUsdc = 0;
    let avoidLossUsdc = 0;

    for (const e of matching) {
      revenueUsdc += e.revenueUsdc || 0;
      costUsdc += e.costUsdc || 0;
      avoidLossUsdc += e.avoidLossUsdc || 0;
    }

    revenueUsdc = round6(revenueUsdc);
    costUsdc = round6(costUsdc);
    const netUsdc = round6(revenueUsdc - costUsdc);

    return {
      revenueUsdc,
      costUsdc,
      netUsdc,
      avoidLossUsdc: round6(avoidLossUsdc),
      entryCount: matching.length,
      dateKey,
    };
  }

  public listLedgerEntries(limit: number = 50): LedgerEntry[] {
    return this.state.entries.slice(0, limit).map((e) => ({ ...e }));
  }

  /* --- Key-Value 仓储（供 Guard 止损状态等持久化） --- */

  public getKv<T = unknown>(key: string): T | undefined {
    return this.state.kv[key] as T | undefined;
  }

  public setKv<T = unknown>(key: string, value: T): void {
    this.state.kv[key] = value;
    this.flush();
  }

  /* ------------------------------------------------------------------ */
  /* 兼容原 store.ts 接口                                                */
  /* ------------------------------------------------------------------ */

  public getStats(): Stats {
    return { ...this.state.stats };
  }

  public listPolicies(): Policy[] {
    return this.state.policies.map((p) => ({ ...p }));
  }

  public listTransactions(): (TransactionRecord & { known: boolean })[] {
    return this.state.transactions
      .map((t) => ({ ...t, known: ALLOWED_MERCHANTS.includes(t.to.toLowerCase()) }))
      .sort((a, b) => b.ts - a.ts);
  }

  public listIntercepts(): InterceptRecord[] {
    return this.state.intercepts.map((i) => ({ ...i })).sort((a, b) => b.ts - a.ts);
  }

  public listRehearsals(): RehearsalRecord[] {
    return this.state.rehearsals.map((r) => ({ ...r })).sort((a, b) => b.ts - a.ts);
  }

  public getLatestRehearsal(): RehearsalRecord | null {
    if (this.state.rehearsals.length === 0) return null;
    return this.listRehearsals()[0];
  }

  public addPolicy(input: NewPolicy): Policy {
    const policy: Policy = {
      id: shortId("pol"),
      agent: input.agent,
      merchantHash: input.merchantHash,
      maxPerTx: input.maxPerTx,
      maxPerWeek: input.maxPerWeek,
      expires: input.expires,
      active: true,
    };
    this.state.policies.unshift(policy);
    this.flush();
    return { ...policy };
  }

  public revokePolicy(id: string): boolean {
    const policy = this.state.policies.find((p) => p.id === id);
    if (!policy) return false;
    policy.active = false;
    this.flush();
    return true;
  }

  public addTransaction(input: Omit<TransactionRecord, "id">): TransactionRecord {
    const record: TransactionRecord = { id: shortId("tx"), ...input };
    this.state.transactions.unshift(record);
    this.flush();
    return { ...record };
  }

  public addIntercept(input: Omit<InterceptRecord, "id">): InterceptRecord {
    const record: InterceptRecord = { id: shortId("it"), ...input };
    this.state.intercepts.unshift(record);
    this.flush();
    return { ...record };
  }

  public addRehearsal(input: Omit<RehearsalRecord, "id">): RehearsalRecord {
    const record: RehearsalRecord = { id: shortId("rh"), ...input };
    this.state.rehearsals.unshift(record);
    if (this.state.rehearsals.length > 50) this.state.rehearsals.length = 50;
    this.flush();
    return { ...record };
  }

  public recordSpend(amountUsdc: number): void {
    this.state.stats.todaySpent = round6(this.state.stats.todaySpent + amountUsdc);
    this.state.stats.walletBalance = round6(Math.max(0, this.state.stats.walletBalance - amountUsdc));
    this.flush();
  }

  public recordIntercept(): void {
    this.state.stats.interceptCount += 1;
    this.flush();
  }
}

/* ------------------------------------------------------------------ */
/* 单例与模块级导出                                                    */
/* ------------------------------------------------------------------ */

const globalForLedger = globalThis as unknown as { __standinLedger?: Ledger };

export function getLedger(): Ledger {
  return (globalForLedger.__standinLedger ??= new Ledger());
}

export function setLedgerInstance(instance: Ledger): void {
  globalForLedger.__standinLedger = instance;
}

export function resetStore(): void {
  getLedger().reset();
}

export function getStats(): Stats {
  return getLedger().getStats();
}

export function listPolicies(): Policy[] {
  return getLedger().listPolicies();
}

export function listTransactions(): (TransactionRecord & { known: boolean })[] {
  return getLedger().listTransactions();
}

export function listIntercepts(): InterceptRecord[] {
  return getLedger().listIntercepts();
}

export function listRehearsals(): RehearsalRecord[] {
  return getLedger().listRehearsals();
}

export function getLatestRehearsal(): RehearsalRecord | null {
  return getLedger().getLatestRehearsal();
}

export function addPolicy(input: NewPolicy): Policy {
  return getLedger().addPolicy(input);
}

export function revokePolicy(id: string): boolean {
  return getLedger().revokePolicy(id);
}

export function addTransaction(input: Omit<TransactionRecord, "id">): TransactionRecord {
  return getLedger().addTransaction(input);
}

export function addIntercept(input: Omit<InterceptRecord, "id">): InterceptRecord {
  return getLedger().addIntercept(input);
}

export function addRehearsal(input: Omit<RehearsalRecord, "id">): RehearsalRecord {
  return getLedger().addRehearsal(input);
}

export function recordSpend(amountUsdc: number): void {
  getLedger().recordSpend(amountUsdc);
}

export function recordIntercept(): void {
  getLedger().recordIntercept();
}

export function settle(input: SettlementInput): LedgerEntry {
  return getLedger().settle(input);
}

export function recordTrade(entry: TradeInput): TradeResult {
  return getLedger().recordTrade(entry);
}

export function addCost(amountUsdc: number, meta?: { taskId?: string; description?: string }): void {
  getLedger().addCost(amountUsdc, meta);
}

export function addRevenue(amountUsdc: number, meta?: { taskId?: string; description?: string }): void {
  getLedger().addRevenue(amountUsdc, meta);
}

export function getLedgerSummary(dateKey?: string): LedgerSummary {
  return getLedger().getLedgerSummary(dateKey);
}

export function listLedgerEntries(limit?: number): LedgerEntry[] {
  return getLedger().listLedgerEntries(limit);
}

export function withRollback<T>(action: () => T): T {
  return getLedger().withRollback(action);
}

export function isHalted(): boolean {
  return getLedger().isHalted();
}

export function getHaltReason(): string | null {
  return getLedger().getHaltReason();
}

export function setHalted(halted: boolean, reason?: string | null): void {
  getLedger().setHalted(halted, reason);
}

export function getKv<T = unknown>(key: string): T | undefined {
  return getLedger().getKv<T>(key);
}

export function setKv<T = unknown>(key: string, value: T): void {
  getLedger().setKv<T>(key, value);
}
