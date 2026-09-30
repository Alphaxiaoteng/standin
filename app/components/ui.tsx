"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconCopy } from "./icons";
import { truncateHash } from "./format";

export function Card({
  title,
  desc,
  actions,
  children,
  flush = false,
  className = "",
}: {
  title?: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div style={{ minWidth: 0 }}>
            {title && <div className="card-title">{title}</div>}
            {desc && <div className="card-desc">{desc}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={`card-body${flush ? " is-flush" : ""}`}>{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  unit,
  foot,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  foot?: ReactNode;
  tone?: "danger" | "success" | "accent";
}) {
  const toneClass = tone ? ` is-${tone}` : "";
  return (
    <div className="card metric">
      <div className="metric-label">{label}</div>
      <div className={`metric-value${toneClass}`}>
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
      {foot && <div className="metric-foot">{foot}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "danger" | "accent" | "warn";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Hash({
  value,
  head = 10,
  tail = 8,
}: {
  value?: string;
  head?: number;
  tail?: number;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const text = value ?? "";

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!text) return <span className="muted">—</span>;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* 剪贴板不可用时静默降级 */
    }
  };

  return (
    <span className="hash" title={text}>
      <span className="hash-text">{truncateHash(text, head, tail)}</span>
      <button
        type="button"
        className={`copy-btn${copied ? " is-done" : ""}`}
        onClick={onCopy}
        aria-label="复制"
        title={copied ? "已复制" : "复制"}
      >
        {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      </button>
    </span>
  );
}

export function Empty({
  title = "暂无数据",
  hint,
}: {
  title?: string;
  hint?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {hint && <div>{hint}</div>}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" style={{ gap: 10, padding: 18 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height: 14, width: `${92 - i * 9}%` }}
        />
      ))}
    </div>
  );
}

/** 三种数据态的统一下沉：加载中 / 空 / 有数据 */
export function DataState<T>({
  data,
  emptyTitle,
  emptyHint,
  children,
}: {
  data: T[] | null;
  emptyTitle?: string;
  emptyHint?: string;
  children: (data: T[]) => ReactNode;
}) {
  if (data === null) return <Loading />;
  if (data.length === 0) return <Empty title={emptyTitle} hint={emptyHint} />;
  return <>{children(data)}</>;
}

export function DataTable({
  head,
  children,
}: {
  head: ReactNode[];
  children: ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* 静默降级 */
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <pre className="code-block">{text}</pre>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={onCopy}
        style={{ position: "absolute", top: 8, right: 8 }}
      >
        {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}
