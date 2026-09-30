import { NextResponse } from "next/server";
import { isScenarioKind, runScenario } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const scenario = (body as Record<string, unknown> | null)?.scenario;
  if (!isScenarioKind(scenario)) {
    return NextResponse.json(
      { ok: false, error: "scenario 必须是 allowed | phishing | infinite" },
      { status: 400 },
    );
  }

  const outcome = runScenario(scenario);
  return NextResponse.json({
    ok: true,
    result: outcome.summary,
    rehearsalId: outcome.rehearsalId,
    transactionId: outcome.transactionId ?? null,
    interceptId: outcome.interceptId ?? null,
  });
}
