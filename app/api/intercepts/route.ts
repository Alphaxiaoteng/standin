/**
 * 本金保护（原"拦截记录"）。
 *
 * PRD §五：页面顶部展示「累计避免损失」，每条拦截写明「若放行将损失 X」。
 * 金额推导口径收敛在 lib/agent/avoidedLoss.ts，避免界面与测试各写一份而漂移。
 */

import { NextResponse } from "next/server";
import { listIntercepts, listRehearsals } from "@/lib/store";
import { deriveAvoidedLoss } from "@/lib/agent/avoidedLoss";

export const dynamic = "force-dynamic";

export function GET() {
  const intercepts = listIntercepts();
  const rehearsals = listRehearsals();

  let totalAvoidedLossUsdc = 0;
  let knownCount = 0;
  let unknownCount = 0;

  const items = intercepts.map((it) => {
    const avoidedLossUsdc = deriveAvoidedLoss(it, rehearsals);

    if (avoidedLossUsdc !== null) {
      totalAvoidedLossUsdc = Number(
        (totalAvoidedLossUsdc + avoidedLossUsdc).toFixed(6),
      );
      knownCount += 1;
    } else {
      unknownCount += 1;
    }

    return { ...it, avoidedLossUsdc };
  });

  return NextResponse.json({
    intercepts: items,
    protection: {
      totalAvoidedLossUsdc,
      interceptCount: items.length,
      knownCount,
      unknownCount,
    },
  });
}
