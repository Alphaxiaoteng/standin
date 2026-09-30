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
  const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
  if (actual.action === "approve" && actual.amount === MAX_UINT256) {
    reasons.push("Infinite approval detected");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}