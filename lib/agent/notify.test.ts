import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitNotice, latestNoticeFor, readNotices } from "./notify";

function tmpPath() {
  return join(mkdtempSync(join(tmpdir(), "standin-notice-")), "notices.json");
}

describe("emitNotice / readNotices", () => {
  it("writes a notice with an independent timestamp and reads it back", async () => {
    const path = tmpPath();
    let t = 1_000;
    const out = await emitNotice("bnty-1", { spreadBps: 80 }, { path, now: () => (t += 5) });
    expect(out.at).toBe(1_005);
    expect(out.id).toMatch(/^notice-/);

    const all = readNotices({ path });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ bountyId: "bnty-1", at: 1_005, payload: { spreadBps: 80 } });

    const latest = latestNoticeFor("bnty-1", { path });
    expect(latest?.at).toBe(1_005);
  });

  it("appends across bounty ids and replays only the matching bounty", async () => {
    const path = tmpPath();
    await emitNotice("bnty-1", {}, { path, now: () => 100 });
    await emitNotice("bnty-2", {}, { path, now: () => 200 });
    await emitNotice("bnty-1", {}, { path, now: () => 300 });

    expect(readNotices({ path })).toHaveLength(3);
    expect(latestNoticeFor("bnty-1", { path })?.at).toBe(300);
    expect(latestNoticeFor("bnty-2", { path })?.at).toBe(200);
    expect(latestNoticeFor("bnty-missing", { path })).toBeNull();
  });

  it("treats a missing file as no notices", () => {
    expect(readNotices({ path: join(tmpdir(), `standin-none-${Math.random()}`, "notices.json") })).toEqual([]);
  });

  it("rejects when the notice file cannot be written (不得返回成功)", async () => {
    // 路径指向一个已存在的目录 → writeFileSync 必然失败
    const dirPath = mkdtempSync(join(tmpdir(), "standin-notice-dir-"));
    await expect(
      emitNotice("bnty-1", {}, { path: dirPath, now: () => 1 }),
    ).rejects.toThrow();
    // 失败绝不落任何通知记录
    expect(readNotices({ path: dirPath })).toEqual([]);
  });
});
