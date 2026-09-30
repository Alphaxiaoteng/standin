/**
 * 「避免损失」金额推导口径（单一事实来源）。
 *
 * PRD §五：本金保护页顶部要展示「累计避免损失」，每条拦截写明「若放行将损失 X」。
 * 拦截记录本身不存金额，因此金额从两处真实数据推导：
 *   1. 同 taskId 的彩排记录：声明意图的金额，就是若放行将转出的金额；
 *   2. 兜底：拦截原因文本里记录的 declared 数额（最小单位，6 位小数）。
 * 两处都取不到时返回 null，界面显示「金额未记录」——绝不编造数字。
 *
 * 该模块同时被 API 路由与门禁测试引用，避免两处各自手写导致口径漂移。
 */

import type { InterceptRecord, RehearsalRecord } from "../ledger";

/** 从拦截原因文本中提取 declared 数额（最小单位，6 位小数） */
export function parseDeclaredFromReason(reason: string): number | null {
  const m = /declared (\d+(?:\.\d+)?)/.exec(reason);
  if (!m) return null;
  const raw = Number(m[1]);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Number((raw / 1e6).toFixed(6));
}

/**
 * 推导单条拦截的避免损失金额（人类单位 USDC）。
 * 优先级：同 taskId 的彩排声明金额 → 拦截原因文本中的 declared 数额 → null。
 */
export function deriveAvoidedLoss(
  intercept: InterceptRecord,
  rehearsals: RehearsalRecord[],
): number | null {
  const rehearsal = rehearsals.find((r) => r.taskId === intercept.taskId);
  const declaredUsdc = rehearsal?.declaredIntent.amountUsdc ?? null;
  if (declaredUsdc !== null && declaredUsdc > 0) return declaredUsdc;
  return parseDeclaredFromReason(intercept.reason);
}
