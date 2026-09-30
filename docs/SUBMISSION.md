# StandIn — 提交文档（Monad Metropolis · Track 04: Trust, Identity & AI Infrastructure）

> 项目名：**StandIn**
> Tagline：**花钱之前，先彩排。** 自主 Agent 的意图门禁：放款前逐字段比对「声明意图」与「实际 calldata」，不一致即拦截并留痕；收入由真实数据的确定性验收裁决，不通过就如实记亏。
>
> 本文档每一条主张都给出仓库内锚点（文件路径 / 可复现命令 / 地址），评委可用 `ls` / `grep` / 运行命令逐条核实。所有性能与资金主张均限定在 **Monad 测试网 · 演示规模** 语境。

---

## 一、评审四维度映射

### 1. Technical Execution（代码架构质量、稳定性、端到端闭环、生产级可用性）

| 产出 | 可核实锚点 |
|---|---|
| 单元测试 + 端到端测试全绿：153 passed / 16 files | `pnpm vitest run`（复现命令，实测输出 `Test Files 16 passed (16)`、`Tests 153 passed (153)`）；覆盖 `lib/*.test.ts`、`lib/agent/*.test.ts`、`lib/market/*.test.ts` |
| 合约层测试 4 passed（访问控制、放行、冒名 Agent 拦截、周期限额滚动） | `cd contracts && forge test`；用例见 `contracts/test/StandInSecure.t.sol` |
| 生产构建通过：exit 0，9 个业务页面 + 11 个 API 路由 | `pnpm build`（路由清单见构建输出 `Route (app)` 段；API 路由源文件 `app/api/**/route.ts`） |
| 意图比对引擎：action / token / 收款方 / 金额超声明 / 无限授权 五类偏差检测 | `lib/rehearse.ts` `compareIntent()` |
| 彩排报告哈希为真实 keccak256（任务 + 声明意图 + 实际 calldata），非可碰撞近似 | `lib/runner.ts` `generateReportHash()`；commit `571ef78` |
| SOP 状态机八步闭环：发现→打分→选择→门禁→执行→验收→结算→复盘，全分支记账 | `lib/agent/sop.ts` `runSopTick()`；装配真实端口 `lib/agent/sopRuntime.ts` |
| 确定性验收规则：新鲜度 ≤60s、双源价差 ≤50bps、热点 5 条且可在 HN 榜单回查 | `lib/agent/verify.ts`（`MAX_AGE_MS = 60_000`、`MAX_SPREAD_BPS = 50`） |
| 真实数据源适配器（CoinGecko / Coinbase / Hacker News），统一返回值、抓取时刻、延迟，带超时与退避 | `lib/market/sources.ts`；实测探测记录（2026-09-30，状态码与延迟）见 `docs/MONEY_AGENT_PRD.md` §八 |
| 数据源健康度（失败率滑动平均 × 延迟折扣，阈值 0.6） | `lib/market/health.ts` |
| 止损在 Agent 之外强制：当日净亏 ≥30% 停手、连亏 3 单暂停类型、单笔超上限直拒 | `lib/agent/guard.ts`（`DAILY_LOSS_HALT_FRACTION = 0.3`） |
| 账本持久化带回滚：落盘 `.data/ledger.json`，原子写（临时文件 + `renameSync`），写失败回滚内存态并停机 | `lib/ledger.ts` `flush()` / `withRollback()` / `setHalted()`；`grep -n "renameSync" lib/ledger.ts` |
| 链上金库状态机（合约源码）：放款只认 Anchor 中 `allowed=true` 的报告，并强校验 Agent 身份、策略限额、周期限额、余额；`forge test` 4 passed | `contracts/src/PaymentVault.sol` `release()`；`contracts/src/StandInAnchor.sol` |
| 合约部署状态 | **未部署**。`contracts/broadcast/...run-latest.json` 内 `hash: null`、`receipts: []`（未广播）；2026-10-01 `eth_getCode` 查官方 RPC，计划地址 `0xdebc4e…452e` / `0x55446e…3ee6` 均返回 `0x`。源码与测试可核验，链上证据不存在 |
| CI 合约流水线 | `contracts/.github/workflows/test.yml`（Foundry fmt/build/test） |

诚实说明：提交范围即 `git ls-files` 所列内容；`lib/long-running-app-harness/`、`lib/cluster/`、`lib/monitoring/` 为无关脚手架，已按 `.gitignore` 排除且不参与 vitest；`docs/FINAL_ACCEPTANCE_REPORT.md` / `IMPLEMENTATION_SUMMARY.md` / `COMPLETE_GUIDE.md` / `SECURITY_AUDIT.md` 描述的是上述被排除模块，不作为本次提交的技术依据。

### 2. Innovation & Originality（稀缺新范式，而非换皮）

| 主张 | 可核实锚点 |
|---|---|
| 「彩排门禁」：Agent 花钱前先把**声明意图**与**实际 calldata** 逐字段比对，不一致即拦截——判定对象是"这一次调用"，不是"这个收款方" | `lib/rehearse.ts` 五字段比对；三个剧本定义 `lib/scenarios.ts` |
| 白名单挡不住的漂移也能拦：infinite 剧本里收款方**完全合法**，但金额是 2^256-1，照样 INTERCEPTED | `lib/scenarios.ts` `scenarioBlockedInfiniteApproval`；`lib/runner.test.ts` Scenario 3 |
| 收入不由脚本写死，由真实数据的确定性验收裁决；验收不过 = 成本已花 = 如实记亏 | `app/api/earnings/run/route.ts`（注释标明去掉固定 PROFILES，调 `sopRuntime.tick`）；`lib/agent/verify.ts` |
| 避免损失可量化且口径唯一：金额从同 taskId 彩排的声明意图推导，取不到就显示「金额未记录」，绝不编造 | `lib/agent/avoidedLoss.ts`；`app/api/intercepts/route.ts` |
| 拦截与账本绑定 Agent 身份（ERC-8004 身份为兼容项，非核心卖点）：Runner 构造参数即身份标识，记录逐条归属 | `lib/runner.ts` `ScriptedAgentRunner(agentAddress)`；`lib/runtime.ts` 以 `0xAgent_ERC8004_Identity_Bound` 实例化 |
| 三个门禁剧本闭环：allowed→EXECUTED；phishing→INTERCEPTED（该剧本声明金额 0.50 USDC）；infinite→INTERCEPTED（声明 1.00 USDC，实际 2^256-1） | `lib/scenarios.ts`（`BigInt(500000)`、`BigInt(1000000)` 即 0.50 / 1.00 USDC，6 位小数）；断言见 `lib/runner.test.ts` |

### 3. User Experience & Design（2-3 分钟跑通核心链路）

| 产出 | 可核实锚点 |
|---|---|
| 首页三数（收入 / 成本 / 净利，含负值）+ 时间轴流水，数据全部来自真实账本 | `app/page.tsx`；API `app/api/earnings/report/route.ts`（无数据返回 503，绝不编造） |
| 一键跑剧本的门禁演示页（红绿灯 + 逐字段比对并排展示） | `/guardrail` → `app/guardrail/page.tsx`、`app/components/IntentDiff.tsx`、`app/components/api.ts`；POST `app/api/agent/run/route.ts` |
| 本金保护页：顶部「累计避免损失」，每条写明若放行将损失多少 | `/intercepts` → `app/intercepts/page.tsx` |
| 机会与决策页：候选 / 选中 / 放弃理由 / 预算占用，止损触发时提示条接管 | `/opportunities` → `app/opportunities/page.tsx`；`lib/agent/select.ts` `rejectionReasons()` |
| 悬赏市场页：内置买方标 `DEMO BUYER`，第三方发布标「第三方悬赏」 | `/bounties` → `app/bounties/page.tsx`；`lib/market/bounties.ts` `DEMO_BUYERS` |
| 任务账本 / 彩排报告 / 经营设置 / 开发者接入页 | `app/transactions/`、`app/rehearsal/`、`app/wallet/`、`app/developer/`（`/developer` 含 curl 样例与响应信封，便于 3 分钟验证 API） |

复现路径：`pnpm dev` → 打开 `/guardrail` → 依次点三个剧本 → 在 `/intercepts` 与 `/` 看到留痕与账本变化。

### 4. Impact & Usability（真跑通交易、拒绝纯 PPT、Startup 潜力）

| 产出 | 可核实锚点 |
|---|---|
| 端到端闭环有自动化证明：合法任务产出可驱动 `PaymentVault.release` 的凭据，被拦截任务产出的报告 `allowed` 恒为 false，合约层拒绝 | `lib/e2e.test.ts` 两条全周期用例（`pnpm vitest run` 内） |
| 链上合约真实承载"放行"这一步：测试中完成 deposit → promote → release → 余额与周期限额断言 | `contracts/test/StandInSecure.t.sol` `test_Vault_Release_Success` |
| 交易执行路径有开发接口与文档：策略创建 / 撤销 / 流水 / 拦截 / 彩排共 11 个 API 路由 | `app/api/**/route.ts`；`app/developer/page.tsx` 接口表 |
| 亏损真实存在于账本：`.data/ledger.json` 含净利为负的记录（如 `led-seed-1` net -0.50、`led-seed-2` net -1.25） | `node -e "const l=require('./.data/ledger.json');console.log(l.entries.filter(e=>e.netUsdc<0))"` |
| Startup 方向（如实陈述，不夸大）：把"Agent 花钱"变成"有门禁、有留痕、可核验"的基础设施；开发者接入面已成型（API + curl 样例 + SDK 片段） | `app/developer/page.tsx` `SDK_SNIPPET` |

---

## 二、提交清单（Submission Checklist）

| 官方要求项 | 状态 | 证据 / 待办 |
|---|---|---|
| 项目名与 Tagline | 已完成 | 本文档顶部 |
| 方案介绍与 Why Monad | 已完成（见本文档 §三） | 高吞吐低成本的 EVM 测试网让「每笔彩排报告都先比对意图再放款」在演示规模下可行。**注意：合约尚未部署，不要引用 `contracts/broadcast/` 作为已部署地址来源** |
| Demo 视频（2-3 分钟） | **待完成** | 按 §一.3 的复现路径录制：首页 → 三个剧本 → 拦截留痕 → 验收与亏损单 |
| Live Demo URL | **待完成** | 当前仅本地 `pnpm dev`；需部署（仓库内尚无部署配置产出物） |
| 代码仓库（公开） | **待完成** | 本地 git 完整（HEAD `143f0cd`，`git log` 可查）；`git remote -v` 为空，尚未推送 |
| 部署证明与交易哈希 | **未完成** | 无链上证明。`contracts/broadcast/...run-latest.json` 内 `hash: null`、`receipts: []`（从未广播）；2026-10-01 `eth_getCode` 查官方 RPC，两个计划地址均返回 `0x`。可主张的是合约源码 + `forge test` 4 passed |
| 测试与构建快照 | 已完成 | `pnpm vitest run` 153 passed / 16 files；`cd contracts && forge test` 4 passed；`pnpm build` exit 0 |

**立即待办（按优先级）**：① 重新部署两合约并回填真实 tx 哈希；② 推送公开仓库；③ 部署 Live Demo；④ 录制 2-3 分钟视频。

---

## 三、Why Monad（方案介绍补充，全部可核实）

StandIn 把 AI Agent 的花钱链路拆成三段：链下彩排（`lib/rehearse.ts`）→ 链上锚定与金库（`contracts/src/StandInAnchor.sol`、`PaymentVault.sol`）→ 持久账本（`lib/ledger.ts`）。选择 Monad：EVM 兼容（合约 pragma `^0.8.24` + OpenZeppelin，`contracts/src/PaymentVault.sol:2`；CI 用 Foundry），链 ID 10143 与 RPC / 浏览器参数固化在 `lib/chain.ts`；`PaymentVault.release` 每笔放行都要读 Anchor 报告并做四道校验，这类"高频小状态变更"依赖低费用高吞吐执行环境。所有链上主张仅限定在测试网演示规模。

---

## 四、诚实边界（一页）

1. **测试币没有价值。** 全部资金动作使用测试网 USDC（`0x534b2f3A21130d7a60830c2Df862319e593943A3`，见 `lib/chain.ts` / `lib/scenarios.ts`），只证明机制，不构成任何收益承诺。
2. **账本如实含亏损单。** 收入由 `lib/agent/verify.ts` 的确定性规则裁决，不过就记亏；`.data/ledger.json` 中净利为负的记录可直接 `node` 命令读出。PRD 的二次实测（2026-09-30，`docs/MONEY_AGENT_PRD.md` §八）显示真实价差偶尔越 50bps 容忍带，亏损是机制的一部分。
3. **链上记录只证明"记录存在"。** Anchor 锚定的是报告哈希；它不证明收入真实，也不证明不存在绕过演示流程的线下行为。
4. **不做真实资金交易、不构成投资建议。** 界面同款文案见 `app/page.tsx:303`、`app/intercepts/page.tsx:129`、`app/bounties/page.tsx:136`。
5. **演示市场的买方多为内置。** `DEMO BUYERS` 在 `lib/market/bounties.ts` 标注；第三方发布通道存在，真人发布量未达成。
6. **应用层交易哈希是本地生成的伪哈希。** `lib/ledger.ts` `txHash()` 为随机 hex，仅表示"流程走到结算"；`/guardrail` 页面已如实标注「本地彩排账本记录（非链上交易哈希）」（`app/guardrail/page.tsx:241`），链上锚定状态以提交清单第 6 项为准。
7. **不使用夸大词。** 本文档不出现收益承诺类表述；任何性能主张均为测试网 / 演示规模。

---

## 五、反质疑 FAQ

**Q1：这些钱从哪来？**
演示市场的悬赏报酬，以测试网 USDC 计价。买方两类：内置演示买方（`lib/market/bounties.ts` `DEMO_BUYERS`，界面标 `DEMO BUYER`）与第三方发布入口（`/bounties` 页面 + `POST /api/bounties`）。测试币无价值——这里证明的是"报酬-验收-记账"机制可运转，不是真实营收。

**Q2：凭什么信 Agent 真会赚钱？**
我们不承诺赚钱，也不拿收益当证据。证据结构是：收入由确定性验收裁决（新鲜度 ≤60s、双源价差 ≤50bps、热点可回查，`lib/agent/verify.ts`），**不通过就记亏**，`.data/ledger.json` 里有净利 -0.50 / -1.25 的亏损单（node 命令可复现）；亏损由 Agent 之外的止损线强制封顶（`lib/agent/guard.ts`：日亏 30% 停手）。可信的对象是"机制"，不是"收益"。

**Q3：和普通限额白名单有何不同？**
限额与白名单我们**复用**而非重造（`PaymentVault.sol` 的 `promote`/`revoke` + 单笔/周期限额）。差异在判定依据：白名单问的是"收款方可不可信"，门禁问的是"**这一次实际要执行的调用，和当初声明的是不是同一件事**"。两个剧本证明白名单的盲区：phishing 收款方被换掉（金额不变），infinite 收款方**合法**但金额是 2^256-1——白名单方案下后者可畅通无阻，StandIn 在比对层就拦下（`lib/scenarios.ts` + `lib/rehearse.ts`，断言在 `lib/runner.test.ts`）。拦截之后还有两份留痕：可量化避免损失（`lib/agent/avoidedLoss.ts`）与可锚定哈希（`generateReportHash` → `StandInAnchor.anchor`）。

**Q4：为什么必须上链？链下审计日志不行吗？**
链下日志能拦截，但拦不住"事后改口"——文件可以重写（我们的落盘虽有原子写与回滚，管理员仍可删）。上链改变两点：① 彩排报告哈希锚定在 `StandInAnchor`，`require(reports[reportHash].anchoredAt == 0)` 保证同一裁决不可覆盖，裁决内容与时间戳由链共识留存；② 付款不是"承诺会校验"，而是**合约代码只放行有通过记录的钱**：`PaymentVault.release` 先读 Anchor，`require(rAllowed, "report not allowed")`，再校验报告字段与实际请求一致、调用 Agent 与报告归属一致、策略与周期限额存在。链下拦截是"行为"，链上锚定把行为变成"不可篡改的履历"，配合 ERC-8004 身份绑定（兼容项），构成 Track 04 要的可验证信任记录。诚实边界：该闭环依赖上述合约的真实部署（当前状态见提交清单第 6 项）。

**Q5：报告哈希会不会是 32 位近似、可碰撞？**
不会，也不是字符串拼接。`lib/runner.ts` `generateReportHash()` 对（任务 id + 声明意图 + 实际 calldata）做真实 `keccak256`（viem），commit `571ef78` 专门修复过此问题；`grep -n "keccak256" lib/runner.ts` 可核实。

**Q6：ERC-8004 是不是核心卖点？**
不是。ERC-8004 仅作兼容项：`lib/erc8004.ts` 读取 Monad 测试网官方 IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e`（`lib/erc8004.test.ts` 实读 name/symbol/version）。核心卖点是 §二 的意图比对与可核验记录；单纯注册表集成不构成本项目的差异化。
