"use client";

/**
 * 链上状态条（终端驾驶舱）：真实轮询 Monad 测试网区块高度 + 本地时钟。
 * 拉不到就如实显示 "--"，绝不编造。
 */

import { useEffect, useState } from "react";

const RPC = process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";

export default function ChainStatus() {
  const [block, setBlock] = useState<number | null>(null);
  const [clock, setClock] = useState<string>("");

  useEffect(() => {
    let alive = true;

    const tick = () => {
      const d = new Date();
      const hh = `${d.getHours()}`.padStart(2, "0");
      const mm = `${d.getMinutes()}`.padStart(2, "0");
      const ss = `${d.getSeconds()}`.padStart(2, "0");
      if (alive) setClock(`${hh}:${mm}:${ss}`);
    };

    const poll = async () => {
      try {
        const res = await fetch(RPC, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
          cache: "no-store",
        });
        const raw: unknown = await res.json();
        const hex = (raw as { result?: unknown })?.result;
        if (typeof hex === "string" && /^0x[0-9a-f]+$/.test(hex) && alive) {
          setBlock(parseInt(hex, 16));
        }
      } catch {
        // 保持上一次值或 null；如实显示
      }
    };

    tick();
    const clockTimer = setInterval(tick, 1000);
    void poll();
    const blockTimer = setInterval(poll, 12_000);

    return () => {
      alive = false;
      clearInterval(clockTimer);
      clearInterval(blockTimer);
    };
  }, []);

  return (
    <span className="statbar">
      <span>
        BLOCK <b>{block === null ? "--" : block.toLocaleString("en-US")}</b>
      </span>
      <span className="sep">|</span>
      <span>
        <b>{clock || "--:--:--"}</b>
      </span>
    </span>
  );
}
