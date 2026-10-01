/**
 * 今日账本 API：主页顶部三指标（收入、成本、净利）的唯一数据源。
 *
 * T5（漏洞 C）：收入按证据来源分账——
 *   demoUsdc     演示买方（DEMO BUYER）本地演示结算
 *   onchainUsdc  链上确认收入（USDC Transfer 回执，带交易哈希）
 * 两者分开返回，前端不得相加成一个"净赚"。
 * 请求时先跑一轮链上结算确认，转账后 30 秒内刷新即可见。
 */

import { NextResponse } from "next/server";
import { getLedgerSummary, getRevenueSplit, listLedgerEntries } from "@/lib/ledger";
import { getStats, listIntercepts, listRehearsals } from "@/lib/store";
import { deriveAvoidedLoss } from "@/lib/agent/avoidedLoss";
import { listBounties } from "@/lib/market/bounties";
import { pollPendingSettlements, agentAddress } from "@/lib/chain/settlementWatcher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  // 先做一轮链上结算轮询；查询失败不阻塞报告（保持 pending）
  let settlementPoll: unknown;
  try {
    settlementPoll = await pollPendingSettlements(Date.now());
  } catch (err) {
    settlementPoll = { error: err instanceof Error ? err.message : String(err) };
  }

  const summary = getLedgerSummary();
  if (!summary) {
    return NextResponse.json(
      { ok: false, message: "账本模块尚未就绪" },
      { status: 503 },
    );
  }

  const stats = getStats();
  const splitToday = getRevenueSplit(summary.dateKey);
  const splitTotal = getRevenueSplit();

  // 链上确认收入的交易回执（可点开）
  const onchainTxs = listLedgerEntries(200)
    .filter((e) => (e.meta as { billing?: unknown } | undefined)?.billing === "onchain" && e.revenueUsdc > 0)
    .map((e) => {
      const meta = e.meta as { payoutBlockNumber?: number; explorerUrl?: string } | undefined;
      return {
        taskId: e.taskId,
        ts: e.ts,
        revenueUsdc: e.revenueUsdc,
        txHash: e.txHash,
        blockNumber: meta?.payoutBlockNumber,
        explorerUrl: meta?.explorerUrl,
      };
    });

  // 待结算的第三方悬赏（pending）
  const agent = agentAddress();
  const pendingBounties = listBounties()
    .filter((b) => b.buyerType === "third_party" && b.settlement === "pending")
    .map((b) => ({
      id: b.id,
      title: b.title,
      kind: b.kind,
      rewardUsdc: b.rewardUsdc,
      buyerAddress: b.buyerAddress,
      expiresAt: b.expiresAt,
    }));

  return NextResponse.json({
    today: {
      totalRevenueUsdc: summary.revenueUsdc,
      totalCostUsdc: summary.costUsdc,
      netUsdc: summary.netUsdc,
      entryCount: summary.entryCount,
      dateKey: summary.dateKey,
    },
    // 分账：演示收入与链上确认收入分开，永不相加
    revenue: {
      demoUsdc: splitToday.demoUsdc,
      onchainUsdcToday: splitToday.onchainUsdc,
      onchainUsdcTotal: splitTotal.onchainUsdc,
    },
    onchainTxs,
    pendingBounties,
    settlementAgentConfigured: agent !== null,
    settlementPoll,
    walletBalanceUsdc: stats.walletBalance,
    protection: {
      // 本金保护：与 /api/intercepts 同一推导（deriveAvoidedLoss over 拦截记录），
      // 不读账本 seed 字段——两个页面必须显示同一个数字（单一事实来源）
      totalAvoidedLossUsdc: listIntercepts().reduce((sum, it) => {
        const v = deriveAvoidedLoss(it, listRehearsals());
        return v !== null ? Number((sum + v).toFixed(6)) : sum;
      }, 0),
    },
  });
}
