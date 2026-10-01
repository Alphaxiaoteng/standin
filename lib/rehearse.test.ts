import { describe, it, expect } from "vitest";
import { compareIntent, fromX402Response, type Intent, type CalldataParams } from "./rehearse";

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

describe("fromX402Response（T7：402 响应转声明意图）", () => {
  // 结构取自 coinbase/x402 官方 types（v2：amount；v1 兼容 maxAmountRequired）
  const x402 = {
    x402Version: 2,
    error: "X-PAYMENT header is required",
    resource: { url: "https://api.example.com/brief", description: "BTC 数据简报", mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "monad-testnet",
        asset: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
        amount: "1200000",
        payTo: "0x2222222222222222222222222222222222222222",
        maxTimeoutSeconds: 60,
        extra: {},
      },
    ],
  };

  it("parses a valid v2 response into a declared intent", () => {
    const r = fromX402Response(x402);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.to).toBe("0x2222222222222222222222222222222222222222");
    expect(r.intent.amount).toBe(1_200_000n);
    expect(r.intent.token).toBe("0x534b2f3A21130d7a60830c2Df862319e593943A3");
    expect(r.intent.memo).toBe("BTC 数据简报");
  });

  it("falls back to v1 maxAmountRequired", () => {
    const v1 = { ...x402, accepts: [{ ...x402.accepts[0], amount: undefined, maxAmountRequired: "5000" }] };
    const r = fromX402Response(v1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.amount).toBe(5000n);
  });

  it("rejects a matching-payment comparison only when fields diverge (地址一致放行)", () => {
    const r = fromX402Response(x402);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 地址/金额/代币一致 → 放行
    const verdict = compareIntent(r.intent, {
      action: "transfer",
      token: r.intent.token,
      to: r.intent.to,
      amount: r.intent.amount,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("blocks when the actual amount exceeds what the 402 declares", () => {
    const r = fromX402Response(x402);
    if (!r.ok) throw new Error("parse failed");
    const verdict = compareIntent(r.intent, {
      action: "transfer",
      token: r.intent.token,
      to: r.intent.to,
      amount: r.intent.amount * 2n,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons.some((x) => x.includes("Amount exceeds"))).toBe(true);
  });

  it("blocks when the payee differs from the 402 payTo", () => {
    const r = fromX402Response(x402);
    if (!r.ok) throw new Error("parse failed");
    const verdict = compareIntent(r.intent, {
      action: "transfer",
      token: r.intent.token,
      to: "0x9999999999999999999999999999999999999999",
      amount: r.intent.amount,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons.some((x) => x.includes("Recipient mismatch"))).toBe(true);
  });

  it("rejects missing required fields (payTo / amount / asset / accepts)", () => {
    expect(fromX402Response({ ...x402, accepts: [] }).ok).toBe(false);
    const noPayTo = JSON.parse(JSON.stringify(x402));
    delete (noPayTo.accepts[0] as Record<string, unknown>).payTo;
    expect(fromX402Response(noPayTo).ok).toBe(false);
    const noAmount = JSON.parse(JSON.stringify(x402));
    delete (noAmount.accepts[0] as Record<string, unknown>).amount;
    expect(fromX402Response(noAmount).ok).toBe(false);
    const noAsset = JSON.parse(JSON.stringify(x402));
    delete (noAsset.accepts[0] as Record<string, unknown>).asset;
    expect(fromX402Response(noAsset).ok).toBe(false);
    expect(fromX402Response("not an object").ok).toBe(false);
  });
});
