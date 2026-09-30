/**
 * 本金保护（原"拦截记录"）。
 *
 * PRD §五：页面顶部展示「累计避免损失」，每条拦截写明「若放行将损失 X」。
 * 拦截记录本身不存金额，避免损失从两处真实数据推导：
 *   1. 同 taskId 的彩排记录：声明意图的金额就是若放行将转出的金额；
 *   2. 兜底：拦截原因文本中记录的 declared 数额（最小单位）。
 * 两处都取不到时返回 null，界面显示"金额未记录"，绝不编造数字。
 */

import { NextResponse } from "next/server";
import { listIntercepts, listRehearsals } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 从拦截原因文本中提取 declared 数额（最小单位，6 位小数） */
function parseDeclaredFromReason(reason: string): number | null {
  const m = /declared (\d+(?:\.\d+)?)/.exec(reason);
  if (!m) return null;
  const raw = Number(m[1]);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Number((raw / 1e6).toFixed(6));
}

export function GET() {
  const intercepts = listIntercepts();
  const rehearsals = listRehearsals();

  let totalAvoidedLossUsdc = 0;
  let knownCount = 0;
  let unknownCount = 0;

  const items = intercepts.map((it) => {
    const rehearsal = rehearsals.find((r) => r.taskId === it.taskId);
    const declaredUsdc = rehearsal?.declaredIntent.amountUsdc ?? null;
    const avoidedLossUsdc =
      declaredUsdc !== null && declaredUsdc > 0
        ? declaredUsdc
        : parseDeclaredFromReason(it.reason);

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
