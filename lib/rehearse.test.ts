import { describe, it, expect } from "vitest";

// 意图比对规则
export interface Intent {
  action: "transfer" | "approve";
  token: string;
  to: string;
  amount: bigint;
  memo?: string;
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
  const MAX_UINT256 = (1n << 256n) - 1n;
  if (actual.action === "approve" && actual.amount === MAX_UINT256) {
    reasons.push("Infinite approval detected");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}

describe("Rehearsal Engine - Intent Comparison", () => {
  const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
  const MERCHANT = "0x1111111111111111111111111111111111111111";
  const ATTACKER = "0x9999999999999999999999999999999999999999";

  it("should allow matching intent", () => {
    const intent: Intent = { action: "transfer", token: USDC, to: MERCHANT, amount: 500000n }; // 0.5 USDC
    const actual: CalldataParams = { action: "transfer", token: USDC, to: MERCHANT, amount: 500000n };
    const res = compareIntent(intent, actual);
    expect(res.allowed).toBe(true);
    expect(res.reasons.length).toBe(0);
  });

  it("should block recipient mismatch (malicious redirect)", () => {
    const intent: Intent = { action: "transfer", token: USDC, to: MERCHANT, amount: 500000n };
    const actual: CalldataParams = { action: "transfer", token: USDC, to: ATTACKER, amount: 500000n };
    const res = compareIntent(intent, actual);
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain(`Recipient mismatch: declared ${MERCHANT}, actual ${ATTACKER}`);
  });

  it("should block amount exceeding declared", () => {
    const intent: Intent = { action: "transfer", token: USDC, to: MERCHANT, amount: 500000n };
    const actual: CalldataParams = { action: "transfer", token: USDC, to: MERCHANT, amount: 5000000n }; // 5 USDC
    const res = compareIntent(intent, actual);
    expect(res.allowed).toBe(false);
    expect(res.reasons[0]).toMatch(/Amount exceeds declared/);
  });

  it("should block infinite approval", () => {
    const MAX_UINT256 = (1n << 256n) - 1n;
    const intent: Intent = { action: "approve", token: USDC, to: MERCHANT, amount: 500000n };
    const actual: CalldataParams = { action: "approve", token: USDC, to: MERCHANT, amount: MAX_UINT256 };
    const res = compareIntent(intent, actual);
    expect(res.allowed).toBe(false);
    expect(res.reasons).toContain("Infinite approval detected");
  });

  it("should allow actual amount less than declared (discount/underbudget)", () => {
    const intent: Intent = { action: "transfer", token: USDC, to: MERCHANT, amount: 1000000n }; // declared 1 USDC max
    const actual: CalldataParams = { action: "transfer", token: USDC, to: MERCHANT, amount: 800000n }; // actual 0.8 USDC
    const res = compareIntent(intent, actual);
    expect(res.allowed).toBe(true);
  });
});