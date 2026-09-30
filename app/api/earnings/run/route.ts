/**
 * 执行一单赚钱任务：调 lib/agent/sop.ts 状态机（经 sopRuntime 装配真实端口）。
 *
 * PRD §六：去掉固定 PROFILES；成本先花、收入由 lib/agent/verify.ts 的
 * 确定性验收规则决定——验收不通过就是亏损单。结算走 lib/ledger.ts 落盘账本。
 */

import { NextResponse } from "next/server";
import { tick } from "@/lib/agent/sopRuntime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RunBody {
  /** 任务类型（未指定悬赏时，由 sop 在该类型内自选最优悬赏） */
  kind?: unknown;
  /** 直接指定某个悬赏（机会页「让它做」按钮会带 bountyId） */
  bountyId?: unknown;
}

export async function POST(request: Request) {
  let body: RunBody;
  try {
    body = (await request.json()) as RunBody;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体必须是 JSON" }, { status: 400 });
  }

  const kind = body.kind === "data_brief" || body.kind === "spread_watch" ? body.kind : undefined;
  const bountyId = typeof body.bountyId === "string" && body.bountyId ? body.bountyId : undefined;
  if (!kind && !bountyId) {
    return NextResponse.json(
      { ok: false, message: "需要提供 kind（data_brief | spread_watch）或 bountyId" },
      { status: 400 },
    );
  }

  // SOP 保证：任何分支（跳过/拦截/失败/通过）都记账并写明原因
  const outcome = await tick({ kind, bountyId });
  return NextResponse.json(outcome);
}
