import { NextResponse } from "next/server";
import { getStats } from "@/lib/store";

// 内存态数据，必须按请求实时读取，不可缓存。
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getStats());
}
