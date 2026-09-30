import { describe, expect, it } from "vitest";
import {
  CONSECUTIVE_LOSS_PAUSE,
  DAILY_LOSS_HALT_FRACTION,
  canTrade,
  guardStatusOf,
  initialGuardState,
  rejectIfOverCap,
  resetDaily,
  settleTrade,
} from "./guard";

const DAY = "2026-09-30";
const T0 = new Date(`${DAY}T10:00:00`).getTime();

function state(budget = 10, at = T0) {
  return initialGuardState(budget, at);
}

function loss(kind = "data_brief", cost = 1, at = T0) {
  return { kind, status: "failed" as const, costUsdc: cost, revenueUsdc: 0, at };
}

function win(kind = "data_brief", cost = 1, revenue = 2, at = T0) {
  return { kind, status: "passed" as const, costUsdc: cost, revenueUsdc: revenue, at };
}

describe("settleTrade accounting", () => {
  it("accumulates cost and revenue and computes net", () => {
    let s = state(10);
    s = settleTrade(s, win("data_brief", 1, 3));
    s = settleTrade(s, loss("spread_watch", 0.5));
    const status = guardStatusOf(s);
    expect(status.spentTodayUsdc).toBeCloseTo(1.5, 6);
    expect(status.todayNetUsdc).toBeCloseTo(1.5, 6);
    expect(status.halt).toBe(false);
  });

  it("does not mutate the input state (纯函数)", () => {
    const s = state(10);
    const snapshot = { ...s };
    settleTrade(s, loss());
    expect(s).toEqual(snapshot);
  });
});

describe("daily loss halt (当日净亏损 ≥ 预算 30%)", () => {
  it(`halts exactly when net loss reaches ${DAILY_LOSS_HALT_FRACTION * 100}% of a 10 budget (i.e. 3)`, () => {
    let s = state(10);
    // 亏 2.9 → 未触发
    s = settleTrade(s, loss("data_brief", 2.9));
    expect(s.halt).toBe(false);
    // 再亏 0.1 → 累计 3.0 → 触发
    s = settleTrade(s, loss("data_brief", 0.1));
    expect(s.halt).toBe(true);
    expect(s.haltReason).toContain("今日已停手");
    expect(s.haltReason).toContain("3");
  });

  it("does not halt on a 30% loss that is later recovered by a win", () => {
    let s = state(10);
    s = settleTrade(s, loss("data_brief", 3));
    expect(s.halt).toBe(true);
    // PRD：停手到次日——结算胜单不解锁（halt 是单行道，次日 resetDaily 才清）
    s = settleTrade(s, win("data_brief", 0.5, 10));
    expect(s.halt).toBe(true);
  });

  it("does not halt below the threshold", () => {
    let s = state(10);
    s = settleTrade(s, loss("data_brief", 2.99));
    expect(s.halt).toBe(false);
  });

  it("blocks trading while halted via canTrade and rejectIfOverCap", () => {
    let s = state(10);
    s = settleTrade(s, loss("data_brief", 3));
    expect(canTrade(s, "spread_watch")).toBe(false);
    const gate = rejectIfOverCap(s, 1, 5);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("今日已停手");
  });
});

describe("consecutive loss pause (连亏 3 单暂停该任务类型)", () => {
  it(`pauses the kind after ${CONSECUTIVE_LOSS_PAUSE} straight losses`, () => {
    // 预算 20：三次 1 元亏损累计 3 < 30%×20=6，只验证连亏暂停，不同时触发停手
    let s = state(20);
    s = settleTrade(s, loss("spread_watch"));
    s = settleTrade(s, loss("spread_watch"));
    expect(s.pausedKinds).toEqual([]);
    s = settleTrade(s, loss("spread_watch"));
    expect(s.pausedKinds).toEqual(["spread_watch"]);
    expect(s.consecutiveLosses).toBe(3);
    expect(canTrade(s, "spread_watch")).toBe(false);
    // 其它类型不受影响
    expect(canTrade(s, "data_brief")).toBe(true);
  });

  it("resets the kind streak on a win and unpause-by-streak never auto-revives mid-day", () => {
    let s = state(10);
    s = settleTrade(s, loss("spread_watch"));
    s = settleTrade(s, loss("spread_watch"));
    s = settleTrade(s, win("spread_watch"));
    expect(s.consecutiveLosses).toBe(0);
    expect(s.consecutiveLossesByKind.spread_watch).toBe(0);
  });

  it("tracks kinds independently", () => {
    let s = state(10);
    s = settleTrade(s, loss("spread_watch"));
    s = settleTrade(s, loss("spread_watch"));
    s = settleTrade(s, loss("data_brief"));
    expect(s.pausedKinds).toEqual([]);
    expect(s.consecutiveLossesByKind).toEqual({ spread_watch: 2, data_brief: 1 });
  });
});

describe("per-trade cap rejection (单笔超上限直接拒绝)", () => {
  it("rejects without touching halt state", () => {
    const s = state(10);
    const gate = rejectIfOverCap(s, 6, 5);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("超出单笔上限");
    expect(s.halt).toBe(false);
  });

  it("allows a trade at exactly the cap", () => {
    expect(rejectIfOverCap(state(10), 5, 5).allowed).toBe(true);
  });
});

describe("daily rollover (次日重置)", () => {
  it("resets halt, streaks and counters on a new day", () => {
    let s = state(10);
    s = settleTrade(s, loss("data_brief", 3));
    expect(s.halt).toBe(true);
    s = settleTrade(s, loss("data_brief", 1));
    s = settleTrade(s, loss("data_brief", 1));
    expect(s.pausedKinds).toEqual(["data_brief"]);
    const nextDay = new Date("2026-10-01T09:00:00").getTime();
    s = resetDaily(s, nextDay, 12);
    const status = guardStatusOf(s);
    expect(status.halt).toBe(false);
    expect(status.spentTodayUsdc).toBe(0);
    expect(status.todayNetUsdc).toBe(0);
    expect(s.dailyBudgetUsdc).toBe(12);
    expect(s.pausedKinds).toEqual([]);
    expect(s.dateKey).toBe("2026-10-01");
  });

  it("rolls over automatically when a trade lands on a new dateKey", () => {
    let s = state(10);
    s = settleTrade(s, loss("data_brief", 3));
    expect(s.halt).toBe(true);
    const nextMorning = new Date("2026-10-01T09:00:00").getTime();
    s = settleTrade(s, win("data_brief", 1, 2, nextMorning));
    expect(s.halt).toBe(false);
    expect(s.dateKey).toBe("2026-10-01");
    expect(s.costTodayUsdc).toBe(1);
    expect(s.revenueTodayUsdc).toBe(2);
  });
});

describe("guardStatusOf", () => {
  it("exposes the UI aggregate shape", () => {
    let s = state(10);
    s = settleTrade(s, loss("data_brief", 1));
    const status = guardStatusOf(s);
    expect(status).toEqual({
      dailyBudgetUsdc: 10,
      spentTodayUsdc: 1,
      todayNetUsdc: -1,
      halt: false,
      haltReason: null,
      consecutiveLosses: 1,
      pausedKinds: [],
    });
  });
});
