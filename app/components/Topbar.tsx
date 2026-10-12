"use client";

import { usePathname } from "next/navigation";
import ChainStatus from "./ChainStatus";
import WalletConnect from "./WalletConnect";
import { NAV } from "./nav";

export default function Topbar() {
  const pathname = usePathname();
  const current = NAV.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
  const path = pathname === "/" ? "~" : `~${pathname}`;

  return (
    <header className="topbar">
      <div style={{ minWidth: 0 }}>
        <div className="topbar-title">
          <span className="network-pill" style={{ marginRight: 10 }}>
            <span className="dot" />
            LIVE
          </span>
          {current?.label ?? "概览"}
          <span style={{ color: "var(--text-faint)" }}> — Agent 支付护栏 · 实时操作台</span>
        </div>
      </div>
      <div className="topbar-right">
        <ChainStatus />
        <WalletConnect />
        <span className="network-pill">{path}</span>
      </div>
    </header>
  );
}
