/** 展示层格式化工具 */

export function formatAmount(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 0x1234…abcd 形式的等宽截断 */
export function truncateHash(value: string | undefined, head = 10, tail = 8): string {
  if (!value) return "—";
  const v = String(value);
  if (v.length <= head + tail + 1) return v;
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

/** Unix 毫秒 → MM-DD HH:mm:ss */
export function formatTime(ts: number | undefined): string {
  if (ts === undefined || !Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

export function formatDateTime(ts: number | undefined): string {
  if (ts === undefined || !Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { hour12: false });
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 */
export function formatAgo(ts: number | undefined): string {
  if (ts === undefined || !Number.isFinite(ts)) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** 策略有效期：Unix 毫秒 → 日期 + 剩余时长 */
export function formatExpiry(ts: number | undefined): string {
  if (ts === undefined || !Number.isFinite(ts) || ts <= 0) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("zh-CN");
  const left = ts - Date.now();
  if (left <= 0) return `${date} · 已过期`;
  const days = Math.floor(left / 86_400_000);
  if (days >= 1) return `${date} · 剩余 ${days} 天`;
  return `${date} · 剩余 ${Math.max(Math.floor(left / 3_600_000), 1)} 小时`;
}

export function isExpired(ts: number | undefined): boolean {
  if (ts === undefined || !Number.isFinite(ts) || ts <= 0) return false;
  return ts < Date.now();
}

export const MAX_UINT256 =
  (BigInt(1) << BigInt(256)) - BigInt(1);

/** 最小单位原始值 → 人类可读文本；无限授权显示为 Unlimited */
export function amountLabel(raw: string, usdc: number | null): string {
  if (!raw) return "—";
  try {
    if (BigInt(raw) === MAX_UINT256) return "Unlimited（2^256-1）";
  } catch {
    return raw;
  }
  if (usdc === null) return `${raw}（最小单位）`;
  return `${formatAmount(usdc, usdc < 1 ? 6 : 2)} USDC`;
}

export const ACTION_LABEL: Record<string, string> = {
  transfer: "转账 transfer",
  approve: "授权 approve",
};

export const SCENARIO_LABEL: Record<string, string> = {
  allowed: "正常采购",
  phishing: "收款方篡改",
  infinite: "无限授权",
};

export const STATUS_LABEL: Record<string, string> = {
  EXECUTED: "已放行",
  INTERCEPTED: "已拦截",
  executed: "已放行",
  intercepted: "已拦截",
  /** 任务账本（赚钱任务）状态 */
  passed: "验收通过",
  failed: "验收未过",
  skipped: "已跳过",
};

/** 悬赏状态 → 文案 */
export const BOUNTY_STATUS_LABEL: Record<string, string> = {
  open: "进行中",
  claimed: "已接单",
  done: "已交付",
  failed: "未通过",
  cancelled: "已取消",
};

/** 门禁拦截原因（来自 verify/rehearsal reasons）→ 说人话 */
export const GATE_REASON_LABEL: Record<string, string> = {
  recipient_mismatch: "收款方与声明不一致",
  infinite_approval: "无限授权陷阱",
  new_payee: "新收款方，不在白名单",
  over_limit: "超出单笔上限",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function statusTone(status: string): "success" | "danger" | "neutral" {
  const s = status.toUpperCase();
  if (s === "EXECUTED") return "success";
  if (s === "INTERCEPTED") return "danger";
  return "neutral";
}
