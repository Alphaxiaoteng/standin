import type {
  AgentRunOutcome,
  ApiResult,
  Bounty,
  EarningsToday,
  Intercept,
  Opportunity,
  OpportunityBoard,
  SopRunOutcome,
  Policy,
  Protection,
  Rehearsal,
  ScenarioKey,
  Stats,
  Transaction,
} from "./types";

/**
 * 统一的数据访问层。
 * 后端信封形如 { policies: [...] } / { transactions: [...] } / { rehearsal: {...} }，
 * 写入接口形如 { ok, ... } 或 { ok: false, error }。
 * 任何请求失败都降级为空态，绝不抛出到渲染层。
 */

async function getJSON(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    if (!res.ok) return null;
    return parsed;
  } catch {
    return null;
  }
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v === undefined || v === null ? fallback : String(v);
}

/** 后端列表接口统一包一层键名，这里解开；缺失时回退到数组本身 */
function unwrap(raw: unknown, key: string): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const value = (raw as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
  }
  return null;
}

export async function fetchStats(): Promise<Stats | null> {
  const raw = await getJSON("/api/stats");
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    todaySpent: num(r.todaySpent),
    interceptCount: num(r.interceptCount),
    walletBalance: num(r.walletBalance),
  };
}

export async function fetchPolicies(): Promise<Policy[] | null> {
  const list = unwrap(await getJSON("/api/policies"), "policies");
  if (!list) return null;
  return list.map((item, i) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      id: str(r.id, `policy-${i}`),
      agent: str(r.agent),
      merchantHash: str(r.merchantHash),
      maxPerTx: num(r.maxPerTx),
      maxPerWeek: num(r.maxPerWeek),
      expires: num(r.expires),
      active: r.active === undefined ? true : Boolean(r.active),
    };
  });
}

export async function fetchTransactions(): Promise<Transaction[] | null> {
  const list = unwrap(await getJSON("/api/transactions"), "transactions");
  if (!list) return null;
  return list.map((item, i) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      id: str(r.id, `tx-${i}`),
      ts: num(r.ts),
      to: str(r.to),
      amount: num(r.amount),
      token: str(r.token, "USDC"),
      status: str(r.status, "EXECUTED"),
      txHash: str(r.txHash),
      reportHash: str(r.reportHash),
    };
  });
}

export async function fetchIntercepts(): Promise<Intercept[] | null> {
  const list = unwrap(await getJSON("/api/intercepts"), "intercepts");
  if (!list) return null;
  return list.map((item, i) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      id: str(r.id, `it-${i}`),
      ts: num(r.ts),
      taskId: str(r.taskId),
      scenario: str(r.scenario),
      reason: str(r.reason),
      declaredTo: str(r.declaredTo),
      actualTo: str(r.actualTo),
      reportHash: str(r.reportHash),
      avoidedLossUsdc:
        r.avoidedLossUsdc === null || r.avoidedLossUsdc === undefined
          ? null
          : num(r.avoidedLossUsdc),
    };
  });
}

/** 本金保护汇总：累计避免损失等（GET /api/intercepts 的 protection 字段） */
export async function fetchProtection(): Promise<Protection | null> {
  const raw = await getJSON("/api/intercepts");
  if (!raw || typeof raw !== "object") return null;
  const p = (raw as Record<string, unknown>).protection;
  if (!p || typeof p !== "object") return null;
  const r = p as Record<string, unknown>;
  return {
    totalAvoidedLossUsdc: num(r.totalAvoidedLossUsdc),
    interceptCount: num(r.interceptCount),
    knownCount: num(r.knownCount),
    unknownCount: num(r.unknownCount),
  };
}

function parseSide(raw: unknown): Rehearsal["declaredIntent"] {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    action: r.action === "approve" ? "approve" : "transfer",
    token: str(r.token),
    to: str(r.to),
    amount: str(r.amount),
    amountUsdc:
      typeof r.amountUsdc === "number"
        ? r.amountUsdc
        : r.amountUsdc === null
          ? null
          : num(r.amountUsdc, 0),
    memo: r.memo === undefined ? undefined : str(r.memo),
  };
}

export async function fetchRehearsal(): Promise<Rehearsal | null> {
  const raw = await getJSON("/api/rehearsal");
  if (!raw || typeof raw !== "object") return null;
  const outer = raw as Record<string, unknown>;
  // 优先读 { rehearsal } 信封，兼容直接返回对象的形式
  const body =
    "rehearsal" in outer
      ? outer.rehearsal
      : "declaredIntent" in outer
        ? outer
        : null;
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  return {
    id: str(r.id),
    ts: num(r.ts),
    taskId: str(r.taskId),
    description: str(r.description),
    declaredIntent: parseSide(r.declaredIntent),
    actualCalldata: parseSide(r.actualCalldata),
    allowed: Boolean(r.allowed),
    reasons: Array.isArray(r.reasons) ? r.reasons.map((x) => str(x)) : [],
    reportHash: str(r.reportHash),
  };
}

/** 新建策略。expires 为 Unix 毫秒；后端要求必须是未来时间且每周上限 ≥ 单笔上限 */
export async function createPolicy(input: {
  agent: string;
  merchantHash: string;
  maxPerTx: number;
  maxPerWeek: number;
  expires: number;
}): Promise<ApiResult<Policy>> {
  const raw = await getJSON("/api/policies", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!raw || typeof raw !== "object") {
    return { ok: false, data: null, error: "创建策略失败，后端未响应" };
  }
  const r = raw as Record<string, unknown>;
  if (r.ok === false) {
    return { ok: false, data: null, error: str(r.error, "创建策略失败") };
  }
  const policy = (r.policy ?? null) as Record<string, unknown> | null;
  if (!policy) return { ok: false, data: null, error: "创建策略失败" };
  return {
    ok: true,
    data: {
      id: str(policy.id),
      agent: str(policy.agent),
      merchantHash: str(policy.merchantHash),
      maxPerTx: num(policy.maxPerTx),
      maxPerWeek: num(policy.maxPerWeek),
      expires: num(policy.expires),
      active: policy.active === undefined ? true : Boolean(policy.active),
    },
  };
}

export async function revokePolicy(id: string): Promise<ApiResult<null>> {
  const raw = await getJSON("/api/policies/revoke", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  if (!raw || typeof raw !== "object") {
    return { ok: false, data: null, error: "撤销失败，后端未响应" };
  }
  const r = raw as Record<string, unknown>;
  if (r.ok === false) {
    return { ok: false, data: null, error: str(r.error, "撤销失败") };
  }
  return { ok: true, data: null };
}

export async function fetchEarningsToday(): Promise<EarningsToday | null> {
  const raw = await getJSON("/api/earnings/report");
  if (!raw || typeof raw !== "object") return null;
  const today = (raw as Record<string, unknown>).today;
  if (!today || typeof today !== "object") return null;
  const t = today as Record<string, unknown>;
  return {
    totalRevenueUsdc: num(t.totalRevenueUsdc),
    totalCostUsdc: num(t.totalCostUsdc),
    netUsdc: num(t.netUsdc),
  };
}

export async function fetchOpportunities(): Promise<Opportunity[] | null> {
  const list = unwrap(await getJSON("/api/opportunities"), "opportunities");
  if (!list) return null;
  return list.flatMap((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const kind = r.kind === "data_brief" || r.kind === "spread_watch" ? r.kind : null;
    if (!kind) return [];
    return [{
      id: str(r.id),
      kind,
      bountyId: typeof r.bountyId === "string" ? r.bountyId : undefined,
      title: str(r.title),
      description: str(r.description),
      estNetUsdc: num(r.estNetUsdc),
      costUsdc: num(r.costUsdc),
      risk: str(r.risk, "low"),
    }];
  });
}

/** 机会与决策：完整看板（含放弃理由与止损状态） */
export async function fetchOpportunityBoard(): Promise<OpportunityBoard | null> {
  const raw = await getJSON("/api/opportunities");
  if (!raw || typeof raw !== "object") return null;
  return raw as OpportunityBoard;
}

/** 执行一条赚钱任务（调 SOP 状态机）。返回完整结果供验收列表与净利滚动展示 */
export async function runSopTask(input: {
  kind?: "data_brief" | "spread_watch";
  bountyId?: string;
}): Promise<SopRunOutcome | null> {
  try {
    const res = await fetch("/api/earnings/run", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const raw: unknown = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object") return null;
    return raw as SopRunOutcome;
  } catch {
    return null;
  }
}

/** 悬赏市场：拉取悬赏列表 */
export async function fetchBounties(): Promise<Bounty[] | null> {
  const list = unwrap(await getJSON("/api/bounties"), "bounties");
  if (!list) return null;
  return list.map((item, i) => parseBounty(item, i));
}

/** 悬赏市场：发布一条悬赏。失败时带回后端 message，不抛到渲染层 */
export async function createBounty(input: {
  kind: "data_brief" | "spread_watch";
  rewardUsdc: number;
  windowSec?: number;
  toleranceBps?: number;
  buyerType?: "demo" | "third_party";
  buyerName?: string;
}): Promise<ApiResult<Bounty>> {
  try {
    const raw = await getJSON("/api/bounties", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!raw || typeof raw !== "object") {
      return { ok: false, data: null, error: "发布悬赏失败，后端未响应" };
    }
    const r = raw as Record<string, unknown>;
    if (r.ok === false) {
      return { ok: false, data: null, error: str(r.message ?? r.error, "发布悬赏失败") };
    }
    const bounty = r.bounty ?? r.data ?? null;
    if (!bounty || typeof bounty !== "object") {
      return { ok: false, data: null, error: "发布悬赏失败：响应缺少 bounty" };
    }
    return { ok: true, data: parseBounty(bounty, 0) };
  } catch {
    return { ok: false, data: null, error: "发布悬赏失败，网络异常" };
  }
}

function parseBounty(item: unknown, i: number): Bounty {
  const r = (item ?? {}) as Record<string, unknown>;
  const kind = r.kind === "spread_watch" ? "spread_watch" : "data_brief";
  const buyerType = r.buyerType === "third_party" ? "third_party" : "demo";
  return {
    id: str(r.id, `bt-${i}`),
    kind,
    title: str(r.title),
    description: str(r.description),
    rewardUsdc: num(r.rewardUsdc),
    costUsdc: num(r.costUsdc),
    windowSec: num(r.windowSec, 60),
    toleranceBps: r.toleranceBps === null || r.toleranceBps === undefined ? null : num(r.toleranceBps),
    status: (["open", "claimed", "done", "failed", "cancelled"] as const).includes(
      r.status as never,
    )
      ? (r.status as Bounty["status"])
      : "open",
    buyer: str(r.buyer),
    buyerType,
    createdAt: num(r.createdAt),
    expiresAt: num(r.expiresAt),
  };
}

export async function runAgent(scenario: ScenarioKey): Promise<AgentRunOutcome | null> {
  const raw = await getJSON("/api/agent/run", {
    method: "POST",
    body: JSON.stringify({ scenario }),
  });
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const result = (r.result ?? null) as Record<string, unknown> | null;
  const rehearsal = (result?.rehearsal ?? null) as Record<string, unknown> | null;
  return {
    ok: r.ok === undefined ? true : Boolean(r.ok),
    error: r.error === undefined ? undefined : str(r.error),
    result: result
      ? {
          taskId: str(result.taskId),
          description: str(result.description),
          rehearsal: {
            allowed: Boolean(rehearsal?.allowed),
            reasons: Array.isArray(rehearsal?.reasons)
              ? (rehearsal?.reasons as unknown[]).map((x) => str(x))
              : [],
          },
          status: str(result.status),
          reason: result.reason === undefined ? undefined : str(result.reason),
          reportHash: result.reportHash === undefined ? undefined : str(result.reportHash),
        }
      : null,
    rehearsalId: r.rehearsalId === undefined ? undefined : str(r.rehearsalId),
    transactionId:
      r.transactionId === undefined || r.transactionId === null
        ? null
        : str(r.transactionId),
    interceptId:
      r.interceptId === undefined || r.interceptId === null ? null : str(r.interceptId),
  };
}
