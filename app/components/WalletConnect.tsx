"use client";

import { IconAlert, IconLink, IconWallet } from "./icons";
import { formatAmount } from "./format";
import { useWallet } from "./WalletProvider";

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function WalletConnect() {
  const wallet = useWallet();
  const busy = wallet.phase === "connecting" || wallet.phase === "switching" || wallet.phase === "reading";

  let label = "连接钱包";
  let icon = <IconLink size={13} />;
  if (!wallet.hasProvider && wallet.phase === "error") {
    label = "未检测到钱包";
    icon = <IconAlert size={13} />;
  } else if (wallet.phase === "connecting") {
    label = "连接中…";
  } else if (wallet.phase === "switching") {
    label = "切链中…";
  } else if (wallet.phase === "reading") {
    label = "读取余额…";
    icon = <IconWallet size={13} />;
  } else if (wallet.address && !wallet.chainOk) {
    label = "切到 Monad";
    icon = <IconAlert size={13} />;
  } else if (wallet.address) {
    label = short(wallet.address);
    icon = <IconWallet size={13} />;
  }

  const onClick = () => {
    if (busy) return;
    if (wallet.address && !wallet.chainOk) void wallet.switchChain();
    else if (!wallet.address) void wallet.connect();
    else void wallet.refresh();
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        className="network-pill"
        onClick={onClick}
        disabled={busy}
        title={wallet.error ?? (wallet.address ? "再点一次刷新链上余额" : "连接 Monad 测试网钱包")}
        style={{
          cursor: busy ? "wait" : "pointer",
          color: wallet.address && wallet.chainOk ? "var(--text)" : "var(--text-dim)",
          borderColor: wallet.address && !wallet.chainOk ? "rgba(245, 158, 11, 0.45)" : undefined,
          opacity: busy ? 0.7 : 1,
        }}
      >
        {icon}
        {label}
        {wallet.address && wallet.chainOk && wallet.usdc !== null && (
          <b style={{ color: "var(--text)", fontWeight: 600 }}>{formatAmount(wallet.usdc)} USDC</b>
        )}
      </button>
    </span>
  );
}
