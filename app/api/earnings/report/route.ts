/**
 * 今日账本 API：主页顶部三指标（收入、成本、净利）的唯一数据源。
 *
 * PRD §五：今日账本顶部三个数——收入、成本、净利，全部来自真实账本
 * （lib/ledger.ts，LedgerPersistence 维护），不写死任何数字。
 * 账本模块就绪前返回 503，前端显示"…",绝不编造。
 */

import { NextResponse } from "next/server";
import { getLedgerSummary } from "@/lib/ledger";
import { getStats } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const summary = getLedgerSummary();
  if (!summary) {
    return NextResponse.json(
      { ok: false, message: "账本模块尚未就绪" },
      { status: 503 },
    );
  }

  const stats = getStats();
  return NextResponse.json({
    today: {
      totalRevenueUsdc: summary.revenueUsdc,
      totalCostUsdc: summary.costUsdc,
      netUsdc: summary.netUsdc,
      entryCount: summary.entryCount,
      dateKey: summary.dateKey,
    },
    walletBalanceUsdc: stats.walletBalance,
    protection: {
      // 本金保护：拦截避免损失从拦截记录推导（见 /api/intercepts）
      totalAvoidedLossUsdc: summary.avoidLossUsdc ?? 0,
    },
  });
}
