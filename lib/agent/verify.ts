/**
 * 验收规则。只看已经抓到的快照，不发请求，也不写收入。
 * 价差用两源中点：基点 = |a-b| / ((a+b)/2) × 10000。不超过 50 通过。
 * 三源可用时取中位数：任一源偏离中位数超过 50 即失败并点名该源；
 * 第三方源缺失时降级为两源规则，并在 degraded 里标注。
 */

const MAX_AGE_MS = 60_000
const MAX_SPREAD_BPS = 50

export interface PriceQuote {
  usd: number
  fetchedAt: number
}

export interface CoinQuotes {
  coingecko: PriceQuote
  coinbase: PriceQuote
  /** 第三方交叉校验源；缺失时降级为两源规则 */
  kraken?: PriceQuote
}

export interface BriefSnapshot {
  btc: CoinQuotes
  eth: CoinQuotes
  headlines: string[]
  hnBoard: string[]
  /** 独立回查榜单的抓取时刻（与 headlines 抓取相互独立） */
  hnBoardFetchedAt?: number
}

export interface VerifyResult {
  passed: boolean
  reasons: string[]
  /** 降级说明（如 kraken 缺失回退两源规则）；正常三源校验时为空 */
  degraded?: string | null
}

export interface SpreadSample {
  spreadBps: number
  at: number
}

export function spreadBps(a: number, b: number): number {
  const mid = (a + b) / 2
  if (!(mid > 0)) return Number.POSITIVE_INFINITY
  return (Math.abs(a - b) / mid) * 10_000
}

/** 偏离中位数的基点：|p - median| / median × 10000 */
export function medianDeviationBps(p: number, median: number): number {
  if (!(median > 0)) return Number.POSITIVE_INFINITY
  return (Math.abs(p - median) / median) * 10_000
}

function quoteOk(q: PriceQuote | undefined): q is PriceQuote {
  return !!q && Number.isFinite(q.usd) && q.usd > 0 && Number.isFinite(q.fetchedAt)
}

export function verifyBrief(snapshot: BriefSnapshot, deliveredAt: number): VerifyResult {
  const reasons: string[] = []
  let degraded: string | null = null
  const coins: Array<["BTC" | "ETH", CoinQuotes | undefined]> = [
    ["BTC", snapshot.btc],
    ["ETH", snapshot.eth],
  ]

  // 新鲜度：三源一视同仁
  for (const [coin, cq] of coins) {
    const quotes: Array<[string, PriceQuote | undefined]> = [
      ["CoinGecko", cq?.coingecko],
      ["Coinbase", cq?.coinbase],
      ["Kraken", cq?.kraken],
    ]
    for (const [source, quote] of quotes) {
      if (!quote) continue
      if (!quoteOk(quote)) {
        reasons.push(`${coin} ${source} 字段缺失`)
        continue
      }
      const ageMs = deliveredAt - quote.fetchedAt
      if (ageMs > MAX_AGE_MS) {
        reasons.push(`${coin} ${source} 价格已过期 ${Math.floor(ageMs / 1000)} 秒`)
      }
    }
  }

  // 价差：三源取中位数；第三方源缺失降级为两源规则
  for (const [coin, cq] of coins) {
    const cg = quoteOk(cq?.coingecko) ? cq!.coingecko : undefined
    const cb = quoteOk(cq?.coinbase) ? cq!.coinbase : undefined
    const kr = quoteOk(cq?.kraken) ? cq!.kraken : undefined
    if (cg && cb && kr) {
      const entries: Array<[string, number]> = [
        ["CoinGecko", cg.usd],
        ["Coinbase", cb.usd],
        ["Kraken", kr.usd],
      ]
      const median = entries.map(([, v]) => v).sort((a, b) => a - b)[1]
      for (const [source, usd] of entries) {
        const bps = medianDeviationBps(usd, median)
        if (bps > MAX_SPREAD_BPS) {
          reasons.push(`${coin} ${source} 偏离三源中位数 ${bps.toFixed(1)} 个基点，超过容忍带`)
        }
      }
    } else if (cg && cb) {
      const bps = spreadBps(cg.usd, cb.usd)
      if (bps > MAX_SPREAD_BPS) reasons.push(`${coin} 两源价差 ${bps.toFixed(1)} 个基点，超过容忍带`)
      if (!kr) degraded = `${coin} Kraken 缺失，降级为两源价差规则`
    }
  }

  if (!Array.isArray(snapshot.headlines) || snapshot.headlines.length !== 5) {
    reasons.push("热点不是 5 条")
  } else {
    // 防自证：榜单与热点不能是同一份数据（同一引用即自己验证自己）
    if (Object.is(snapshot.headlines, snapshot.hnBoard)) {
      reasons.push("榜单与热点是同一份数据，无法独立回查")
    } else if (!Array.isArray(snapshot.hnBoard) || snapshot.hnBoard.length === 0) {
      reasons.push("榜单为空，无法独立回查")
    } else {
      for (const title of snapshot.headlines) {
        if (!snapshot.hnBoard.includes(title)) reasons.push(`热点不在榜单：${title}`)
      }
    }
  }

  return { passed: reasons.length === 0, reasons, degraded }
}

export function verifySpreadWatch(input: {
  samples: SpreadSample[]
  thresholdBps: number
  windowStart: number
  windowEnd: number
  notifiedAt: number | null
}): VerifyResult {
  const inWindow = input.samples.filter((s) => s.at >= input.windowStart && s.at <= input.windowEnd)
  const triggered = inWindow.some((s) => s.spreadBps > input.thresholdBps)
  if (!triggered) return { passed: false, reasons: ["未超过阈值"] }
  const onTime = input.notifiedAt !== null
    && input.notifiedAt >= input.windowStart
    && input.notifiedAt <= input.windowEnd
  if (!onTime) return { passed: false, reasons: ["未按时通知"] }
  return { passed: true, reasons: [] }
}
