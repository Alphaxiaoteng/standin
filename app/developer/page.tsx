"use client";

import PageHead from "../components/PageHead";
import { Card, CopyBlock } from "../components/ui";
import { CANONICAL, EXPLORER } from "../../lib/chain";

const API_ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: "GET", path: "/api/stats", desc: "返回今日支出、拦截数、本地账本余额" },
  { method: "GET", path: "/api/policies", desc: "返回全部支出策略" },
  {
    method: "POST",
    path: "/api/policies",
    desc: "创建策略（agent / merchantHash / maxPerTx / maxPerWeek / expires）",
  },
  { method: "POST", path: "/api/policies/revoke", desc: "撤销指定策略（body: { id }）" },
  { method: "GET", path: "/api/transactions", desc: "返回已放行交易的流水" },
  { method: "GET", path: "/api/intercepts", desc: "返回被门禁拦截的记录" },
  { method: "GET", path: "/api/rehearsal", desc: "返回最近一次彩排的比对详情与报告哈希" },
  { method: "POST", path: "/api/agent/run", desc: "运行剧本：allowed / phishing / infinite" },
];

const CURL_STATS = `curl -s http://localhost:3000/api/stats \\
  -H "Authorization: Bearer $STANDIN_API_KEY"`;

const CURL_CREATE = `curl -s -X POST http://localhost:3000/api/policies \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $STANDIN_API_KEY" \\
  -d '{
    "agent": "0x1111111111111111111111111111111111111111",
    "merchantHash": "0x2222222222222222222222222222222222222222",
    "maxPerTx": 10,
    "maxPerWeek": 200,
    "expires": 1798761600000
  }'`;

const CURL_RUN = `curl -s -X POST http://localhost:3000/api/agent/run \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $STANDIN_API_KEY" \\
  -d '{ "scenario": "phishing" }'`;

const ENVELOPE_NOTE = `// 列表接口统一包一层键名
{ "policies": [...] }       // GET /api/policies
{ "transactions": [...] }   // GET /api/transactions
{ "intercepts": [...] }     // GET /api/intercepts
{ "rehearsal": {...} }      // GET /api/rehearsal（无记录时为 null）

// 写接口统一返回 { ok, ... }
{ "ok": true,  "policy": {...} }   // POST /api/policies（201）
{ "ok": false, "error": "..." }    // 校验失败（HTTP 400/404）`;

const RUN_RESPONSE = `{
  "ok": true,
  "result": {
    "taskId": "task-02-prompt-injection-redirect",
    "status": "INTERCEPTED",
    "reason": "Recipient mismatch: declared 0x2222…2222, actual 0x9999…9999",
    "reportHash": "0x8f3c1a…d41e"
  },
  "rehearsalId": "rh-2b8e05",
  "transactionId": null,
  "interceptId": "it-6ad3f1"
}`;

const REHEARSAL_SHAPE = `{
  "rehearsal": {
    "id": "rh-2b8e05",
    "ts": 1790697131712,
    "taskId": "task-02-prompt-injection-redirect",
    "description": "被恶意提示词注入诱导将转账地址重定向到攻击者钱包",
    "declaredIntent": {
      "action": "transfer",
      "token": "0x534b2f…943A3",
      "to": "0x2222…2222",
      "amount": "500000",     // 最小单位原始值（字符串）
      "amountUsdc": 0.5,      // 人类可读；无限授权等超范围为 null
      "memo": "Purchase API credits"
    },
    "actualCalldata": { "to": "0x9999…9999", "amount": "500000" },
    "allowed": false,
    "reasons": ["Recipient mismatch: …"],
    "reportHash": "0x1e5c90…d5f28b"
  }
}`;

const SDK_SNIPPET = `import { compareIntent } from "@/lib/rehearse";

// 在任何放款动作之前调用：一致才继续
const verdict = compareIntent(declaredIntent, proposedCalldata);
if (!verdict.allowed) {
  throw new Error(\`StandIn 拦截: \${verdict.reasons.join("; ")}\`);
}
await vault.release(declaredIntent);`;

export default function DeveloperPage() {
  return (
    <div className="stack">
      <PageHead
        title="开发者接入"
        desc="把 StandIn 的彩排门禁接进你自己的 Agent：放款前先比对，一致再放行，不一致留痕。"
      />

      <div className="grid grid-2">
        <Card title="API Key" desc="占位值，正式环境请在服务端注入，不要写入前端代码">
          <div className="stack" style={{ gap: 12 }}>
            <dl className="kv">
              <dt>Key</dt>
              <dd>
                <span className="mono">sk_live_standin_xxxxxxxxxxxxxxxxxxxxxx</span>
              </dd>
              <dt>权限</dt>
              <dd>只读指标 · 策略读写 · 触发剧本</dd>
              <dt>Base URL</dt>
              <dd>
                <span className="mono">http://localhost:3000</span>
              </dd>
            </dl>
            <div className="notice">
              <span>所有写操作都应在服务端发起；前端控制台仅用于观测与调试。</span>
            </div>
          </div>
        </Card>

        <Card title="链上地址" desc="Monad Testnet · chainId 10143">
          <dl className="kv">
            <dt>Test USDC</dt>
            <dd>
              <span className="mono">{CANONICAL.testUsdc}</span>
            </dd>
            <dt>Permit2</dt>
            <dd>
              <span className="mono">{CANONICAL.permit2}</span>
            </dd>
            <dt>浏览器</dt>
            <dd>
              <a href={EXPLORER} target="_blank" rel="noreferrer" className="mono">
                {EXPLORER}
              </a>
            </dd>
          </dl>
        </Card>
      </div>

      <Card title="接口列表" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 72 }}>方法</th>
                <th style={{ width: 260 }}>路径</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {API_ENDPOINTS.map((ep) => (
                <tr key={`${ep.method}-${ep.path}`}>
                  <td>
                    <span className="mono">{ep.method}</span>
                  </td>
                  <td>
                    <span className="mono">{ep.path}</span>
                  </td>
                  <td>{ep.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="读取指标">
          <CopyBlock text={CURL_STATS} />
        </Card>
        <Card title="创建策略" desc="expires 为未来的 Unix 毫秒时间戳">
          <CopyBlock text={CURL_CREATE} />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="运行剧本">
          <CopyBlock text={CURL_RUN} />
        </Card>
        <Card title="响应示例" desc="被拦截时的返回结构">
          <CopyBlock text={RUN_RESPONSE} />
        </Card>
      </div>

      <Card title="响应信封" desc="解析时请按下列键名取值">
        <CopyBlock text={ENVELOPE_NOTE} />
      </Card>

      <Card title="彩排报告结构" desc="GET /api/rehearsal 的完整返回">
        <CopyBlock text={REHEARSAL_SHAPE} />
      </Card>

      <Card
        title="在 Agent 中接入彩排"
        desc="比较逻辑来自 lib/rehearse.ts，可在任意运行时复用"
      >
        <CopyBlock text={SDK_SNIPPET} />
      </Card>
    </div>
  );
}
