"use client";

/**
 * 浏览器注入钱包（MetaMask 等）会话。
 * 余额一律从 Monad 测试网 RPC 读取，不使用账本里的数字。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPublicClient, http } from "viem";
import { monadTestnet } from "@/lib/chain";
import {
  MONAD_CHAIN_ID,
  NO_WALLET_MESSAGE,
  connectAccount,
  explainWalletError,
  firstAddress,
  parseChainId,
  readMonadBalances,
  switchToMonad,
  type EthRequest,
} from "@/lib/walletSession";

type EthProvider = EthRequest & {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

export type WalletPhase = "idle" | "connecting" | "switching" | "reading" | "ready" | "error";

export type WalletSession = {
  phase: WalletPhase;
  hasProvider: boolean;
  address: string | null;
  chainId: number | null;
  chainOk: boolean;
  mon: number | null;
  usdc: number | null;
  error: string | null;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
  refresh: () => Promise<void>;
};

const WalletContext = createContext<WalletSession | null>(null);

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(monadTestnet.rpcUrls.default.http[0]),
});

function injected(): EthProvider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: EthProvider }).ethereum;
  return eth && typeof eth.request === "function" ? eth : null;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<WalletPhase>("idle");
  const [hasProvider, setHasProvider] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [mon, setMon] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readBalances = useCallback(async (account: string) => {
    setPhase("reading");
    setError(null);
    try {
      const balances = await readMonadBalances(publicClient, account);
      setMon(balances.mon);
      setUsdc(balances.usdc);
      setPhase("ready");
    } catch (e) {
      setMon(null);
      setUsdc(null);
      setError(`余额读取失败：${explainWalletError(e)}`);
      setPhase("error");
    }
  }, []);

  const sync = useCallback(
    async (account: string | null) => {
      const provider = injected();
      if (!provider || !account) {
        setAddress(null);
        setChainId(null);
        setMon(null);
        setUsdc(null);
        setPhase("idle");
        return;
      }
      setAddress(account);
      try {
        const hex = await provider.request({ method: "eth_chainId" });
        setChainId(parseChainId(hex));
      } catch {
        setChainId(null);
      }
      await readBalances(account);
    },
    [readBalances],
  );

  useEffect(() => {
    const provider = injected();
    setHasProvider(Boolean(provider));
    if (!provider) return;

    const onAccounts = (accounts: unknown) => {
      const next = firstAddress(accounts);
      void sync(next);
    };
    const onChain = (id: unknown) => {
      setChainId(parseChainId(id));
    };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);

    void (async () => {
      try {
        const accounts = await provider.request({ method: "eth_accounts" });
        const first = firstAddress(accounts);
        if (first) await sync(first);
      } catch {
        // 静默探测失败时保持未连接，不弹错误
      }
    })();

    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [sync]);

  const connect = useCallback(async () => {
    const provider = injected();
    setHasProvider(Boolean(provider));
    if (!provider) {
      setError(NO_WALLET_MESSAGE);
      setPhase("error");
      return;
    }
    setPhase("connecting");
    setError(null);
    try {
      const first = await connectAccount(provider);
      await sync(first);
    } catch (e) {
      setError(explainWalletError(e));
      setPhase("error");
    }
  }, [sync]);

  const switchChain = useCallback(async () => {
    const provider = injected();
    if (!provider) {
      setError("没有检测到浏览器钱包");
      setPhase("error");
      return;
    }
    setPhase("switching");
    setError(null);
    try {
      await switchToMonad(provider);
      setChainId(MONAD_CHAIN_ID);
      setPhase(address ? "ready" : "idle");
    } catch (e) {
      setError(explainWalletError(e));
      setPhase("error");
    }
  }, [address]);

  const refresh = useCallback(async () => {
    if (address) await readBalances(address);
  }, [address, readBalances]);

  const value = useMemo<WalletSession>(
    () => ({
      phase,
      hasProvider,
      address,
      chainId,
      chainOk: chainId === MONAD_CHAIN_ID,
      mon,
      usdc,
      error,
      connect,
      switchChain,
      refresh,
    }),
    [phase, hasProvider, address, chainId, mon, usdc, error, connect, switchChain, refresh],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletSession {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet 必须在 WalletProvider 内使用");
  return ctx;
}
