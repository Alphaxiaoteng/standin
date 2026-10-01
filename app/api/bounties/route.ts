/**
 * 悬赏市场 API。
 *
 * 数据源：lib/market/bounties.ts（内置 2-3 个 DEMO BUYER，第三方通过 POST 发布）。
 * 该模块由 CoreAlgorithms 维护；本路由只做参数校验与 JSON 封装，不造数据。
 *
 * GET  /api/bounties → { bounties: Bounty[] }
 * POST /api/bounties → { ok: true, bounty }，发布一条第三方悬赏
 */

import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { addBounty, ensureSeedBounties } from "@/lib/market/bounties";

export const dynamic = "force-dynamic";

interface BountyInput {
  kind?: unknown;
  rewardUsdc?: unknown;
  /** Agent 执行成本（演示可控仓位用）；缺省用该类型的默认成本 */
  costUsdc?: unknown;
  windowSec?: unknown;
  toleranceBps?: unknown;
  buyerType?: unknown;
  buyerName?: unknown;
  /** 第三方买方钱包地址（付款来源，验收后据此核对链上 USDC 转账） */
  buyerAddress?: unknown;
}

function bad(message: string) {
  return NextResponse.json({ ok: false, message }, { status: 400 });
}

export async function GET() {
  return NextResponse.json({ bounties: ensureSeedBounties() });
}

export async function POST(request: Request) {
  let body: BountyInput;
  try {
    body = (await request.json()) as BountyInput;
  } catch {
    return bad("请求体必须是 JSON");
  }

  const kind = body.kind;
  if (kind !== "data_brief" && kind !== "spread_watch") {
    return bad("kind 必须是 data_brief（数据简报）或 spread_watch（价差监测）");
  }

  const rewardUsdc = Number(body.rewardUsdc);
  if (!Number.isFinite(rewardUsdc) || rewardUsdc <= 0) {
    return bad("rewardUsdc 必须是大于 0 的数字（USDC）");
  }

  const windowSec =
    body.windowSec === undefined || body.windowSec === null
      ? undefined
      : Number(body.windowSec);
  if (windowSec !== undefined && (!Number.isFinite(windowSec) || windowSec <= 0)) {
    return bad("windowSec 必须是大于 0 的秒数");
  }

  const toleranceBps =
    body.toleranceBps === undefined || body.toleranceBps === null
      ? undefined
      : Number(body.toleranceBps);
  if (toleranceBps !== undefined && (!Number.isFinite(toleranceBps) || toleranceBps <= 0)) {
    return bad("toleranceBps 必须是大于 0 的基点数");
  }

  const costUsdc =
    body.costUsdc === undefined || body.costUsdc === null
      ? undefined
      : Number(body.costUsdc);
  if (costUsdc !== undefined && (!Number.isFinite(costUsdc) || costUsdc <= 0)) {
    return bad("costUsdc 必须是大于 0 的数字（USDC）");
  }

  const buyerType = body.buyerType === "demo" ? "demo" : "third_party";
  // T5：第三方买方必须提供钱包地址，否则链上付款无从核对；DEMO BUYER 不要求
  let buyerAddress: string | undefined;
  if (buyerType === "third_party") {
    if (typeof body.buyerAddress !== "string" || !isAddress(body.buyerAddress)) {
      return bad("第三方买方必须提供有效的 buyerAddress（0x 钱包地址），链上付款将据此核对");
    }
    buyerAddress = body.buyerAddress as `0x${string}`;
  }
  const buyerName =
    typeof body.buyerName === "string" && body.buyerName.trim()
      ? body.buyerName.trim().slice(0, 40)
      : undefined;

  const bounty = addBounty({
    kind,
    rewardUsdc,
    costUsdc,
    windowSec,
    toleranceBps,
    buyerType,
    buyerName,
    buyerAddress,
  });

  return NextResponse.json({ ok: true, bounty });
}
