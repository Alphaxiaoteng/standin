"use client";

import type { Rehearsal, RehearsalSide } from "./types";
import { ACTION_LABEL, amountLabel, truncateHash } from "./format";
import { Badge, Hash } from "./ui";

interface DiffRow {
  key: string;
  label: string;
  declared: string;
  actual: string;
  risk: boolean;
  /** 右侧附带的醒目提示 */
  flag?: string;
}

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);

function isInfiniteApproval(side: RehearsalSide): boolean {
  if (side.action !== "approve") return false;
  try {
    return BigInt(side.amount) === MAX_UINT256;
  } catch {
    return false;
  }
}

function overDeclared(declared: RehearsalSide, actual: RehearsalSide): boolean {
  try {
    return BigInt(actual.amount) > BigInt(declared.amount);
  } catch {
    return false;
  }
}

export default function IntentDiff({ rehearsal }: { rehearsal: Rehearsal }) {
  const declared = rehearsal.declaredIntent;
  const actual = rehearsal.actualCalldata;

  const recipientRisk = declared.to.toLowerCase() !== actual.to.toLowerCase();
  const tokenRisk = declared.token.toLowerCase() !== actual.token.toLowerCase();
  const actionRisk = declared.action !== actual.action;
  const infinite = isInfiniteApproval(actual);
  const over = overDeclared(declared, actual);
  const amountRisk = infinite || over || declared.amount !== actual.amount;

  const rows: DiffRow[] = [
    {
      key: "action",
      label: "操作类型",
      declared: ACTION_LABEL[declared.action] ?? declared.action,
      actual: ACTION_LABEL[actual.action] ?? actual.action,
      risk: actionRisk,
    },
    {
      key: "token",
      label: "代币合约",
      declared: truncateHash(declared.token, 12, 8),
      actual: truncateHash(actual.token, 12, 8),
      risk: tokenRisk,
    },
    {
      key: "to",
      label: "收款方",
      declared: truncateHash(declared.to, 12, 8),
      actual: truncateHash(actual.to, 12, 8),
      risk: recipientRisk,
      flag: recipientRisk ? "收款方被篡改" : undefined,
    },
    {
      key: "amount",
      label: "金额",
      declared: amountLabel(declared.amount, declared.amountUsdc),
      actual: amountLabel(actual.amount, actual.amountUsdc),
      risk: amountRisk,
      flag: infinite ? "无限授权" : over ? "超出声明" : undefined,
    },
  ];

  const riskCount = rows.filter((r) => r.risk).length;

  return (
    <div>
      <div className="diff-row" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="diff-key">字段</div>
        <div className="diff-key">声明意图</div>
        <div className="diff-arrow" />
        <div className="diff-key">实际 calldata</div>
      </div>

      {rows.map((row) => (
        <div key={row.key} className={`diff-row${row.risk ? " is-risk" : ""}`}>
          <div className="diff-key">{row.label}</div>
          <div className="diff-val">{row.declared}</div>
          <div className="diff-arrow">{row.risk ? "≠" : "="}</div>
          <div className={`diff-val${row.risk ? " is-risk" : ""}`}>
            {row.actual}
            {row.flag && (
              <>
                {" "}
                <Badge tone="danger">{row.flag}</Badge>
              </>
            )}
          </div>
        </div>
      ))}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 18px",
          borderTop: "1px solid var(--border-soft)",
          flexWrap: "wrap",
        }}
      >
        <span className="muted">命中风险项</span>
        <Badge tone={riskCount > 0 ? "danger" : "success"}>
          {riskCount > 0 ? `${riskCount} 项不一致` : "全部一致"}
        </Badge>
        <span className="spacer" />
        <span className="row" style={{ gap: 8 }}>
          <span className="muted">报告哈希</span>
          <Hash value={rehearsal.reportHash} head={12} tail={10} />
        </span>
      </div>

      {declared.memo && (
        <div
          style={{
            padding: "0 18px 14px",
            borderTop: "1px solid var(--border-soft)",
          }}
        >
          <div className="muted" style={{ paddingTop: 12 }}>
            意图备注
          </div>
          <div className="mono">{declared.memo}</div>
        </div>
      )}
    </div>
  );
}
