import { describe, expect, it } from "vitest";
import { fetchCoinbaseSpot, fetchCoingeckoPrices, fetchHnTop, fetchKrakenSpot } from "./sources";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("fetchCoingeckoPrices", () => {
  it("parses BTC and ETH on 200", async () => {
    const time = clock();
    const out = await fetchCoingeckoPrices({
      now: time.now,
      fetch: async () => {
        time.advance(12);
        return jsonResponse({ bitcoin: { usd: 83130 }, ethereum: { usd: 2667.85 } });
      },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toEqual({ btcUsd: 83130, ethUsd: 2667.85 });
    expect(out.fetchedAt).toBe(1_012);
    expect(out.latencyMs).toBe(12);
  });

  it("returns 源限流 on 429", async () => {
    const out = await fetchCoingeckoPrices({
      now: () => 5_000,
      fetch: async () => new Response("no", { status: 429 }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("源限流");
    expect(out.fetchedAt).toBe(5_000);
  });

  it("returns 超时 when the request is aborted", async () => {
    const out = await fetchCoingeckoPrices({
      timeoutMs: 20,
      now: () => 9,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("超时");
  });
});

describe("fetchCoinbaseSpot", () => {
  it("parses the spot amount and requests the given pair", async () => {
    let url = "";
    const out = await fetchCoinbaseSpot("ETH-USD", {
      now: () => 2_000,
      fetch: async (input) => {
        url = String(input);
        return jsonResponse({ data: { amount: "2668.1", base: "ETH", currency: "USD" } });
      },
    });
    expect(url).toContain("ETH-USD");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toEqual({ pair: "ETH-USD", usd: 2668.1 });
  });

  it("returns 源限流 on 429", async () => {
    const out = await fetchCoinbaseSpot("BTC-USD", {
      fetch: async () => new Response("", { status: 429 }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("源限流");
  });

  it("returns 超时 when the request is aborted", async () => {
    const out = await fetchCoinbaseSpot("BTC-USD", {
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("超时");
  });
});

describe("fetchKrakenSpot", () => {
  // 响应结构取自 2026-10-01 实测：{"error":[],"result":{"XXBTZUSD":{"c":["83838.20000","0.0001"],...}}}
  const krakenBody = (pairKey: string, last: string) => ({
    error: [],
    result: { [pairKey]: { a: [last, "1", "1.000"], b: [last, "1", "1.000"], c: [last, "0.00010000"] } },
  });

  it("parses XBTUSD last trade price and requests the mapped pair", async () => {
    let url = "";
    const out = await fetchKrakenSpot("BTC-USD", {
      now: () => 4_000,
      fetch: async (input) => {
        url = String(input);
        return jsonResponse(krakenBody("XXBTZUSD", "83838.20000"));
      },
    });
    expect(url).toContain("pair=XBTUSD");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toEqual({ pair: "BTC-USD", usd: 83838.2 });
    expect(out.fetchedAt).toBe(4_000);
  });

  it("parses ETHUSD via XETHZUSD key", async () => {
    const out = await fetchKrakenSpot("ETH-USD", {
      fetch: async () => jsonResponse(krakenBody("XETHZUSD", "2694.00000")),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.usd).toBe(2694);
  });

  it("fails on Kraken business errors even when HTTP is 200", async () => {
    const out = await fetchKrakenSpot("ETH-USD", {
      fetch: async () => jsonResponse({ error: ["EQuery:Unknown asset pair"], result: {} }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("EQuery");
  });

  it("returns 源限流 on 429", async () => {
    const out = await fetchKrakenSpot("BTC-USD", {
      fetch: async () => new Response("", { status: 429 }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("源限流");
  });
});

describe("fetchHnTop", () => {
  it("loads the first 5 titles with 6 requests", async () => {
    const urls: string[] = [];
    const out = await fetchHnTop({
      now: () => 3_000,
      fetch: async (input) => {
        const href = String(input);
        urls.push(href);
        if (href.endsWith("/topstories.json")) return jsonResponse([11, 12, 13, 14, 15, 16]);
        const id = href.match(/item\/(\d+)/)?.[1];
        return jsonResponse({ id: Number(id), title: `t${id}` });
      },
    });
    expect(urls).toHaveLength(6);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.titles).toEqual(["t11", "t12", "t13", "t14", "t15"]);
  });

  it("returns an independent board larger than the delivered titles", async () => {
    const out = await fetchHnTop(8, {
      now: () => 3_000,
      fetch: async (input) => {
        const href = String(input);
        if (href.endsWith("/topstories.json")) return jsonResponse([11, 12, 13, 14, 15, 16, 17, 18]);
        const id = href.match(/item\/(\d+)/)?.[1];
        return jsonResponse({ id: Number(id), title: `t${id}` });
      },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.titles).toEqual(["t11", "t12", "t13", "t14", "t15"]);
    expect(out.value.board).toEqual(["t11", "t12", "t13", "t14", "t15", "t16", "t17", "t18"]);
    expect(Object.is(out.value.titles, out.value.board)).toBe(false);
  });

  it("defaults to a 5-item board for legacy calls", async () => {
    const out = await fetchHnTop({
      fetch: async (input) => {
        const href = String(input);
        if (href.endsWith("/topstories.json")) return jsonResponse([11, 12, 13, 14, 15, 16]);
        const id = href.match(/item\/(\d+)/)?.[1];
        return jsonResponse({ id: Number(id), title: `t${id}` });
      },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.board).toEqual(out.value.titles);
    expect(Object.is(out.value.titles, out.value.board)).toBe(false);
  });

  it("returns 源限流 when the board responds 429", async () => {
    const out = await fetchHnTop({
      fetch: async () => new Response("", { status: 429 }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("源限流");
  });

  it("returns 超时 when the board request is aborted", async () => {
    const out = await fetchHnTop({
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("超时");
  });
});
