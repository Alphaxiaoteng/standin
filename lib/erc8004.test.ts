import { describe, it, expect } from "vitest";
import { probeERC8004 } from "./erc8004";

describe("ERC-8004 Canonical Integration", () => {
  it("should read canonical IdentityRegistry on Monad Testnet", async () => {
    const res = await probeERC8004();
    expect(res.alive).toBe(true);
    expect(res.name).toBe("AgentIdentity");
    expect(res.symbol).toBe("AGENT");
    expect(typeof res.version).toBe("string");
  }, 15000); // 网络请求给 15s 超时
});