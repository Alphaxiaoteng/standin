#!/usr/bin/env node
/**
 * 独立复核 README / docs/SUBMISSION.md 中的全部链上主张（Monad testnet 10143），只读，不需要私钥。
 *   node scripts/verify-onchain.mjs
 * 若已执行 `cd contracts && forge build`，额外比对本地编译产物与链上运行时字节码。
 */
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";

const RPC = process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const ANCHOR = "0x514047b2a6a06ed8c324b919774b4f751b61c930";
const VAULT = "0x499707245d853425c1a2b503e5f065acdde89929";
const DEPLOY_TXS = {
  StandInAnchor: "0x45d412500db0fe025bc200991712e5f98ddeb0461427a6fa12353743cb62b68c",
  PaymentVault: "0xaf09a2d29d18a2d4fc24b002a136fc0ae70e9eb7ef40b3af1a3e48235fedbc6f",
};
const ANCHORED_BLOCK = 67218203n;

const abi = parseAbi([
  "function anchor() view returns (address)",
  "function totalAnchored() view returns (uint64)",
  "function totalBlocked() view returns (uint64)",
  "function reports(bytes32) view returns (bytes32,address,address,uint256,address,bool,uint64,string)",
]);
const anchoredEvent = parseAbiItem(
  "event Anchored(bytes32 indexed reportHash, address indexed agent, bool allowed, string reason)",
);

const client = createPublicClient({ transport: http(RPC) });
let failed = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const chainId = await client.getChainId();
check(chainId === 10143, "chainId", String(chainId));

const contracts = { StandInAnchor: ANCHOR, PaymentVault: VAULT };
const onchainCode = {};
for (const [name, address] of Object.entries(contracts)) {
  const code = (await client.getCode({ address })) ?? "0x";
  onchainCode[name] = code;
  check(code.length > 2, `${name} 已部署`, `${address} codesize=${(code.length - 2) / 2}`);
  const receipt = await client.getTransactionReceipt({ hash: DEPLOY_TXS[name] });
  check(
    receipt.status === "success" && receipt.contractAddress?.toLowerCase() === address,
    `${name} 部署交易`,
    `block=${receipt.blockNumber}`,
  );
}

const wired = await client.readContract({ address: VAULT, abi, functionName: "anchor" });
check(wired.toLowerCase() === ANCHOR, "PaymentVault.anchor() 指向 StandInAnchor", wired);

const logs = await client.getLogs({
  address: ANCHOR,
  event: anchoredEvent,
  fromBlock: ANCHORED_BLOCK,
  toBlock: ANCHORED_BLOCK,
});
check(logs.length > 0, "区块 67218203 存在 Anchored 事件");
for (const log of logs) {
  const r = await client.readContract({
    address: ANCHOR,
    abi,
    functionName: "reports",
    args: [log.args.reportHash],
  });
  check(r[5] === false, "锚定裁决 allowed=false", `reportHash=${log.args.reportHash} tx=${log.transactionHash}`);
  console.log(`      reason: ${r[7]}`);
}
const blocked = await client.readContract({ address: ANCHOR, abi, functionName: "totalBlocked" });
check(blocked >= 1n, "StandInAnchor.totalBlocked ≥ 1", String(blocked));

// 去掉尾部 CBOR 元数据，并把 immutable 槽位置零后比较
const normalize = (hex, immutableRefs) => {
  let h = hex.toLowerCase().replace(/^0x/, "");
  const metaLen = parseInt(h.slice(-4), 16);
  h = h.slice(0, h.length - (metaLen + 2) * 2);
  for (const refs of Object.values(immutableRefs ?? {})) {
    for (const { start, length } of refs) {
      h = h.slice(0, start * 2) + "0".repeat(length * 2) + h.slice((start + length) * 2);
    }
  }
  return h;
};
for (const name of Object.keys(contracts)) {
  const artifact = `contracts/out/${name}.sol/${name}.json`;
  if (!existsSync(artifact)) {
    console.log(`SKIP  ${name} 字节码比对（先执行 cd contracts && forge build）`);
    continue;
  }
  const { deployedBytecode } = JSON.parse(readFileSync(artifact, "utf8"));
  const same =
    normalize(deployedBytecode.object, deployedBytecode.immutableReferences) ===
    normalize(onchainCode[name], deployedBytecode.immutableReferences);
  check(same, `${name} 本地源码编译产物 = 链上运行时字节码`);
}

console.log(failed === 0 ? "\n全部链上主张复核通过" : `\n${failed} 项复核失败`);
process.exit(failed === 0 ? 0 : 1);
