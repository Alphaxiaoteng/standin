import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "../ledger";
import { initialGuardState, settleTrade } from "./guard";
import { emptyPosteriorStore, memoryPosteriorPort, type SopTickResult } from "./sop";
import {
  persistAfterTick,
  persistSopStateToKv,
  restoreGuardFromKv,
  restorePosteriorFromKv,
} from "./sopRuntime";

function tmpLedgerPath() {
  return join(mkdtempSync(join(tmpdir(), "standin-guard-")), "ledger.json");
}

describe("止损与后验持久化（账本 KV）", () => {
  it("写入后新建 Ledger 实例能完整读回 guard 与后验", () => {
    const path = tmpLedgerPath();
    const a = new Ledger({ storagePath: path });

    // guard 经一单亏损结算
    const guard = settleTrade(initialGuardState(10), {
      kind: "data_brief",
      status: "failed",
      costUsdc: 0.4,
      revenueUsdc: 0,
    });
    const store = emptyPosteriorStore();
    store.set("data_brief", { alpha: 3, beta: 1 });
    persistSopStateToKv(a, guard, store);

    // 模拟进程重启：新建实例从同一文件读回
    const b = new Ledger({ storagePath: path });
    const restoredGuard = restoreGuardFromKv(b);
    expect(restoredGuard).toEqual(guard);
    expect(restoredGuard.consecutiveLosses).toBe(1);

    const restoredStore = restorePosteriorFromKv(b);
    expect(restoredStore.get("data_brief")).toEqual({ alpha: 3, beta: 1 });
    const port = memoryPosteriorPort(restoredStore);
    expect(port.posteriorFor("data_brief")).toEqual({ alpha: 3, beta: 1 });
    expect(port.samplesFor("data_brief")).toBe(2);
  });

  it("跨天自动重置当日预算与亏损", () => {
    const kv = new Map<string, unknown>();
    const fakeKv = {
      getKv: <T,>(k: string) => kv.get(k) as T | undefined,
      setKv: (k: string, v: unknown) => void kv.set(k, v),
    };

    // 昨天的状态：已花 3、已停手
    const stale = {
      ...initialGuardState(10, Date.now() - 86_400_000),
      dateKey: "2020-01-01",
      spentTodayUsdc: 3,
      costTodayUsdc: 3,
      halt: true,
      haltReason: "今日已停手，避免继续亏损 3",
    };
    persistSopStateToKv(fakeKv, stale, emptyPosteriorStore());

    const now = new Date();
    const restored = restoreGuardFromKv(fakeKv, now.getTime());
    expect(restored.dateKey).toBe(
      `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`,
    );
    expect(restored.spentTodayUsdc).toBe(0);
    expect(restored.costTodayUsdc).toBe(0);
    expect(restored.halt).toBe(false);
    expect(restored.haltReason).toBeNull();
  });

  it("损坏的 KV 状态回退到全新初始状态", () => {
    const fakeKv = {
      getKv: () => ({ garbage: true }),
      setKv: () => {},
    };
    const restored = restoreGuardFromKv(fakeKv);
    expect(restored.spentTodayUsdc).toBe(0);
    expect(restored.consecutiveLosses).toBe(0);
  });

  it("状态写失败 → 停机且步骤标红；二次失败也不抛出", () => {
    const halts: Array<[boolean, string | null]> = [];
    const failingKv = {
      getKv: () => undefined,
      setKv: () => {
        throw new Error("EACCES: read-only filesystem");
      },
      setHalted: (h: boolean, r: string | null) => void halts.push([h, r]),
    };
    const state = { guard: initialGuardState(10), store: emptyPosteriorStore() };
    const result = { steps: [] } as SopTickResult;

    persistAfterTick(failingKv, state, result);
    expect(halts).toHaveLength(1);
    expect(halts[0][0]).toBe(true);
    expect(halts[0][1]).toContain("状态持久化失败");
    const lastStep = result.steps[result.steps.length - 1];
    expect(lastStep?.status).toBe("fail");
    expect(lastStep?.note).toContain("状态持久化失败");

    // setHalted 也写失败时：静默，不向调用方抛错
    const allFailing = { ...failingKv, setHalted: () => { throw new Error("boom"); } };
    expect(() => persistAfterTick(allFailing, state, result)).not.toThrow();
  });
});
