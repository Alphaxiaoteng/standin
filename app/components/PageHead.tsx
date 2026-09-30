import type { ReactNode } from "react";

export default function PageHead({
  title,
  desc,
  actions,
}: {
  title: string;
  desc?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title">{title}</h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
