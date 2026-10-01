/**
 * 账本明细 API（T8）：以"任务"为粒度返回账本条目，
 * 每条带成本/收入/净利/状态/结算证据（验收命中、数据源抓取时刻、链上哈希）。
 */

import { NextResponse } from "next/server";
import { listLedgerEntries } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = listLedgerEntries(200);
  return NextResponse.json({ entries });
}
