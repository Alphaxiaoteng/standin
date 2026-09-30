# 赚钱 Agent 方案

## 一、先自我对抗:上一版的 8 个漏洞

| # | 漏洞 | 代码里的证据 | 修正 |
|---|---|---|---|
| 1 | 收入是写死的数字,永远赚 | `earnings/run` 里成本和收入是固定值 | 收入由真实数据的验收结果决定,会亏 |
| 2 | 机会池是静态 3 条 | `opportunities` 注释写明是静态演示数据 | 机会来自真实数据源和悬赏 |
| 3 | 账本在内存,重启就清零 | `store.ts` 开头注释写"不做持久化" | 账本存盘 |
| 4 | 买卖双方都是自己,左手倒右手 | 卖家、买家均自建 | 允许第三方发悬赏,界面标"演示市场" |
| 5 | AI 的选择理由如果是事后编的,会被追问露馅 | 无 | 理由由算法字段生成,LLM 只润色 |
| 6 | 拦截页讲的是"被阻断的意图",用户不关心 | `nav.ts` | 改成"帮你避免的损失" |
| 7 | 全自动赚钱 Agent 常见死法是亏光本金 | 无止损 | 止损在 Agent 之外强制,Demo 里真实触发一次 |
| 8 | 真实价差利润极小,硬叫"套利"是夸大 | 我的判断,未验证 | 不讲套利,改做可验收的数据服务和价差监测悬赏 |

**诚实边界,要写进界面和 README:**

- 测试币没有价值,只证明机制。
- 链上记录只证明"记录存在",不证明收入真实,也不证明没有绕过。
- 不出现"月收益""年化""稳赚"。
- 不构成投资建议,不做真实资金交易。

## 二、真实数据方案

**数据源(我通过搜索核对了限额,没有实测可用性):**

| 源 | 用途 | 限额 |
|---|---|---|
| CoinGecko `/simple/price` | 行情 | 免费 Demo key 每分钟 100 次、每月 1 万次[1];不带 key 的公共接口约每分钟 5 到 15 次[2] |
| Coinbase `GET /v2/prices/BTC-USD/spot` | 第二个价格来源 | 公共端点约每小时 1 万次,来自第三方整理,未核实[3] |
| Hacker News Firebase API | 科技热点 | 无需 key,取前 N 条要发 N+1 次请求[4] |
| Monad Testnet RPC | 付成本、查余额、确认 | 以你实测为准 |

**两类任务,结果由真实数据裁决,不是脚本:**

- **任务 A,数据简报悬赏。**
  - 买方要一份 BTC 和 ETH 双源价格加 5 条热点的简报,数据不得早于 60 秒。
  - 验收用确定性规则:字段齐全;每个价格的时间戳距交付不超过 60 秒;两源价差在容忍带内(比如 50 个基点);热点能在 HN 当前榜单里回查到。
  - 通过则买方付款。不通过则成本已花,记一笔亏损单。
- **任务 B,价差监测悬赏。**
  - 买方悬赏:N 分钟内如果两源 BTC 价差超过 X 个基点就通知我。
  - 窗口结束后用真实数据回放,判定是否触发、是否按时通知。
  - 真实价差多数时候很小,所以经常拿不到奖励。这是特性,不是 bug,它让亏损自然出现。

**买方从哪来:**

1. 系统内置 2 到 3 个买方,界面标 `DEMO BUYER`。
2. 做一个悬赏发布页,任何人填类型、报酬、时限就能发布。
3. 找 3 到 5 个真人发一次。找不到,就只能说"可运行的演示市场"。

## 三、算法

**机会打分(可解释):**

- 成功率 `p`:每种任务加数据源组合,各维护一个 Beta 后验,起始 α=β=1。
- 数据源健康度 `h`:1 减失败率的滑动平均,再乘延迟超标折扣。
- 期望收益 `EV = p × h × 报酬 − 成本 − 风险惩罚`。
- 排序分 `score = EV / 成本`。
- 样本少于 5 次时,`p` 取 0.5,卡片上标"样本不足"。

**选择与仓位:**

1. 剔除 EV 不大于 0、超单笔上限、数据源健康度低于 0.6、余额不足的机会,并记录剔除原因,作为"放弃理由"。
2. 按 score 从高到低,在今日预算内依次选。
3. 单笔仓位不超过单笔上限与今日预算 35% 中较小的一个。同一类型连亏 2 次,仓位减半。

**止损(在 Agent 之外强制):**

| 触发 | 动作 |
|---|---|
| 当日净亏损达到今日预算的 30% | 停手到次日,打断用户 |
| 连亏 3 单 | 暂停该任务类型,进日报 |
| 数据源健康度低于 0.6 | 不接依赖该源的任务 |
| 付款与声明不一致,或新收款方 | 门禁拦截,并排对比,写明避免的损失 |
| 单笔超上限 | 直接拒绝,不打断 |

30%、35%、0.6 这几个数是我设的起点,没有依据,要跑几轮后校准。LLM 只润色说明,不能改预算、止损线和白名单。

## 四、SOP

**每一单的状态流转:**

发现 → 打分 → 选择 → 门禁检查 → 执行 → 验收 → 结算 → 复盘。分支有:跳过、被拦截、失败,全部记账并写明原因。

| 步骤 | 失败怎么办 |
|---|---|
| 发现 | 所有数据源都不健康,今日停机并提示 |
| 打分 | 没有正收益候选,日报写"今天没有值得做的" |
| 选择 | 预算不足则跳过并说明 |
| 门禁 | 拦截,记录避免的损失 |
| 执行 | 数据源超时,标记失败,成本已花,记亏 |
| 验收 | 通过和不通过都产生结果 |
| 结算 | 账本写失败则回滚并停机,禁止继续花钱 |
| 复盘 | 更新后验、健康度和止损计数 |

**每日节奏:** 早上读昨日净利和止损状态,设今日预算;白天循环上面的流程;晚上出日报。

**故障处理:**

- 数据源 429 或连续 3 次超时:标不健康,指数退避,界面显示"源限流"。
- RPC 限流:排队退避重试,超次数标 `RPC_LIMIT`。
- 余额不足:提示去水龙头,不自动补充。
- 现场断网:切到回放模式,界面显示 `REPLAY`,回放的是之前真实跑出的记录。

## 五、交互

| 页面 | 现有文件 | 改动 |
|---|---|---|
| 今日账本(首页) | `app/page.tsx` | 顶部三个数:收入、成本、净利;下方本金曲线和一行"Agent 正在做…" |
| 机会与决策 | 新建 | 决策卡:候选、选中、放弃理由、预算占用;可点"让它做"或"自动,每日最多 X" |
| 账本 | `app/transactions/page.tsx` | 改成任务账本:成本、收入、净利、状态;展开才看哈希和报告 |
| 悬赏市场 | 新建 | 发布和查看悬赏,标明买方来源 |
| 本金保护 | `app/intercepts/page.tsx` | 顶部"累计避免损失",每条写"若放行将损失 X" |
| 审计 | `app/rehearsal/page.tsx` | 保留 |
| 经营设置 | `app/wallet/page.tsx` | 文案改成本金、每日最多亏多少、可做的生意类型 |

**五个关键时刻:**

1. **决策。**候选卡依次出现,选中的高亮,未选的淡出但保留放弃理由。
2. **验收。**规则逐条打勾:字段齐全、新鲜度、价差带、可回查,最后盖"通过"或"未通过"。
3. **结算。**净利数字滚动。亏损用克制的红色并写明原因,例如"价格已过期 83 秒",不做夸张动画。
4. **止损。**整页浅色接管,写"今日已停手,避免继续亏损 X",主按钮"明天再说",次按钮"调整预算"。
5. **拦截。**并排显示"你让它做"和"它要做",默认动作是拒绝。

**打断原则:**

- 正常赚、正常亏、单笔超限被拒,都不打断,只进日报。
- 触发止损、声明不一致、出现新收款方,才打断。这样避免逐笔审批带来的疲劳。

**全局角标:** `测试网 · 演示市场 · 数据实时`;回放时改成 `REPLAY`。

## 六、实现放在哪里

**新增(都在 `standin/` 下):**

| 路径 | 内容 |
|---|---|
| `lib/market/sources.ts` | 三个数据源适配器,统一返回值、抓取时间、延迟,带超时和退避 |
| `lib/market/health.ts` | 数据源健康度 |
| `lib/market/bounties.ts` | 悬赏模型和存储,内置演示买方 |
| `lib/agent/score.ts` | 打分,纯函数 |
| `lib/agent/select.ts` | 选择和仓位,纯函数 |
| `lib/agent/guard.ts` | 止损和降级,纯函数 |
| `lib/agent/verify.ts` | 验收规则,纯函数 |
| `lib/agent/sop.ts` | 状态机,把上面各步和现有 `rehearse.ts`、`runner.ts` 串起来 |
| `lib/ledger.ts` | 账本存盘,带回滚 |
| `lib/replay.ts` | 录制与回放 |
| `app/api/market/refresh`、`app/api/bounties`、`app/api/agent/tick` | 对应接口 |
| `app/opportunities`、`app/bounties` | 新页面 |

**改造:**

- `app/api/earnings/run/route.ts`:去掉固定的 PROFILES,改调 `sop.ts`,收入由 `verify.ts` 决定。
- `app/api/opportunities/route.ts`:去掉静态列表,改读悬赏、数据源健康度和打分结果。
- `lib/store.ts`:状态改从 `ledger.ts` 读写。
- `app/components/types.ts` 和 `nav.ts`:新增类型,页面重排改名。

**测试:**

- 单元测试:打分的冷启动和源不健康;选择的预算边界;止损的 30% 阈值和 3 连亏;验收的新鲜度 59、60、61 秒边界;账本重启后数据仍在。
- 四条端到端脚本:通过、过期导致亏损、触发止损、门禁拦截,各自断言结果。
- 现有的 `rehearse.test.ts` 和 `e2e.test.ts` 接入后要确认仍能通过,这一点我没验证。

## 七、评委追问的答法

- **钱从哪来?**演示市场的悬赏,含第三方发布。测试币无价值,证明的是机制。
- **凭什么信 Agent 会赚钱?**我们不承诺赚钱。账本里有亏损单,靠概率和止损控制亏损,本金有门禁保护。
- **和 Privy、Coinbase 的策略引擎有何不同?**限额和白名单这层是复用的。差异是"声明意图和实际调用的比对"、避免损失的量化,以及可核验的记录。
- **为什么是 Track 04?**账本和拦截记录绑定智能体身份,形成可核验的履历。评委偏密码学,这是短板,评分标准以 Dashboard 为准。

## 八、开工前要做的事(按顺序)

1. 本机 curl 三个数据源,记录状态码和延迟。
2. 选定账本存储:`node:sqlite` 还是 JSON 文件,确认你的 Node 版本支持。
3. 找至少 1 位真人发布一次悬赏。
4. 去 Dashboard 核对 Track 04 评分标准、赞助奖能否叠加、提交字段。
5. 找 3 到 5 人试用,看他们看完首页能否说出"AI 今天做了什么、赚了还是亏了"。

本机探测记录(2026-09-30,Node v24.21.0,`node:sqlite` 可用):

- CoinGecko `GET /api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd`:200,0.54s
- Coinbase `GET /v2/prices/BTC-USD/spot`:200,0.68s
- Hacker News `GET /v0/topstories.json`:200,1.07s;首条 item:200,1.02s
- 二次实测发现：CoinGecko 同一分钟返回 83910 与 83877（21.7bps 漂移到 61.1bps），Coinbase 稳定 83928.255——**真实价差偶尔越 50bps 容忍带，任务 A 会自然失败产生亏损单**。这是特性不是 bug，符合"真实数据裁决，收入不是写死的"。

## 来源

[1] Crypto API Pricing Plans - CoinGecko https://www.coingecko.com/en/api/pricing

[2] What is the rate limit for CoinGecko API (public plan)? https://support.coingecko.com/hc/en-us/articles/4538771776153-What-is-the-rate-limit-for-CoinGecko-API-public-plan

[3] Coinbase API Cheat Sheet for Developers - Vezgo https://vezgo.com/blog/coinbase-api-cheat-sheet-for-developers/

[4] How to Scrape Hacker News in 2026: Stories, Comments, and Trends https://thedatacollector.substack.com/p/how-to-scrape-hacker-news-in-2026

[6] HackerNews/API: Documentation and Samples for the Official HN API https://github.com/hackernews/api

[7] Rate Limits - Coinbase Developer Documentation https://docs.cdp.coinbase.com/api-reference/v2/rate-limits

[8] Crypto Data API: Most Comprehensive & Reliable ... - CoinGecko https://www.coingecko.com/en/api

[9] Best Free Crypto APIs in 2026: Keyless Access & Free API Plans https://www.coingecko.com/learn/best-free-crypto-api

[10] CoinGecko API Rate Limits & Performance — Latency, Throughput ... https://www.codex.io/blog/coingecko-api-performance-pillar-latency-throughput-and-scaling-workarounds-for

[11] The Complete Guide to Algolia Search and Firebase Data - Cotera https://cotera.co/articles/hacker-news-api-guide

[12] Hacker News now has an API. It's Firebase https://firebase.blog/posts/2014/10/hacker-news-now-has-api-its-firebase/

[13] A Practical Guide to the Hacker News API for Developers - Agent 37 https://www.agent37.com/blog/hacker-news-api

[14] The Hacker News | #1 Trusted Source for Cybersecurity News https://thehackernews.com/

[15] REST Rate Limits Overview - Coinbase Developer Documentation https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits

[16] CoinGecko - X https://x.com/coingecko/status/2033785940054061493
