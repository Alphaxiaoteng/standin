import { NextResponse } from "next/server";
import { getLatestRehearsal } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  // 前端契约固定为 { rehearsal }；无记录时给 null，由前端渲染空态。
  return NextResponse.json({ rehearsal: getLatestRehearsal() });
}
