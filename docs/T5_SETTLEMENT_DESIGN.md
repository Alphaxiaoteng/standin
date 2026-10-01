# T5 设计：收入必须有链上证据（漏洞 C 修复）

> 写作日期：2026-10-01。状态：已实现（实现与本文档同步修订）。
> 原则：本地验收通过 ≠ 收到钱。收入入账的唯一依据是链上 USDC Transfer 回执。

## 0. 已核实的事实基础（2026-10-01 实测）

| 项 | 值 | 来源 |
| --- | --- | --- |
| 链 | Monad Testnet，chainId 10143 | `lib/chain.ts` |
| RPC | `https://testnet-rpc.monad.xyz`（默认，`NEXT_PUBLIC_MONAD_RPC_URL` 可覆盖；仓库无 .env） | `lib/chain.ts` |
| 演示 USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3`（代理合约，eth_getCode 有代码；symbol/decimals 经代理读取） | `lib/chain.ts` `CANONICAL.testUsdc`，与 `lib/ledger.ts` 的 `USDC` 常量同址 |
| 部署合约 | StandInAnchor `0x5140…930`、PaymentVault `0x4997…929`（均 status 成功） | `contracts/broadcast/Deploy.s.sol/10143/run-latest.json` |
| 本地合约测试 | `contracts/test/StandInSecure.t.sol` 的 TestUSDC 仅存在于 forge 测试，未部署；不使用其地址 | 同上 |
| Agent 收款地址 | 新增环境变量 `STANDIN_AGENT_ADDRESS`；未配置时 watcher 报"未配置"，收入保持 pending，绝不入账 | 本设计新增 |

## 1. 结算状态机

```
Bounty.settlement: "pending" | "confirmed" | "unpaid"
```

- **DEMO BUYER 单**（buyerType=demo）：验收通过 ⇒ 立即入账，settlement=confirmed，
  账本 `meta.billing="demo"`。demo 买方不发生链上转账，这部分收入**只能**显示为"演示收入"。
- **第三方单**（buyerType=third_party）：
  - 验收通过 ⇒ settlement=**pending**，只记成本账（status=PENDING，revenue=0），不入账收入；
  - watcher 在链上找到匹配的 USDC Transfer（from=buyerAddress, to=agentAddress,
    value ≥ rewardUsdc, 区块时间晚于验收时刻）⇒ settlement=**confirmed**，
    记一笔收入账（revenue=reward，`meta.billing="onchain"`，含 payoutTxHash + 区块号），wallet 才增加；
  - 超过悬赏过期时间仍未匹配 ⇒ settlement=**unpaid**，账本追加 FAILED 记录
    "买方未在期限内链上付款，收入 0，成本已花"（成本不重复记）。
- watcher 返回 **unknown**（RPC 错误/超限）时保持 pending，绝不判 unpaid——
  "查不到"不等于"没付钱"。

## 2. 关键判定函数（`lib/chain/settlementWatcher.ts`）

```ts
findPayment({ buyer, agent, minValue, since, client? }):
  | { status: "found"; txHash; blockNumber; value }
  | { status: "not_found" }
  | { status: "unknown"; reason }
```

实现要点：
1. viem `createPublicClient({ chain: monadTestnet, transport: http(rpc) })`；client 可注入（单测用 fake）。
2. 二分法把 `since`（Unix ms）映射到起始区块；`eth_getLogs` 分段扫描（段 ≤ 900 块）
   USDC 合约的 `Transfer(address,address,uint256)`，args 过滤 from/to。
3. 逐条校验 `value ≥ minValue` 与区块时间 `> since`；命中即取 txHash 与区块号。
4. 任何 RPC 异常 ⇒ `unknown`。

`pollPendingSettlements()`：遍历 pending 状态的第三方悬赏，逐个 findPayment，
confirmed ⇒ `ledger.settle` 收入 + 更新 bounty；过期且 not_found ⇒ unpaid + FAILED 记账。
调用时机：`/api/earnings/report` GET、`sopRuntime.tick()` 结束后。

## 3. 数据模型改动

- `Bounty` 增加 `buyerAddress?`、`payoutTxHash?`、`payoutBlockNumber?`、`settlement`
  （reviver 兼容旧文件：缺省按 buyerType 给 demo=confirmed / third_party=pending）。
- `LedgerEntryStatus` 增加 `"PENDING"`。
- `Ledger` 增加 `creditBalance(amount)`：只更新钱包余额不落账（收入账由调用方 settle），
  取代 `recordSpend(-amount)` 这个负支出 hack（验收 grep：`recordSpend(-` 在 lib 下无结果）。
- `LedgerEntry.meta.billing: "demo" | "onchain"` 区分两类收入；汇总接口分别返回
  `demoUsdc` 与 `onchainUsdc`，**永不相加**。

## 4. 状态机接线（`lib/agent/sop.ts` + `sopRuntime.ts`）

- 结算分支（步骤 7）：
  - 验收失败：不变（成本沉没，FAILED，连亏计数 +1）。
  - demo 单验收通过：与原流程一致入账，但 `meta.billing="demo"`。
  - 第三方单验收通过：`settlement=pending`，记 PENDING 成本账，revenue=0，
    guard 按交付成功更新（成本计入今日成本），后验 observe(true)（交付质量与收款解耦）。
  - wallet.credit 改走 `ledger.creditBalance`。
- tick 收尾：跑一轮 `pollPendingSettlements()`（容忍失败，不阻塞主流程）。

## 5. API

- `POST /api/bounties`：第三方买方必须提供合法 `buyerAddress`（viem isAddress 校验）；demo 不要求。
- `GET /api/earnings/report`：先跑一轮 watcher（30 秒内可见），返回
  `revenue: { demoUsdc, onchainUsdc }`、`pendingBounties`、`onchainTxs`（txHash + 区块浏览器链接）。
- `GET /api/opportunities`：机会卡透出 `agentAddress`（未配置时为 null，页面提示）。

## 6. 测试矩阵

| 场景 | 期望 |
| --- | --- |
| 三事件中金额匹配的转账 | found，带 txHash/区块号 |
| 金额不足 | not_found |
| from ≠ buyer（事件过滤） | not_found |
| 区块时间早于验收时刻 | not_found |
| RPC 抛错 | **unknown**（不判 unpaid） |
| 第三方单验收通过 | 收入 0，PENDING 账本，settlement=pending |
| watcher 命中 | settlement=confirmed，收入入账，payoutTxHash 落 bounty 与账本 |
| 过期未付 | settlement=unpaid，FAILED 记账，成本不重复 |
| demo 单验收通过 | 立即入账，meta.billing=demo |
| 汇总 | demoUsdc 与 onchainUsdc 分列 |

## 7. 界面口径（与 T8 衔接）

- "链上确认收入"与"演示收入"两行分开；不得出现合并的"净赚"。
- 买方标签：DEMO BUYER / COMMUNITY BUYER（第三方且链上付款）。
- 每笔链上确认收入可点开交易哈希 → 区块浏览器。
