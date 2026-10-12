/**
 * 注入钱包的可测部分：连接、切到 Monad 测试网、读 MON / USDC。
 * 不依赖 window。余额读取走调用方传入的 reader，测试用替身。
 */
import { isAddress } from "viem";
import { CANONICAL } from "./chain";

export const MONAD_CHAIN_ID = 10143;
export const MONAD_CHAIN_HEX = "0x279f";
export const TEST_USDC = CANONICAL.testUsdc;

export const NO_WALLET_MESSAGE = "没有检测到浏览器钱包。请安装 MetaMask 或兼容的注入钱包。";

export const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type EthRequest = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type BalanceReader = {
  getBalance: (args: { address: `0x${string}` }) => Promise<bigint>;
  readContract: (args: {
    address: `0x${string}`;
    abi: typeof balanceOfAbi;
    functionName: "balanceOf";
    args: readonly [`0x${string}`];
  }) => Promise<bigint>;
};

export function explainWalletError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: number }).code;
    if (code === 4001) return "你取消了钱包请求";
  }
  const message = error instanceof Error ? error.message : "";
  if (/user rejected|user denied/i.test(message)) return "你取消了钱包请求";
  if (message) return message.slice(0, 160);
  return "钱包请求失败";
}

export function parseChainId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.startsWith("0x")) {
    const n = parseInt(value, 16);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function firstAddress(accounts: unknown): string | null {
  if (!Array.isArray(accounts)) return null;
  const value = accounts[0];
  return typeof value === "string" && isAddress(value) ? value : null;
}

export async function readMonadBalances(
  reader: BalanceReader,
  account: string,
): Promise<{ mon: number; usdc: number }> {
  const address = account as `0x${string}`;
  const [native, token] = await Promise.all([
    reader.getBalance({ address }),
    reader.readContract({
      address: TEST_USDC,
      abi: balanceOfAbi,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);
  return { mon: Number(native) / 1e18, usdc: Number(token) / 1e6 };
}

export async function connectAccount(provider: EthRequest): Promise<string> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const address = firstAddress(accounts);
  if (!address) throw new Error("钱包没有返回地址");
  return address;
}

export function monadChainParams() {
  return {
    chainId: MONAD_CHAIN_HEX,
    chainName: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: ["https://testnet-rpc.monad.xyz"],
    blockExplorerUrls: ["https://testnet.monadvision.com"],
  };
}

/** 切到 10143。钱包里没有这条链（4902）时先添加再视为成功。 */
export async function switchToMonad(provider: EthRequest): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: MONAD_CHAIN_HEX }],
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? (error as { code?: number }).code
      : undefined;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [monadChainParams()],
    });
  }
}
