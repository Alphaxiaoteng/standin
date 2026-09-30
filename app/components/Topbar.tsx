"use client";

import { usePathname } from "next/navigation";
import { CHAIN_LABEL, NAV } from "./nav";

export default function Topbar() {
  const pathname = usePathname();
  const current = NAV.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );

  return (
    <header className="topbar">
      <div style={{ minWidth: 0 }}>
        <div className="topbar-title">{current?.label ?? "概览"}</div>
        <div className="topbar-sub">{current?.subtitle ?? "任务执行与实时流"}</div>
      </div>
      <div className="topbar-right">
        <span className="network-pill">
          <span className="dot" />
          {CHAIN_LABEL}
        </span>
      </div>
    </header>
  );
}
