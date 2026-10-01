# StandIn · 四场景演示脚本

> 四个场景对应四种真实结果：赢、亏、跳过、拦截。全部由真实数据与规则裁决，无任何写死结果。
> 所有金额为 Monad 测试网演示规模；页面页脚固定声明"Monad 测试网演示，不代表真实投资收益"。

## 场景一 · 赢（数据简报验收通过）

1. `curl -s localhost:3313/api/opportunities | jq '.opportunities[0]'` — 看 Agent 选中哪单。
2. `curl -s -X POST localhost:3313/api/earnings/run -H 'content-type: application/json' -d '{"kind":"data_brief"}' | jq '{status: .task.status, verify: .verify.checks, steps: [.steps[].note]}'`
3. 看点：验收清单逐条打勾（三源中位数偏差 ≤50bps、价格新鲜度 ≤60s、热点 5 条且可独立回查榜单）。
4. DEMO BUYER 单：立即入账，账本条目 `meta.billing=demo`，页面标 **DEMO BUYER**。
   COMMUNITY BUYER 单：状态为 PENDING（待链上付款），不入账收入——`settlement=pending`。

## 场景二 · 亏（验收未通过，成本沉没）

1. 发布一条窗口不可能达到的悬赏：
   `curl -s -X POST localhost:3313/api/bounties -H 'content-type: application/json' -d '{"kind":"data_brief","rewardUsdc":2,"windowSec":1,"buyerType":"third_party","buyerAddress":"0x你的测试钱包","buyerName":"COMMUNITY BUYER"}'`
2. 跑这一单：`curl -s -X POST localhost:3313/api/earnings/run -H 'content-type: application/json' -d '{"bountyId":"<上一步返回的 id>"}' | jq '{status: .task.status, failReason: .task.failReason}'`
3. 看点：新鲜度超窗 → 验收失败 → 成本已花、收入 0 → 账本记 FAILED，止损计数 +1。
4. 连续亏损触达日预算 30% 止损线时，Agent 自动停手（场景四的门禁层也会亮红灯）。

## 场景三 · 跳过（EV ≤ 0，放弃是决定不是失败）

1. `curl -s localhost:3313/api/opportunities | jq '[.skipped[] | {id, reason}]'`
2. 看点：报酬覆盖不了成本或风险惩罚的悬赏被算法剔除，理由由打分/选择规则模板给出
   （如 `EV ≤ 0`、`余额不足`、`该任务类型因连亏暂停`），无 LLM 参与。
3. 页面上放弃卡片置灰、无按钮，理由可读。

## 场景四 · 拦截（门禁在 Agent 之外强制）

1. 打开 `/guardrail`，依次点「正常采购」「收款方篡改」「无限授权」。
2. 看点：声明意图与实际 calldata 逐字段比对；收款方不一致或无限授权直接拦截，
   账本记 INTERCEPTED 并量化"避免损失"金额（首页"已避免损失"数字的来源）。
3. `/rehearsal` 页可粘贴一个真实 x402 402 响应 JSON，门禁按其声明（payTo/amount/asset）
   核对实际付款，字段越线即拦截。

## 结算口径（贯穿四个场景）

- 演示收入（DEMO BUYER 本地结算）与链上确认收入（USDC Transfer 回执，带交易哈希）分开统计，永不相加。
- 链上确认依赖 `STANDIN_AGENT_ADDRESS` 配置；第三方悬赏交付通过后 `settlement=pending`，
  watcher 在链上找到买方→Agent 的转账才置 confirmed 并入账；过期未付记 unpaid（收入 0，成本已花）。
- 每个数字可点开看来源：数据源与抓取时刻、验收规则命中、交易哈希与区块浏览器链接。
