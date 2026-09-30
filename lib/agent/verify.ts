/**
 * 验收规则。只看已经抓到的快照，不发请求，也不写收入。
 * 价差用两源中点：基点 = |a-b| / ((a+b)/2) × 10000。不超过 50 通过。
 */

const MAX_AGE_MS = 60_000
const MAX_SPREAD_BPS = 50

export interface PriceQuote {
  usd: number
  fetchedAt: number
}

export interface BriefSnapshot {
  btc: { coingecko: PriceQuote; coinbase: PriceQuote }
  eth: { coingecko: PriceQuote; coinbase: PriceQuote }
  headlines: string[]
  hnBoard: string[]
}

export interface VerifyResult {
  passed: boolean
  reasons: string[]
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

function quoteOk(q: PriceQuote | undefined): q is PriceQuote {
  return !!q && Number.isFinite(q.usd) && q.usd > 0 && Number.isFinite(q.fetchedAt)
}

export function verifyBrief(snapshot: BriefSnapshot, deliveredAt: number): VerifyResult {
  const reasons: string[] = []
  const prices: Array<[string, PriceQuote | undefined]> = [
    ["BTC CoinGecko", snapshot.btc?.coingecko],
    ["BTC Coinbase", snapshot.btc?.coinbase],
    ["ETH CoinGecko", snapshot.eth?.coingecko],
    ["ETH Coinbase", snapshot.eth?.coinbase],
  ]
  for (const [name, quote] of prices) {
    if (!quoteOk(quote)) {
      reasons.push(`${name} 字段缺失`)
      continue
    }
    const ageMs = deliveredAt - quote.fetchedAt
    if (ageMs > MAX_AGE_MS) {
      reasons.push(`${name} 价格已过期 ${Math.floor(ageMs / 1000)} 秒`)
    }
  }

  if (quoteOk(snapshot.btc?.coingecko) && quoteOk(snapshot.btc?.coinbase)) {
    const bps = spreadBps(snapshot.btc.coingecko.usd, snapshot.btc.coinbase.usd)
    if (bps > MAX_SPREAD_BPS) reasons.push(`BTC 两源价差 ${bps.toFixed(1)} 个基点，超过容忍带`)
  }
  if (quoteOk(snapshot.eth?.coingecko) && quoteOk(snapshot.eth?.coinbase)) {
    const bps = spreadBps(snapshot.eth.coingecko.usd, snapshot.eth.coinbase.usd)
    if (bps > MAX_SPREAD_BPS) reasons.push(`ETH 两源价差 ${bps.toFixed(1)} 个基点，超过容忍带`)
  }

  if (!Array.isArray(snapshot.headlines) || snapshot.headlines.length !== 5) {
    reasons.push("热点不是 5 条")
  } else {
    for (const title of snapshot.headlines) {
      if (!snapshot.hnBoard?.includes(title)) reasons.push(`热点不在榜单：${title}`)
    }
  }

  return { passed: reasons.length === 0, reasons }
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
