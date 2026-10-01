# StandIn

**The autonomous earning agent with intent-gated settlement rails.**

Monad Metropolis · Track 04 — *Trust, Identity & AI Infrastructure* (Sep 1 – Oct 13, 2026)

---

## 一句话

一个 AI Agent 自己接活、自己花钱、自己承担后果——但每一笔支出在签名前必须过一道门禁：比对「它声明要做什么」与「它实际要签什么」，不一致就拦下。

## 为什么需要它

2026 年的 Agent 已经能自主调用 API、签交易、花真金白银。但大模型的非确定性（幻觉、提示词注入）和「资金绝对确定性」天然冲突：

- Agent 被恶意内容诱导，把收款地址改成攻击者的钱包——声明的是 A，签的是 B
- 钓鱼合约返回畸形参数，Agent 签下 `2^256-1` 的无限授权，本金一次性归零
- Agent 没有止损，连续亏损直到本金耗尽

现有方案要么是纯规则限额（没有意图比对），要么是纯审计日志（事后才知道被偷）。**StandIn 做的是执行前的逐字段比对 + 执行后的确定性验收。**

## 它真正在做什么

不是模拟，不是脚本。Agent 每天：

1. **接活** — 从悬赏市场读取真实任务（内置 DEMO BUYER，也接受第三方发布）
2. **打分** — `EV = p × h × 报酬 − 成本 − 风险惩罚`，低于 0 直接放弃并写明理由
3. **过门禁** — 声明意图 vs 实际 calldata 逐字段比对，不一致即拦截
4. **干活** — 抓真实数据源（CoinGecko / Coinbase / Hacker News）
5. **被验收** — 确定性规则裁决：数据新鲜度 ≤ 60s、双源价差 ≤ 50bps
6. **记账** — 通过就赚钱，**不通过就如实记亏**，全部落盘

**关键：收入不是写死的。** 验收失败会产生真实的亏损单，这是特性而非 bug——PRD §1 明确禁止任何模拟收益。

## 诚实边界（写进界面，也写在这里）

- 测试币没有价值，只证明机制成立
- 账本里有亏损单；不出现「月收益」「年化」「稳赚」
- 本地流水号不是链上哈希——我们不广播交易，也不虚构广播记录
- 合约源码就绪、`forge test` 通过，但**部署状态以 `docs/SUBMISSION.md` 的实时核验为准**
- 不做真实资金交易，不构成投资建议

## 意图门禁：三个剧本，两个分支

| 剧本 | 声明 | 实际 calldata | 结果 |
|---|---|---|---|
| 正常采购 | transfer 0.5 USDC → 供应商 | 一致 | ✅ 放行 |
| 收款方篡改 | transfer 0.5 USDC → 供应商 | transfer → **攻击者地址** | 🚫 拦截 |
| 无限授权陷阱 | approve 1.0 USDC | approve → **2^256-1** | 🚫 拦截 |

判定全部由 `compareIntent()` 真实计算，没有任何 hardcoded 结果。红绿灯并排演示见 `/guardrail` 页。

## 合约（Monad Testnet, chainId 10143）

`contracts/src/`：

- `StandInAnchor` — 锚定彩排报告哈希与放行/拦截裁决，形成不可抵赖的决策履历
- `PaymentVault` — 在策略限额内托管 Agent 本金，放款只认 Anchor 中 `allowed=true` 的报告

```bash
cd contracts
forge test   # 4 passed（访问控制 / 周期轮转 / 放行成功 / 流氓 Agent 拦截）
```

**部署状态**：见 `docs/SUBMISSION.md` §二（含可复现的 `eth_getCode` 核验命令）。我们不预先主张链上证明。

## 运行

```bash
pnpm install
pnpm build        # 构建验证
pnpm vitest run   # 153 tests, 16 files
pnpm start -p 3313
```

打开 `http://127.0.0.1:3313`。

## 结构

```
lib/agent/      打分 / 选择 / 止损 / 验收 / SOP 状态机
lib/market/     数据源适配器 / 健康度 / 悬赏模型
lib/ledger.ts   JSON 落盘账本（原子写 + 回滚），重启不丢
lib/rehearse.ts 意图门禁核心：声明 vs calldata 逐字段比对
app/            今日账本 / 机会与决策 / 悬赏市场 / 门禁演示 / 本金保护 / 审计
contracts/      StandInAnchor + PaymentVault（Foundry 工程）
docs/           SUBMISSION（提交包）/ BOUNTIES（bounty 对位）/ DEMO_SCRIPT（3:08 逐镜脚本）
```

## 关于 ERC-8004

`StandInAnchor` 把每次门禁裁决锚定到 Agent 身份，与 Track 04 官方举例「Agent identity and reputation under ERC-8004」对齐。仓库内含对 Canonical 注册表的只读探测（`lib/erc8004.ts`），但**我们不把它当作核心卖点**——2026 年单纯的注册表调用已被视为清单式集成。我们的差异化在于「门禁是否真的拦住了」，而不是「是否注册了」。

## Why Monad

Agent 的经济活动是高频、小额、连续的：每一单都要拉数据、比对、记账、结算。传统 EVM 的 Gas 成本与出块间隔让这种频率无法成立。Monad 的并行 EVM 与高速终局，让「每一笔微额支出都先过一道门禁再上链」从奢望变成默认动作。
