/**
 * 行情与热点适配器。
 * 统一返回抓取值、抓取时刻和延迟。失败只带回原因，不在这里累计健康度。
 */

const DEFAULT_TIMEOUT_MS = 8_000

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd"
const COINBASE_URL = "https://api.coinbase.com/v2/prices"
const HN_URL = "https://hacker-news.firebaseio.com/v0"

export interface SourceDeps {
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export type SourceResult<T> =
  | { ok: true; value: T; fetchedAt: number; latencyMs: number }
  | { ok: false; error: string; fetchedAt: number; latencyMs: number }

export interface SpotPrices {
  btcUsd: number
  ethUsd: number
}

export type CoinbasePair = "BTC-USD" | "ETH-USD"

type Attempt =
  | { ok: true; body: unknown; fetchedAt: number; latencyMs: number }
  | { ok: false; error: string; fetchedAt: number; latencyMs: number }

async function attempt(url: string, deps: SourceDeps): Promise<Attempt> {
  const fetchImpl = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const started = now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    const fetchedAt = now()
    const latencyMs = fetchedAt - started
    if (res.status === 429) return { ok: false, error: "源限流", fetchedAt, latencyMs }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, fetchedAt, latencyMs }
    const body: unknown = await res.json()
    return { ok: true, body, fetchedAt, latencyMs }
  } catch (err) {
    const fetchedAt = now()
    const aborted = err instanceof Error && err.name === "AbortError"
    return {
      ok: false,
      error: aborted ? "超时" : "请求失败",
      fetchedAt,
      latencyMs: Math.max(0, fetchedAt - started),
    }
  } finally {
    clearTimeout(timer)
  }
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

export async function fetchCoingeckoPrices(deps: SourceDeps = {}): Promise<SourceResult<SpotPrices>> {
  const res = await attempt(COINGECKO_URL, deps)
  if (!res.ok) return res
  const body = res.body as { bitcoin?: { usd?: unknown }; ethereum?: { usd?: unknown } }
  const btcUsd = num(body?.bitcoin?.usd)
  const ethUsd = num(body?.ethereum?.usd)
  if (btcUsd === null || ethUsd === null) {
    return { ok: false, error: "响应无法解析", fetchedAt: res.fetchedAt, latencyMs: res.latencyMs }
  }
  return { ok: true, value: { btcUsd, ethUsd }, fetchedAt: res.fetchedAt, latencyMs: res.latencyMs }
}

export async function fetchCoinbaseSpot(
  pair: CoinbasePair,
  deps: SourceDeps = {},
): Promise<SourceResult<{ pair: CoinbasePair; usd: number }>> {
  const res = await attempt(`${COINBASE_URL}/${pair}/spot`, deps)
  if (!res.ok) return res
  const body = res.body as { data?: { amount?: unknown } }
  const usd = num(body?.data?.amount)
  if (usd === null) {
    return { ok: false, error: "响应无法解析", fetchedAt: res.fetchedAt, latencyMs: res.latencyMs }
  }
  return { ok: true, value: { pair, usd }, fetchedAt: res.fetchedAt, latencyMs: res.latencyMs }
}

export async function fetchHnTop(deps: SourceDeps = {}): Promise<SourceResult<{ titles: string[] }>> {
  const now = deps.now ?? Date.now
  const started = now()
  const board = await attempt(`${HN_URL}/topstories.json`, deps)
  if (!board.ok) return board
  if (!Array.isArray(board.body)) {
    return { ok: false, error: "响应无法解析", fetchedAt: board.fetchedAt, latencyMs: board.latencyMs }
  }
  const ids = board.body.filter((id): id is number => typeof id === "number").slice(0, 5)
  if (ids.length < 5) {
    return { ok: false, error: "榜单不足", fetchedAt: board.fetchedAt, latencyMs: board.latencyMs }
  }
  const titles: string[] = []
  for (const id of ids) {
    const item = await attempt(`${HN_URL}/item/${id}.json`, deps)
    if (!item.ok) return item
    const title = (item.body as { title?: unknown })?.title
    if (typeof title !== "string" || title.length === 0) {
      return { ok: false, error: "响应无法解析", fetchedAt: item.fetchedAt, latencyMs: item.fetchedAt - started }
    }
    titles.push(title)
  }
  const fetchedAt = now()
  return { ok: true, value: { titles }, fetchedAt, latencyMs: fetchedAt - started }
}
