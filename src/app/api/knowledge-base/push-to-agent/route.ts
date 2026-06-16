import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { requireDidiAccess } from "@/lib/api/guard";

export const runtime = "nodejs";

const ALLOWED_PREFIXES: Record<string, string[]> = {
  confluence: ["02. Context/Confluence", "03. Fact/Confluence"],
  jira: ["02. Context/Jira", "03. Fact/Jira", "03. Fact/CS Ticket"],
  gitlab: ["03. Fact/Source Code", "02. Context/GitLab"],
};

function stateDir() {
  return process.env.STATE_DIR || path.join(process.cwd(), "data");
}

function isAllowedPrefix(source: string, prefix: string) {
  return (ALLOWED_PREFIXES[source] || []).some((allowed) => prefix === allowed || prefix.startsWith(`${allowed}/`));
}

async function collectFiles(root: string) {
  const output: Array<{ absolutePath: string; relativePath: string }> = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        output.push({ absolutePath, relativePath: path.relative(root, absolutePath) });
      }
    }
  }
  await walk(root);
  return output;
}

export async function POST(request: NextRequest) {
  const gate = requireDidiAccess(request, "operator", { csrf: true, action: "kb_push_to_agent" });
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const taskId = String(body.taskId || "").trim();
  const source = String(body.source || "").trim();
  const pathPrefix = String(body.pathPrefix || "").trim().replace(/^\/+|\/+$/g, "");
  if (!taskId || !source || !pathPrefix) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  // taskId becomes a filesystem path segment (data/staging/<taskId>) — reject anything
  // that could escape the staging root.
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) {
    return NextResponse.json({ error: "invalid_task_id" }, { status: 400 });
  }
  if (!isAllowedPrefix(source, pathPrefix)) {
    return NextResponse.json({ error: "invalid_path_prefix" }, { status: 400 });
  }
  if (!process.env.AGENT_BASE_URL || !process.env.AGENT_SYNC_API_KEY) {
    return NextResponse.json({ error: "agent_sync_not_configured" }, { status: 503 });
  }

  if (process.env.AUTH_MODE === "required" && gate.auth.userId && gate.auth.role !== "superadmin") {
    const TASKS_FILE_PATH = path.join(stateDir(), "tasks.json");
    const tasksData = await fs.readFile(TASKS_FILE_PATH, "utf-8").catch(() => "[]");
    const tasks = JSON.parse(tasksData);
    const task = tasks.find((t: any) => t.id === taskId);
    if (task && task.createdByUserId !== gate.auth.userId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const stagingDir = path.join(stateDir(), "staging", taskId);
  try {
    const stat = await fs.stat(stagingDir);
    if (!stat.isDirectory()) return NextResponse.json({ error: "staging_not_found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "staging_not_found" }, { status: 404 });
  }

  const manifestUrl = new URL("/admin/api/kb/manifest", process.env.AGENT_BASE_URL);
  let manifestResponse: Response;
  try {
    manifestResponse = await fetch(manifestUrl, {
      headers: { "X-Sync-Api-Key": process.env.AGENT_SYNC_API_KEY },
      signal: AbortSignal.timeout(Number(process.env.AGENT_PROXY_TIMEOUT_MS || 30_000)),
    });
  } catch (error) {
    console.error("[push-to-agent] manifest fetch failed:", error);
    return NextResponse.json({ error: "agent_unreachable" }, { status: 502 });
  }
  if (!manifestResponse.ok) {
    return NextResponse.json({ error: "manifest_failed", status: manifestResponse.status }, { status: 502 });
  }

  const files = await collectFiles(stagingDir);
  audit(auditActor(gate.auth.username), "kb_push_to_agent_prepare", taskId, {
    source,
    pathPrefix,
    fileCount: files.length,
  });

  // The actual multipart delta packaging belongs to D5 deployment work, because it depends on the
  // agent-side sync contract and max body limits. This endpoint exposes validated discovery now so
  // the frontend can integrate the action and display readiness without touching secrets.
  return NextResponse.json({
    status: "ready_to_package",
    taskId,
    source,
    pathPrefix,
    fileCount: files.length,
    next: "package_delta_zip_and_post_/admin/api/kb/delta",
  });
}
