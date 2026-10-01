import { describe, expect, it } from "vitest";
import { fetchCoinbaseSpot, fetchCoingeckoPrices, fetchHnTop } from "./sources";

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
