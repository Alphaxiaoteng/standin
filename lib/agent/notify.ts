/**
 * 独立通知通道（T3）：价差越线通知落盘 .data/notices.json（路径可注入/STANDIN_NOTICES_PATH）。
 * 通知写入时打独立时间戳，验收从存储回放，Agent 无法自证"已按时通知"。
 * 接口预留：后续可替换为 webhook 或链上事件实现，验收侧只依赖读回接口。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface NoticeRecord {
  id: string;
  /** 悬赏 id */
  bountyId: string;
  /** 写入时刻（Unix 毫秒） */
  at: number;
  payload: Record<string, unknown>;
}

interface NoticeFile {
  version: 1;
  notices: NoticeRecord[];
}

export function defaultNoticesPath(): string {
  if (process.env.STANDIN_NOTICES_PATH) return resolve(process.env.STANDIN_NOTICES_PATH);
  return resolve(process.cwd(), ".data/notices.json");
}

export function readNotices(overrides: { path?: string } = {}): NoticeRecord[] {
  const path = overrides.path ?? defaultNoticesPath();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const notices = (raw as { notices?: unknown } | null)?.notices;
    if (Array.isArray(notices)) return notices as NoticeRecord[];
  } catch {
    // 文件不存在或损坏视为无通知；验收会如实判"未按时通知"
  }
  return [];
}

/** 读回某悬赏最近一条通知（验收回放用） */
export function latestNoticeFor(bountyId: string, overrides: { path?: string } = {}): NoticeRecord | null {
  const found = readNotices(overrides).filter((n) => n && n.bountyId === bountyId);
  return found.length > 0 ? found[found.length - 1] : null;
}

/**
 * 发出一条通知：追加写入通知文件（原子写：tmp + rename）。
 * 写失败直接抛错——绝不返回成功；调用方不得把失败当作"已通知"。
 */
export async function emitNotice(
  bountyId: string,
  payload: Record<string, unknown> = {},
  overrides: { path?: string; now?: () => number } = {},
): Promise<{ at: number; id: string }> {
  const path = overrides.path ?? defaultNoticesPath();
  const at = (overrides.now ?? Date.now)();
  const id = `notice-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const notices = readNotices({ path });
  notices.push({ id, bountyId, at, payload });

  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  writeFileSync(tmp, JSON.stringify({ version: 1, notices } satisfies NoticeFile, null, 2), "utf8");
  renameSync(tmp, path);
  return { at, id };
}
