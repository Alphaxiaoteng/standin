/**
 * 数据源健康度（PRD §三）：h =（1 − 失败率滑动平均）× 延迟超标折扣。
 * 低于 0.6 视为不健康，不接依赖该源的任务。
 * 429 → 源限流并指数退避（界面显示「源限流」）；连续 3 次超时 → 直接标不健康（PRD §四）。
 * 冷启动（0 样本）视为健康，h = 1，避免一开机就停机。
 */

export const HEALTHY_THRESHOLD = 0.6;
export const DEFAULT_WINDOW = 20;
export const LATENCY_TARGET_MS = 3_000;
export const TIMEOUT_STREAK_LIMIT = 3;
export const RATE_LIMIT_BACKOFF_BASE_MS = 30_000;
export const RATE_LIMIT_BACKOFF_MAX_MS = 15 * 60_000;
/** 延迟折扣下限：再慢也至少按 0.5 计，避免一次抖动把 h 打到 0 */
export const LATENCY_PENALTY_FLOOR = 0.5;

export interface HealthSample {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface SourceHealth {
  name: string;
  score: number;
  healthy: boolean;
  failureRate: number;
  samples: number;
  consecutiveTimeouts: number;
  rateLimited: boolean;
  retryAfterAt: number | null;
}

export interface TrackerOptions {
  now?: () => number;
  window?: number;
  latencyTargetMs?: number;
}

/** 延迟超标折扣：target 内记 1，超出按 target/latency 衰减，不低于 floor */
export function latencyFactor(latencyMs: number, targetMs: number): number {
  if (!(latencyMs > targetMs)) return 1;
  return Math.max(LATENCY_PENALTY_FLOOR, targetMs / latencyMs);
}

function isRateLimitError(error: string | undefined): boolean {
  return !!error && (error.includes("源限流") || error.includes("429"));
}

function isTimeoutError(error: string | undefined): boolean {
  return !!error && error.includes("超时");
}

export class SourceHealthTracker {
  private readonly now: () => number;
  private readonly windowSize: number;
  private readonly latencyTargetMs: number;
  private readonly history: Array<{ ok: boolean; factor: number }> = [];
  private consecutiveTimeouts = 0;
  private rateLimitUntil: number | null = null;
  private rateLimitStreak = 0;

  constructor(readonly name: string, opts: TrackerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.windowSize = opts.window ?? DEFAULT_WINDOW;
    this.latencyTargetMs = opts.latencyTargetMs ?? LATENCY_TARGET_MS;
  }

  record(sample: HealthSample, at: number = this.now()): SourceHealth {
    const error = sample.ok ? undefined : sample.error ?? "请求失败";

    if (sample.ok) {
      this.consecutiveTimeouts = 0;
      this.rateLimitStreak = 0;
      this.rateLimitUntil = null;
    } else {
      if (isTimeoutError(error)) this.consecutiveTimeouts += 1;
      else this.consecutiveTimeouts = 0;
      if (isRateLimitError(error)) {
        this.rateLimitStreak += 1;
        const backoff = Math.min(
          RATE_LIMIT_BACKOFF_BASE_MS * 2 ** (this.rateLimitStreak - 1),
          RATE_LIMIT_BACKOFF_MAX_MS,
        );
        this.rateLimitUntil = at + backoff;
      }
    }

    this.history.push({ ok: sample.ok, factor: latencyFactor(sample.latencyMs, this.latencyTargetMs) });
    if (this.history.length > this.windowSize) this.history.shift();

    return this.health(at);
  }

  health(at: number = this.now()): SourceHealth {
    const samples = this.history.length;
    let failures = 0;
    let factorSum = 0;
    for (const h of this.history) {
      if (!h.ok) failures += 1;
      factorSum += h.factor;
    }
    const failureRate = samples === 0 ? 0 : failures / samples;
    const latencyDiscount = samples === 0 ? 1 : factorSum / samples;
    const score = Math.round((1 - failureRate) * latencyDiscount * 10_000) / 10_000;

    const rateLimited = this.rateLimitUntil !== null && at < this.rateLimitUntil;
    const healthy = samples === 0
      ? true
      : score >= HEALTHY_THRESHOLD
        && this.consecutiveTimeouts < TIMEOUT_STREAK_LIMIT
        && !rateLimited;

    return {
      name: this.name,
      score,
      healthy,
      failureRate: Math.round(failureRate * 10_000) / 10_000,
      samples,
      consecutiveTimeouts: this.consecutiveTimeouts,
      rateLimited,
      retryAfterAt: rateLimited ? this.rateLimitUntil : null,
    };
  }
}

/* ------------------------------------------------------------------ */
/* 按源名共享的注册表（dev 下模块可能重复求值，挂 globalThis）            */
/* ------------------------------------------------------------------ */

interface Registry {
  trackers: Map<string, SourceHealthTracker>;
}

const globalForHealth = globalThis as unknown as { __standinHealthTrackers?: Registry };
const registry: Registry = (globalForHealth.__standinHealthTrackers ??= { trackers: new Map() });

export const DATA_SOURCES = ["coingecko", "coinbase", "kraken", "hn"] as const;
export type DataSourceName = (typeof DATA_SOURCES)[number];

export function getTracker(name: string): SourceHealthTracker {
  let t = registry.trackers.get(name);
  if (!t) {
    t = new SourceHealthTracker(name);
    registry.trackers.set(name, t);
  }
  return t;
}

export function recordSuccess(name: string, latencyMs: number, at?: number): SourceHealth {
  return getTracker(name).record({ ok: true, latencyMs }, at);
}

export function recordFailure(name: string, error: string, latencyMs = 0, at?: number): SourceHealth {
  return getTracker(name).record({ ok: false, latencyMs, error }, at);
}

export function sourceHealth(name: string): SourceHealth {
  return getTracker(name).health();
}

export function allSourceHealth(): SourceHealth[] {
  return DATA_SOURCES.map((name) => sourceHealth(name));
}

/** 聚合视图：app/api/opportunities 等路由消费（对齐原存根形状） */
export function getSourceHealth(): { sources: Record<string, { score: number; healthy: boolean }> } {
  const sources: Record<string, { score: number; healthy: boolean }> = {};
  for (const s of allSourceHealth()) {
    sources[s.name] = { score: s.score, healthy: s.healthy };
  }
  return { sources };
}

/** 测试用：清空注册表 */
export function resetHealthRegistry(): void {
  registry.trackers = new Map();
}
