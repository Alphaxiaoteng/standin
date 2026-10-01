export interface Intent {
  action: "transfer" | "approve";
  token: string;
  to: string;
  amount: bigint;
  memo?: string;
}

/**
 * x402 402 响应转声明的支付意图（T7）。
 * 结构取自官方仓库 coinbase/x402 typescript/packages/core/src/types/payments.ts
 * （2026-10-01 抓取）：PaymentRequired.accepts[] 内含
 * scheme/network/asset/amount(v2，原 v1 为 maxAmountRequired)/payTo。
 * 字段缺失或非法一律报错，绝不猜默认值。
 */
export interface DeclaredIntent {
  action: "transfer" | "approve";
  token: string;
  to: string;
  amount: bigint;
  memo?: string;
  network?: string;
  resourceUrl?: string;
}

export type FromX402Result =
  | { ok: true; intent: DeclaredIntent }
  | { ok: false; error: string };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const UINT_RE = /^\d+$/;

export function fromX402Response(resp: unknown): FromX402Result {
  if (typeof resp !== "object" || resp === null) {
    return { ok: false, error: "响应不是 JSON 对象" };
  }
  const r = resp as Record<string, unknown>;
  const accepts = r.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    return { ok: false, error: "字段缺失：accepts 数组" };
  }
  const first =
    accepts.find((a) => (a as { scheme?: unknown })?.scheme === "exact") ?? accepts[0];
  if (typeof first !== "object" || first === null) {
    return { ok: false, error: "字段缺失：accepts[0] 不是对象" };
  }
  const a = first as Record<string, unknown>;

  const to = a.payTo;
  if (typeof to !== "string" || !ADDRESS_RE.test(to)) {
    return { ok: false, error: "字段缺失或非法：payTo（收款地址）" };
  }

  const rawAmount = a.amount ?? a.maxAmountRequired;
  if (
    (typeof rawAmount !== "string" && typeof rawAmount !== "number")
    || !UINT_RE.test(String(rawAmount))
  ) {
    return { ok: false, error: "字段缺失或非法：amount/maxAmountRequired（最小单位非负整数）" };
  }

  const token = a.asset;
  if (typeof token !== "string" || !ADDRESS_RE.test(token)) {
    return { ok: false, error: "字段缺失或非法：asset（代币合约地址）" };
  }

  const resource = r.resource as { description?: unknown; url?: unknown } | undefined;
  return {
    ok: true,
    intent: {
      action: "transfer",
      token,
      to,
      amount: BigInt(String(rawAmount)),
      memo: typeof resource?.description === "string" ? resource.description : undefined,
      network: typeof a.network === "string" ? a.network : undefined,
      resourceUrl: typeof resource?.url === "string" ? resource.url : undefined,
    },
  };
}

export interface CalldataParams {
  action: "transfer" | "approve";
  token: string;
  to: string;
  amount: bigint;
}

export interface RehearsalResult {
  allowed: boolean;
  reasons: string[];
}

export function compareIntent(intent: Intent, actual: CalldataParams): RehearsalResult {
  const reasons: string[] = [];

  // 1. 操作类型不符
  if (intent.action !== actual.action) {
    reasons.push(`Action mismatch: declared ${intent.action}, actual ${actual.action}`);
  }

  // 2. 代币不符
  if (intent.token.toLowerCase() !== actual.token.toLowerCase()) {
    reasons.push(`Token mismatch: declared ${intent.token}, actual ${actual.token}`);
  }

  // 3. 收款方不符
  if (intent.to.toLowerCase() !== actual.to.toLowerCase()) {
    reasons.push(`Recipient mismatch: declared ${intent.to}, actual ${actual.to}`);
  }

  // 4. 金额不符（实际大于声明）
  if (actual.amount > intent.amount) {
    reasons.push(`Amount exceeds declared: declared ${intent.amount}, actual ${actual.amount}`);
  }

  // 5. 无限授权检测（针对 approve）
  const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
  if (actual.action === "approve" && actual.amount === MAX_UINT256) {
    reasons.push("Infinite approval detected");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}