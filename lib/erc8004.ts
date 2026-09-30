import { createPublicClient, http, parseAbi } from "viem";
import { monadTestnet } from "./chain";

export const ERC8004_IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
export const ERC8004_REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;

// 官方 ABI 方法提取
const identityAbi = parseAbi([
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function getAgentWallet(uint256 tokenId) external view returns (address)",
  "function getVersion() external view returns (string)",
]);

export async function probeERC8004() {
  const client = createPublicClient({
    chain: monadTestnet,
    transport: http(),
  });

  try {
    const [name, symbol, version] = await Promise.all([
      client.readContract({ address: ERC8004_IDENTITY, abi: identityAbi, functionName: "name" }),
      client.readContract({ address: ERC8004_IDENTITY, abi: identityAbi, functionName: "symbol" }),
      client.readContract({ address: ERC8004_IDENTITY, abi: identityAbi, functionName: "getVersion" }),
    ]);

    return {
      address: ERC8004_IDENTITY,
      name,
      symbol,
      version,
      alive: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("ERC-8004 probe error:", msg);
    throw err;
  }
}
