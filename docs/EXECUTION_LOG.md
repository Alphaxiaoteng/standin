# StandIn 执行记录（对照《下一阶段执行方案》交付物清单）

> 执行日期：2026-10-01。方案目标：把 StandIn 从"自己验证自己的闭环"改成"有独立外部证据的闭环"。
> 每项含：做了什么、验证命令与真实结果。

## 交付物清单

- [x] **T0：隔离的测试与 test、test:core 脚本**
  - `STANDIN_LEDGER_PATH` 注入（lib/ledger.ts）+ `vitest.setup.ts`（ledger/bounties/notices 指向 tmpdir 唯一目录）+ package.json `test`/`test:core`。
  - 验证：`pnpm test:core` 111 passed；`shasum .data/*.json | diff` 前后一致 → `DATA UNTOUCHED`。commit cb269e3。

- [x] **T1：热点独立回查与新增单测**
  - `fetchHnTop(boardSize, deps)` 返回独立 board；sop.ts 增 BoardRecheckPort，验收阶段真二次抓取（30 条榜单）；verifyBrief 拒绝空榜单与 `Object.is(headlines, hnBoard)` 自证；回查失败记亏。
  - 验证：`pnpm test:core` 118 passed；`grep -rn "hnBoard: hn.titles" lib` 无结果；tsc 干净。commit 5e6d5e6。

- [x] **T2：第三方价格交叉校验**
  - Kraken 适配器（2026-10-01 实测 XBTUSD→XXBTZUSD / ETHUSD→XETHZUSD，取 `c[0]`，业务错误即使 HTTP 200 也判失败）；DATA_SOURCES +kraken；三源中位数规则（偏离 >50bps 点名源失败），kraken 缺失降级两源并在 `degraded` 标注。
  - 验证：`pnpm test:core` 126 passed；live `/api/opportunities` health.sources 含 kraken；tsc 干净。commit 90072e8。

- [x] **T3：独立通知通道与回放验收**
  - lib/agent/notify.ts：`emitNotice` 原子追加 .data/notices.json（STANDIN_NOTICES_PATH 注入），写失败抛错绝不报成功；spread_watch 不再自赋 notifiedAt；验收经 NoticeReplayPort 从存储回放，读不到即"未按时通知"。
  - 验证：`pnpm test:core` 134 passed、`pnpm test` 176 passed；live spread_watch 一单（价差未越线 → 无通知文件，符合预期）。commit a8de6d9。
  - 注：首次实现曾被并发进程回滚，已重建并提交（工作区存在另一 Orca 会话并发写 docs/runner/runtime，与本任务文件无交集）。

- [x] **T4：止损与后验持久化**
  - 账本 KV 为事实源：restoreGuardFromKv（跨天自动 resetDaily）/ restorePosteriorFromKv / persistAfterTick（写失败 → setHalted 停机 + 步骤标红）；/api/opportunities 改读 sopRuntime.guardRef()，删除第二个 globalThis guard。
  - 验证：`pnpm test:core` 138 passed；live 实测 tick 后 `spentToday 0.4 / net 0.8`，重启 pnpm dev 后同值恢复。commit cc90732 + 6cca7c1。

- [x] **T5：链上收入确认（设计先行：docs/T5_SETTLEMENT_DESIGN.md）**
  - Bounty +buyerAddress/payoutTxHash/payoutBlockNumber/settlement（pending/confirmed/unpaid）；第三方发布必填合法 buyerAddress；验收通过 ⇒ PENDING（收入 0，成本入账），watcher 匹配 USDC Transfer（from=buyer、to=agent、value≥reward、区块时间>验收）才 confirmed 入账并带交易哈希；过期且链上确无 → unpaid；RPC 异常 → unknown 保持 pending。
  - `ledger.creditBalance` 取代负支出写法；收入分账 demo/onchain 永不相加（/api/earnings/report 的 revenue 字段）。
  - 验证：`pnpm test` 195 passed；`grep -rn "recordSpend(-" lib` 无结果；live：第三方单通过 → revenue 0 + PENDING + 报告 pendingBounties 列出、无转账时 onchainUsdcTotal=0；真实链验证二分定位 + 真实 Transfer 解码（块 66731822，1.062683 USDC，交易哈希精确匹配）；修复 `BigInt(非整秒)` 崩溃与 eth_getLogs 100 块窗口限制（SCAN_STEP 90）。commits 见 git log。
  - 真实转账 30 秒内入账的最终确认 = 手工验收清单第 1 条（需真人钱包付款）。

- [x] **T6：ERC-8004 接入（可选任务）**
  - 地址经官方仓库 erc-8004/erc-8004-contracts README Monad Testnet 清单核实（与既有常量一致，live probe name=AgentIdentity/symbol=AGENT）；registerAgent 幂等（tokenId 取自 mint log，KV 持久化）；giveFeedbackFromBuyer 按官方 ABI；confirmBounty 结算确认后自动注册一次 + 买方侧提交 score=100 反馈（密钥未配置则诚实跳过）；GET/POST /api/identity；.env.example。
  - 验证：`pnpm test` 203 passed；tsc 干净。链上注册/反馈交易本体 = 手工验收（需配置私钥）。

- [x] **T7：门禁对接真实 x402 响应**
  - `fromX402Response`（官方 types：v2 `amount`，v1 `maxAmountRequired` 兼容；payTo/amount/asset/accepts 缺一即拒）；/rehearsal 增"粘贴 402 响应 JSON"入口，输出派生意图 + 可编辑实际付款 + compareIntent 裁决；测试文件改用真实 compareIntent（删除内联副本）。
  - 验证：rehearse 11 cases passed；`pnpm build` 通过；页面 SSR 含新卡片。commit 2f36f34。

- [x] **T8：界面收口与来源可点开**
  - 首页第一屏三个数：今日净利（仅链上确认）/ 可动用本金 / 已避免损失；演示收入单独小字行；每个数字点开显示来源（链上回执+浏览器链接 / 账本统计 / 拦截记录）；首页剧本按钮移除（/guardrail 承接）；时间轴隐藏哈希与 calldata（首页 SSR 无 0x）。
  - 机会卡固定四行（预计净利 / 成功把握及样本数 / 数据源健康 N/M / Agent 决定），放弃卡片置灰无按钮显示规则理由；账本页改任务粒度 + 可展开（验收命中、数据源抓取时刻、交易哈希+浏览器链接）；买方标签 DEMO BUYER / COMMUNITY BUYER；全站页脚固定。
  - 验证：`pnpm build` 通过、tsc 干净、SSR 断言 + 视觉门禁（见下）。commit 见 git log。

- [x] **T9：验证与交付**
  - 数据源复测（2026-10-01，curl -m 8）：Coinbase 200/1.23s、CoinGecko 200/0.45s、HN 200/1.10s、Kraken 200/0.77s（已写入 docs/MONEY_AGENT_PRD.md 第八节）。
  - `rm -rf .next && pnpm install && pnpm test:core（146 passed）&& pnpm build（通过）`；`pnpm test` 203 passed；`.data` 哈希 diff 一致。
  - 合约核对（cast 未安装，改用 JSON-RPC）：StandInAnchor 0x5140…930 eth_getCode 4466 字节；PaymentVault 0x4997…929 `anchor()` 返回 0x000000000000000000000000514047b2a6a06ed8c324b919774b4f751b61c930，与方案预期一致；两笔部署回执 status 0x1。
  - 文档收口：SUBMISSION.md 测试/构建数字替换为 2026-10-01 实测；DEMO_SCRIPT.md 重写为四场景（赢/亏/跳过/拦截，旧视频分镜移至 DEMO_VIDEO_SHOTS.md）；bounties 种子与页面数据去除"套利"措辞（"高频快报 · 价差研判"）。

## 手工验收清单（AI 不能代替，待真人执行）

1. 真人用自己的钱包发布悬赏并转一笔测试 USDC → 30 秒内 /api/earnings/report 出现该笔并带交易哈希（需先配置 STANDIN_AGENT_ADDRESS）。
2. 录屏同框：买方交易哈希、账本记录、页面"链上确认收入"。
3. 制造一次失败（不可能达到的新鲜度窗口）→ 账本记亏、止损更新（T5/DEMO_SCRIPT 场景二给出命令）。
4. 重启服务确认账本、悬赏、止损状态保留（T4 已由 AI 实测通过，可复核）。

## 并发写入备注

执行期间检测到另一会话（Orca 多代理）在同一工作区并发修改 README/docs/runner/runtime 并曾回滚 lib/agent 工作区（T3 首版丢失）。已按"每任务即改即提交"策略重建并提交；两边的文件集无交集。
