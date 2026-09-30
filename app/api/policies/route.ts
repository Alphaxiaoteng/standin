import { NextResponse } from "next/server";
import { addPolicy, listPolicies } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ policies: listPolicies() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const input = body as Record<string, unknown> | null;
  if (!input || typeof input !== "object") {
    return NextResponse.json({ ok: false, error: "请求体格式不正确" }, { status: 400 });
  }

  const agent = typeof input.agent === "string" ? input.agent.trim() : "";
  const merchantHash = typeof input.merchantHash === "string" ? input.merchantHash.trim() : "";
  const maxPerTx = Number(input.maxPerTx);
  const maxPerWeek = Number(input.maxPerWeek);
  const expires = Number(input.expires);

  if (agent.length === 0) {
    return NextResponse.json({ ok: false, error: "缺少 agent 标识" }, { status: 400 });
  }
  if (merchantHash.length === 0) {
    return NextResponse.json({ ok: false, error: "缺少收款方摘要 merchantHash" }, { status: 400 });
  }
  if (!Number.isFinite(maxPerTx) || maxPerTx <= 0) {
    return NextResponse.json({ ok: false, error: "单笔上限必须为正数" }, { status: 400 });
  }
  if (!Number.isFinite(maxPerWeek) || maxPerWeek <= 0) {
    return NextResponse.json({ ok: false, error: "每周上限必须为正数" }, { status: 400 });
  }
  if (maxPerWeek < maxPerTx) {
    return NextResponse.json({ ok: false, error: "每周上限不能小于单笔上限" }, { status: 400 });
  }
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    return NextResponse.json({ ok: false, error: "过期时间必须是未来的时间戳" }, { status: 400 });
  }

  const policy = addPolicy({ agent, merchantHash, maxPerTx, maxPerWeek, expires });
  return NextResponse.json({ ok: true, policy }, { status: 201 });
}
