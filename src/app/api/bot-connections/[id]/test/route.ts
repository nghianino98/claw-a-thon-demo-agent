import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { requireDidiAccess } from "@/lib/api/guard";
import { getBotConnectionWithSecret } from "@/lib/bot-connections";
import { getDb } from "@/lib/db";
import { now } from "@/lib/time";

export const runtime = "nodejs";

type TestResult = {
  ok: boolean;
  status: "connected" | "error";
  botUsername?: string;
  error?: string;
};

async function testTelegram(token: string): Promise<TestResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { username?: string };
    };
    if (res.ok && data.ok && data.result) {
      return { ok: true, status: "connected", botUsername: data.result.username || undefined };
    }
    return { ok: false, status: "error", error: data.description || `getMe failed (HTTP ${res.status})` };
  } catch (error) {
    return { ok: false, status: "error", error: (error as Error).message || "request_failed" };
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "operator", { csrf: true, action: "bot_connection_test" });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const bot = getBotConnectionWithSecret(id);
  if (!bot) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!bot.token) return NextResponse.json({ error: "no_token" }, { status: 400 });

  let result: TestResult;
  if (bot.platform === "telegram") {
    result = await testTelegram(bot.token);
  } else {
    // No live verification available for these platforms yet — declaration only.
    return NextResponse.json({ ok: false, skipped: true, platform: bot.platform });
  }

  getDb()
    .prepare(
      `UPDATE bot_connections
       SET status = ?, last_error = ?, last_checked_at = ?,
           bot_username = COALESCE(?, bot_username), updated_at = ?
       WHERE id = ?`,
    )
    .run(result.status, result.error || null, now(), result.botUsername || null, now(), id);

  audit(auditActor(gate.auth.username), "bot_connection_test", id, { status: result.status });
  return NextResponse.json(result);
}
