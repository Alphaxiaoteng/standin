## StandIn — 赞助商 Bounty 契合度评估

评估日期 2026-10-01。Track 04（Trust, Identity & AI Infrastructure）。提交截止 2026-10-12/13。

官方奖项清单以 [monad.xyz/metropolis](https://monad.xyz/metropolis) 为准。下面每一项都标「已具备」或「待补」，待补的写清缺什么。不夸大：不合适就直说。

本仓库当前可核验的硬事实：
- 测试：`pnpm vitest run` → 153 passed / 16 files。
- 构建：`pnpm build` → exit 0，9 业务页面 + 11 API 路由。
- 合约源码（`contracts/src/`）：`StandInAnchor`（锚定彩排报告哈希 + 放行/拦截裁决）、`PaymentVault`（策略限额内托管本金）。**尚未部署到 Monad testnet** —— 2026-10-01 用 `eth_getCode` 查官方 RPC，两个计划地址（`0xdebc4e…452e` / `0x55446e…3ee6`）均返回空字节码；`contracts/broadcast/` 内 `hash: null`、`receipts: []`，从未广播。
- 合约测试：`cd contracts && forge test` → **4 passed**（访问控制 / 周期轮转 / 放行成功 / 流氓 Agent 被拦截）。这是当前可主张的最强证明；部署完成前不主张任何链上证据。

核心门禁实现（下面反复引用）：
- `lib/rehearse.ts` `compareIntent()`：声明意图 vs 实际 calldata 逐字段比对（action / token / 收款方 / 金额超出 / 无限授权）。
- `lib/runner.ts` `ScriptedAgentRunner.runTask()` + `generateReportHash()`：真实 `keccak256` 报告哈希，放行返回 `EXECUTED`，不一致返回 `INTERCEPTED`。
- `lib/scenarios.ts`：三剧本 — `scenarioAllowed`（transfer 0.5 USDC → 供应商，一致，放行）、`scenarioBlockedRecipient`（声明 → 供应商，实际 → `PHISHING_ATTACKER`，拦截）、`scenarioBlockedInfiniteApproval`（声明 approve 1.0 USDC，实际 `2^256-1`，拦截）。
- `lib/agent/guard.ts`：策略/止损状态机 — 单笔超上限直接拒（`rejectIfOverCap`）、当日净亏 ≥ 预算 30% 停手、连亏 3 单暂停类型。
- `lib/ledger.ts` `Policy`：`maxPerTx` / `maxPerWeek` / `merchantHash`（收款方白名单）/ `expires`。
- `contracts/src/PaymentVault.sol` `release()`：链上强校验 — 报告已锚定且放行、金额/收款方/token 与报告一致、agent 绑定、`amount <= maxPerTx`、每周 epoch 滚动 `weeklySpent + amount <= maxPerWeek`、`block.timestamp <= expires`。

---

## 1. MetaMask — Best Agent Wallet Plugin（$2,500）

**官方评选标准**（[docs.metamask.io/agent-wallet](https://docs.metamask.io/agent-wallet/plugins/build-a-plugin.md)）：基于 `@metamask/agent-wallet` 插件规范开发插件。插件是一个 npm 包，`package.json` 带 `mm` manifest 块（`schemaVersion` / `minCliVersion` / `capabilities` / `commands[]`），每条命令继承 `PluginCommand` 实现 `execute`，安装时用户逐条命令同意 capability 与 dataAccess。Agent 在用户预设策略限额内自主支付；超限需拦截或走 2FA 审批。Guard Mode 的护栏是：网络/地址/token 收款方 allowlist + rolling 24h 流出限额 + 威胁扫描，超出 allowlist 或非终局危险交易暂停并等用户批准。

**契合度：最高。这是我们门禁最对口的一个奖。**

Guard Mode 的「限额内自主、超限拦截/2FA」与我们做的几乎逐条对应，而且我们的门禁补上了 Guard Mode 没有的一层：

| MetaMask Guard Mode 有的 | 我们已具备的等价实现 | 我们额外的 |
|---|---|---|
| 地址/收款方 allowlist | `PaymentVault.sol` `merchantHash` + `release` 里 `rTo == to`；`lib/ledger.ts` `Policy.merchantHash` | — |
| per-tx 限额 | `Policy.maxPerTx`；`release()` `require(amount <= p.maxPerTx)` | — |
| rolling 流出限额 | `Policy.maxPerWeek`；`release()` 按 7 天 epoch 滚动 `weeklySpent` | — |
| 超限拦截 / 2FA | `lib/agent/guard.ts` `rejectIfOverCap` 直接拒；`lib/rehearse.ts` 不一致 → `INTERCEPTED` | 见下行 |
| 威胁扫描（事后/启发式） | — | **执行前逐字段比对「声明意图 vs 实际 calldata」**（`compareIntent`），收款方被提示词注入篡改、`2^256-1` 无限授权都能在签名前拦下 |
| — | — | **PnL 型止损**：连亏/日亏触发停手，Guard Mode 没有这层（`lib/agent/guard.ts`） |

**我们凭什么申报（指向具体实现）：**
- 策略模型已成型且落盘：`app/api/policies/route.ts`（单笔上限、周上限、收款方 `merchantHash`、`expires`，全部服务端校验）+ `app/api/policies/revoke/route.ts`（撤销），UI 在 `app/wallet/page.tsx`。这套字段形状和 Guard Mode 的 allowlist + per-tx + outflow limit 一一对应，直接可映射成策略。
- 门禁与放行/拦截裁决：`lib/rehearse.ts` + `lib/runner.ts` + `lib/scenarios.ts`，三剧本 `allowed→EXECUTED` / `phishing→INTERCEPTED（避免损失 0.50 USDC）` / `infinite→INTERCEPTED（避免损失 1.00 USDC）`，避免损失金额是 `lib/agent/avoidedLoss.ts` 从真实彩排记录推导，非写死。
- 裁决锚定与限额托管的**合约实现**：`StandInAnchor.sol`（放行/拦截都锚定，`totalAnchored` / `totalBlocked` 计数）+ `PaymentVault.sol`（限额内放款，报告不一致直接 revert），`forge test` 4 passed。**注意：合约尚未部署，地址上没有字节码**（见上文核验）；它现在是「可编译可测的合约代码」，不是「已上链的证明」。申报时如果写了部署，会被评委用 `eth_getCode` 当场戳穿。
- 插件开发经验：工作区已有 `../earner-dsh-plugin/index.js`（`mm`-风格的命令式插件：4 条工具、manifest、`inject`、`apply(ctx, config)`）。**如实说明：那是 DSH/DeepSeek agent 宿主的插件（`@deepseek-ai/schemastery`），不是 `@metamask/agent-wallet`。命令式插件的写法经验可复用，但目标 SDK 不同，MetaMask 插件仍需从零按官方模板实现。**

**状态：核心机制「已具备」，MetaMask 插件「待补」。**

待补（要拿这个奖必须补的）：
1. 按 [官方模板](https://github.com/MetaMask/agent-wallet-plugin-template) 建一个 npm 包，`package.json` 写 `mm` manifest（命令 id、`capabilities` 如 `wallet-read`/`wallet-submit`、`dataAccess`），命令继承 `PluginCommand`。当前仓库零个 `@metamask/agent-wallet` 依赖（`package.json` 只有 next/react/viem/better-sqlite3）。
2. 把我们的门禁做成插件命令，例如 `mm standin rehearse`（跑 `compareIntent`，返回放行/拦截 + 报告哈希）、`mm standin policy set/get`（映射 `maxPerTx`/`maxPerWeek`/`merchantHash`/`expires` 到 Guard Mode 的 `mm wallet policy`）。需要实际调用 `@metamask/agent-wallet` 的 SDK 类型，而不是复用我们内部 `/api`。
3. 在 Monad testnet 上跑通一次真实 `mm` 端到端：server wallet + Guard Mode，让 Agent 在限额内自主付款、越线时触发插件拦截或 `mm` 的 2FA 审批。这一步需要装 `@metamask/agent-wallet` CLI（Node 22.18+），目前完全没接。
4. 决定叙事边界：我们是「给 Guard Mode 叠一层执行前意图比对」的互补插件，不是重造钱包。文档和 demo 要讲清这点，否则评委会问「和 mm 自带 allowlist 有什么不同」——答案是不同：mm 拦「不该做的收款方/超限」，我们额外拦「声明和实际偷偷不一致」。

工作量评估：中等偏上。策略字段和门禁逻辑是现成的，主要成本在插件包脚手架 + `mm` CLI 端到端联调。$2,500，性价比高，是首选申报项。

---

## 2. Perpl — Best Analytics / Risk Tool（$3,000）

**官方评选标准**：链上交易分析与风险拦截工具。Perpl 是 Monad 上的 isolated-margin 永续 DEX（testnet chainId 10143，BTC=market 16 / ETH=32 / SOL=48 / MON=64 / ZEC=256；[docs.perpl.xyz](https://docs.perpl.xyz/resources/for-developers/overview)）。同一赞助商另有 **Best use of Perpl's API（$5,000）**，两者独立，本项按 $3,000 评估。

**契合度：中等偏高，但要诚实。** 「风险拦截工具」这半句正好是我们的主赛道——门禁 + 止损 + 避免损失量化，是一个真的风险拦截系统。问题在后半句：评委大概率期待工具**分析 Perpl 的链上数据**，而我们现在的数据源是 CoinGecko / Coinbase / Hacker News，**仓库里没有任何 Perpl 集成**（`grep perpl` 无命中）。

**我们凭什么申报（现有可复用部分）：**
- 风险拦截引擎与上面 MetaMask 项同一套：`lib/rehearse.ts` + `lib/agent/guard.ts` + `lib/agent/avoidedLoss.ts`，且 `app/api/intercepts/route.ts` 已把「累计避免损失」做成了 API（`protection.totalAvoidedLossUsdc`）。这是一个能演示「拦截 = 省下的钱」的风险工具骨架。
- 多源健康度 + 价差容忍：`lib/market/health.ts`（失败率滑动平均 × 延迟折扣，阈值 0.6）、`lib/agent/verify.ts`（双源价差 ≤50bps、新鲜度 ≤60s）。这套「双源比对 + 越带告警」的监测器天然能改造成 Perpl 分析工具。

**状态：待补（缺 Perpl 数据接入）。**

待补（补上才配得上这个奖）：
1. 接 Perpl testnet 公开行情端点 `GET /v1/pub/context` 与市场数据 WS，把 Perpl mark/oracle 价作为第三方价格源接进 `lib/market/sources.ts`（现有 adapter 形状统一返回 `fetchedAt` + `latencyMs`，加一个 Perpl source 是增量工作）。
2. 把 `spread_watch` 任务从「CoinGecko vs Coinbase 现货价差」扩成「Perpl 永续标记价 vs 现货价差」监测——这是 Perpl 语境下真有人买单的风险信号（资金费率/脱锚/清算边缘），也让 `verifySpreadWatch()`（`lib/agent/verify.ts`）有 Perpl 数据可判。
3. 可选加分：针对 isolated-margin 的清算风险面板（仓位自带保证金耗尽即被清算、不牵连账户），做成「分析 + 告警」页，比通用拦截更贴 Perpl 评委口味。

优先级：这是**第二顺位**申报项。核心拦截能力已具备，但要拿 Perpl 的奖，Perpl API 集成这一步省不掉——不接就是「换了个说法的通用工具」，评委一问「用 Perpl 哪条端点了」就露底。工作量中等。

---

## 3. Qwen（阿里云）— Best Builds with Qwen 3.8 Max（$5,000 额度）

**官方评选标准**：用 Qwen 3.8 Max 构建项目。模型 id `qwen3.8-max`，2.4T MoE 旗舰，1M context，支持 Function Calling / Structured Outputs（[Alibaba Cloud Model Studio](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max)）。注意：奖的是 **$5,000 API credits（额度）**，不是现金。

**契合度：偏低，且和我们的架构取向有张力。直说。**

我们刻意**没把 LLM 放进资金决策链路**：`docs/MONEY_AGENT_PRD.md` §三 结尾写明「LLM 只润色说明，不能改预算、止损线和白名单」，§一 自我对抗表第 5 行也定了「理由由算法字段生成，LLM 只润色」；`app/opportunities/page.tsx:307` 界面同样写了「LLM 只润色文案，不决定接单顺序」。**当前代码零 LLM 调用**（`grep` 全仓库的 llm/openai/dashscope/anthropic 只命中 PRD 文字和这句诚实边界，没有任何实际调用）。这是设计选择——门禁的价值恰恰在于「确定性比对，不信任会幻觉的模型」。所以「核心用了 Qwen」这句话我们**不能写**，写了就违背红线且自相矛盾。

**那 Qwen 能合理落在哪：两个不碰资金路径的点上。**
1. **自然语言 → 声明意图提取**（最贴 hackathon 叙事）：用户/HN 热点里的非结构化文本，由 `qwen3.8-max` 用 Structured Outputs 解析成 `lib/rehearse.ts` 的 `Intent` JSON（action/token/to/amount/memo）。然后门禁照旧逐字段比对。这样钓鱼 demo 更真：注入从真实文本进来，模型提取出「A」，实际 calldata 是「B」，我们拦下——**LLM 负责把模糊变结构，门禁负责兜住模型的不可靠**。这不违反「不改资金参数」，因为它产出的只是待比对的声明意图，放行与否仍由 `compareIntent` 决定。
2. **日报/决策卡文案润色**：把 `lib/agent/sop.ts` 的 `SopStep[]`（打分/选择/门禁/验收各步的数值字段）交给 Qwen 写成人类可读的每日复盘，数字来源仍是算法。

**我们凭什么申报（现有可接的挂点）：**
- `Intent` 结构（`lib/rehearse.ts`）是干净的结构化输出目标，Function Calling / Structured Outputs 能直接对齐。
- SOP 已经把每步拆成带数值字段的 `SopStep`（`lib/agent/sop.ts`），给 LLM 润色有现成输入，不会让它编造。

**状态：待补（需接入才谈得上申报）。**

待补：
1. 建一个 DashScope/Model Studio 适配器，调 `qwen3.8-max`（Function Calling 或 Structured Outputs），把文本 → `Intent`。当前无任何 SDK/HTTP 调用代码。
2. 在门禁演示链路（`app/guardrail/page.tsx` 背后的 `lib/runtime.ts`）里，把「声明意图」的来源之一换成 Qwen 提取结果，展示「模型提取 + 门禁校验」协作。
3. **红线**：文档/demo 里必须写明 Qwen 不参与预算/止损/白名单，否则会被评委用「你既然说不信 LLM，为什么用 LLM」反问。
4. 申请 $5,000 credits 账号、留存调用日志（评委看「真调用」而非接了没调）。

优先级：**第三**。它是「加分/凑申报广度」，不是能稳拿的项。额度型奖励、且架构上有内在张力，需要小心措辞。若时间紧张，可只做挂点 1（NL→Intent）作为最小可信 demo，其余如实标注为规划。

---

## 4. Privy — Privy!（$5,000）

**官方评选标准**：Privy 嵌入式钱包（embedded wallet）集成。

**契合度：如实评估——目前没接，价值中等，工作量不小，不建议作为主攻项。**

现状：`grep privy` 全仓库只命中 `docs/MONEY_AGENT_PRD.md:168` 那句 FAQ（「和 Privy、Coinbase 策略引擎有何不同」），是**拿 Privy 当竞品对比**，不是集成。`package.json` 无 Privy 依赖。没有用户登录/钱包抽象：`app/wallet/page.tsx` 是「经营设置」（看策略、本金、预算），不是真钱包；放款用的是部署 EOA，Agent 无浏览器端签名链路。

**要接 Privy 得做的事（都不小）：**
1. 引入 `@privy-io/react-auth`（或对应 SDK），做 email/social 嵌入式登录，给「存本金、设策略、撤销授权的人类用户」一个自持钱包。
2. 把该钱包接到 `PaymentVault.sol` 的 `deposit` / `promote` / `revoke`（这些现在是 `msg.sender` 直接调，需要一个真实前端 signer 链路；现在 `viem` 只读，`chain.ts` 无 `createWalletClient`，无 `signTransaction`/`privateKey`，`grep` 已确认）。
3. 可能还要 Privy server wallet 区分「用户金库」与「Agent 操作密钥」。

**价值判断**：Privy 会让「给金库充值/改策略」这一步在 UX 上更像产品（评委 2-3 分钟能跑通的核心链路里，充值这环更顺）。但它和 MetaMask 项功能重叠（两个都在解决「Agent 怎么持/花钱包」），二选一的话 MetaMask Agent Wallet Plugin 更贴「Agent 自主支付 + 门禁」的核心叙事。Privy 更偏「终端用户嵌入钱包」，与我们「Agent 花钱前过门禁」这条主线相关性弱一档。

**状态：完全待补。** 无依赖、无登录 UI、无钱包-金库打通。属于「有余力再接的广度项」，非性价比高的主攻方向。

---

## 5. 可叠加的生态资源包（Participant Resources，面向所有参赛队）

这些是 [monad.xyz/metropolis](https://monad.xyz/metropolis) 「Participant resources」栏列的**每支参赛队免费领**的工具，不是竞赛奖项——可与上面 bounty 叠加使用，降低联调/上链成本。怎么用：

- **Quicknode — 3 个月 Build Plan（免费）**：拿到专属 Monad testnet RPC 端点，把 `lib/chain.ts` 的默认公共 `testnet-rpc.monad.xyz` 换成专属 endpoint（走 `NEXT_PUBLIC_MONAD_RPC_URL`，`chain.ts:11` 已读该 env）。价值：我们 SOP 每一单要发多次 `eth_call`/`eth_getLogs`，公共 RPC 限流会打断 demo；专属端点 + WSS 更稳，且 `chain.ts` 注释已记录 Monad RPC 坑（`newPendingTransactions` 不支持、资金记账读 finalized、`eth_getLogs` 区块窗 100–1000），Quicknode 的 `monadLogs` 订阅正好绕开这些。这是**最该立刻用**的资源。
- **Tenderly — Pro（免费 license）**：官方描述「simulate, debug and monitor」。直接服务我们的门禁主题——`PaymentVault.release()` 有 9 条 `require` 分支（report not allowed / report mismatch / agent caller mismatch with report / no policy / unauthorized agent caller / policy expired / exceeds per-tx limit / exceeds weekly limit / insufficient deposit），用 Tenderly **simulate** 逐条跑出失败证据截图，比只讲「合约会拒绝」更有说服力；**debug** 锚定失败交易；**monitor** 盯 `StandInAnchor.Anchored` / `PaymentVault.Released` 事件。属于「已具备合约、待用 Tenderly 补验证证据」的增量。
- **Dwellir（3 个月 Developer）/ Spectrum Nodes（2 个月 Business）/ BlockVision（2 个月 Lite）**：都是备用 RPC。可把它们当作 `lib/market/health.ts` 那套 tracker 的新监控对象（现有 `DATA_SOURCES = ["coingecko","coinbase","hn"]`，加 RPC 源是同样的健康度模式），做多 RPC 冗余 + 健康度切换，呼应 PRD §四「RPC 限流：排队退避重试」。
- **Zerion — 1 个月 API Builder**：50+ 链钱包数据。可选低优先——给 `app/wallet` 展示金库余额/历史时少写点 RPC 手撸，锦上添花，非必需。

这些资源包本身**不计入任何 bounty 评分**，别把它们当卖点写进提交；它们的意义是「让我们现有实现跑得更稳、证据更全」，尤其是 Quicknode（稳 RPC）和 Tenderly（revert 分支证据）这两项，投入产出最高。

---

## 申报优先级汇总

| Bounty | 金额 | 状态 | 主攻/备选 |
|---|---|---|---|
| MetaMask Best Agent Wallet Plugin | $2,500 | 门禁/策略已具备；合约可编译可测（**未部署**）；`@metamask/agent-wallet` 插件包待补 | **首选**，与核心最契合 |
| Perpl Best Analytics / Risk Tool | $3,000 | 风险拦截引擎已具备；Perpl API 数据源完全待补 | 第二，补 Perpl 集成才不虚 |
| Qwen Best Builds with Qwen 3.8 Max | $5,000 credits（非现金） | 无 LLM 调用；NL→Intent 挂点待接 | 第三，加分广度项，措辞守红线 |
| Privy! | $5,000 | 完全待补，无依赖无登录无钱包打通 | 不建议主攻（与 MetaMask 重叠、主线相关性弱一档） |

一句话结论：把精力压在 **MetaMask 插件**（用现成门禁 + 策略模型，只补插件包和 `mm` 端到端）；Perpl 作为第二顺位但**必须先补 Perpl 行情接入**再申报；Qwen 作为轻量加分，只接「文本→声明意图提取」且不碰资金路径；Privy 除非有额外人力否则不投入。
