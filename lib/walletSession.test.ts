import { describe, expect, it } from "vitest";
import {
  MONAD_CHAIN_HEX,
  MONAD_CHAIN_ID,
  NO_WALLET_MESSAGE,
  TEST_USDC,
  connectAccount,
  explainWalletError,
  firstAddress,
  parseChainId,
  readMonadBalances,
  switchToMonad,
  type BalanceReader,
  type EthRequest,
} from "./walletSession";

const ACCOUNT = "0x9c372fa264cf6bd780f03784c247778de8c0be3e";

function fakeProvider(handlers: Record<string, (params?: unknown) => Promise<unknown> | unknown>): EthRequest & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    request: async ({ method, params }) => {
      calls.push(method);
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected ${method}`);
      return handler(params);
    },
  };
}

describe("walletSession", () => {
  it("没有注入钱包时的提示文案是固定的", () => {
    expect(NO_WALLET_MESSAGE).toContain("没有检测到浏览器钱包");
  });

  it("用户拒绝连接时给出可见原因", () => {
    expect(explainWalletError({ code: 4001 })).toBe("你取消了钱包请求");
    expect(explainWalletError(new Error("User rejected the request"))).toBe("你取消了钱包请求");
  });

  it("connectAccount 取第一个合法地址", async () => {
    const provider = fakeProvider({
      eth_requestAccounts: async () => [ACCOUNT],
    });
    await expect(connectAccount(provider)).resolves.toBe(ACCOUNT);
    expect(provider.calls).toEqual(["eth_requestAccounts"]);
    expect(firstAddress([])).toBeNull();
    expect(firstAddress(["not-an-address"])).toBeNull();
  });

  it("switchToMonad 切到 chainId 10143", async () => {
    let switched: unknown;
    const provider = fakeProvider({
      wallet_switchEthereumChain: async (params) => {
        switched = params;
      },
    });
    await switchToMonad(provider);
    expect(switched).toEqual([{ chainId: MONAD_CHAIN_HEX }]);
    expect(parseChainId(MONAD_CHAIN_HEX)).toBe(MONAD_CHAIN_ID);
  });

  it("钱包里没有 Monad 时先添加再成功", async () => {
    const provider = fakeProvider({
      wallet_switchEthereumChain: async () => {
        throw { code: 4902 };
      },
      wallet_addEthereumChain: async (params) => {
        const row = (params as Array<{ chainId: string }>)[0];
        expect(row.chainId).toBe(MONAD_CHAIN_HEX);
      },
    });
    await switchToMonad(provider);
    expect(provider.calls).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain"]);
  });

  it("用替身读取 MON 与测试网 USDC", async () => {
    const reader: BalanceReader = {
      getBalance: async () => 1_500_000_000_000_000_000n,
      readContract: async (args) => {
        expect(args.address).toBe(TEST_USDC);
        expect(args.args[0]).toBe(ACCOUNT);
        return 2_500_000n;
      },
    };
    await expect(readMonadBalances(reader, ACCOUNT)).resolves.toEqual({ mon: 1.5, usdc: 2.5 });
  });

  it("余额读取失败会抛出，由界面显示错误", async () => {
    const reader: BalanceReader = {
      getBalance: async () => {
        throw new Error("rpc down");
      },
      readContract: async () => 0n,
    };
    await expect(readMonadBalances(reader, ACCOUNT)).rejects.toThrow("rpc down");
  });
});
