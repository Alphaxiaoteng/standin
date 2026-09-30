import { defineChain } from "viem";

/** Monad Testnet — 官方参数（docs.monad.xyz/developer-essentials/testnet） */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz",
      ],
      webSocket: ["wss://testnet-rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
});

/** Canonical 合约（测试网，均已 eth_getCode 验证有代码，2026-09-29） */
export const CANONICAL = {
  x402ExactPermit2Proxy:
    "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" as const,
  x402UptoPermit2Proxy:
    "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002" as const,
  permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3" as const,
  entryPointV08: "0x4337084d9e255fF0702461CF8895cE9E3b5Ff108" as const,
  safeSingleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a" as const,
  testUsdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3" as const,
  wrappedMon: "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541" as const,
} as const;

export const EXPLORER = "https://testnet.monadvision.com";
export const FAUCET = "https://faucet.monad.xyz";

/** RPC 行为注意（docs.monad.xyz/reference/json-rpc/overview）：
 *  - debug_trace* 必须显式传 trace options（空对象 {} 默认 callTracer）
 *  - latest = Proposed 非终局；资金记账读 finalized
 *  - eth_getTransactionByHash 不返回 pending tx
 *  - eth_getLogs 区块窗 100–1000（按 provider）
 *  - newPendingTransactions 订阅不支持；用 monadLogs / newHeads
 */
