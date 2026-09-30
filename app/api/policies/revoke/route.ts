import { NextResponse } from "next/server";
import { revokePolicy } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const id = (body as Record<string, unknown> | null)?.id;
  if (typeof id !== "string" || id.length === 0) {
    return NextResponse.json({ ok: false, error: "缺少策略 id" }, { status: 400 });
  }

  if (!revokePolicy(id)) {
    return NextResponse.json({ ok: false, error: "策略不存在" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
