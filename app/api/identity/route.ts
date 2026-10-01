/**
 * ERC-8004 身份与声誉 API（T6）。
 *
 * GET  /api/identity → 身份注册状态 + 反馈数 + 浏览器链接（未注册时如实返回）
 * POST /api/identity → 触发一次注册（需配置 STANDIN_AGENT_PRIVATE_KEY；已注册则幂等返回）
 */

import { NextResponse } from "next/server";
import { getIdentityStatus, registerAgent } from "@/lib/erc8004";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const status = await getIdentityStatus();
  return NextResponse.json(status);
}

export async function POST() {
  const result = await registerAgent();
  if (!result.ok) {
    const status = result.reason === "not-configured" ? 400 : 502;
    return NextResponse.json({ ok: false, reason: result.reason, detail: result.detail }, { status });
  }
  const status = await getIdentityStatus();
  return NextResponse.json({ ok: true, created: result.created, ...status });
}
