"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CHAIN_LABEL, NAV } from "./nav";
import { IconShield } from "./icons";

export default function Sidebar() {
  const pathname = usePathname();
  const groups = NAV.reduce<Record<string, typeof NAV>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">
          <IconShield size={17} />
        </span>
        <span className="brand-text">
          <span className="brand-name">StandIn</span>
          <span className="brand-sub">Agent 支付护栏</span>
        </span>
      </div>

      <nav className="sidebar-nav">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <div className="nav-group-label">{group}</div>
            {items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={16} className="nav-icon" />
                  <span className="nav-label">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div>{CHAIN_LABEL}</div>
        <div style={{ marginTop: 4 }}>彩排一致，方可放款</div>
      </div>
    </aside>
  );
}
