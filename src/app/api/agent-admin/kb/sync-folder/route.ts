import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { audit, auditActor } from "@/lib/audit";
import { getAuthContext } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import {
  buildAgentUrl,
  getAgentConnectionWithSecrets,
  getDefaultAgentConnectionWithSecrets,
} from "@/lib/agent-connections";
import { hasRole } from "@/lib/rbac/roles";

export const runtime = "nodejs";

// Browser upload folder: trình duyệt đọc file trên máy user rồi upload (multipart) lên đây.
// Hoạt động dù Didi chạy local HAY trên cloud (GreenNode) vì file đi từ browser, không đọc ổ đĩa server.
const MAX_FILES = 5000;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Làm sạch path: bỏ segment rỗng/./.. (chống zip-path traversal), chuẩn hoá về dấu "/".
function sanitizePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

// CRC-32 (ZIP) — bảng tính sẵn, thuần JS.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Dựng ZIP "STORED" (không nén) thuần JS — không cần binary `zip` hay dependency, chạy được trên
// container cloud slim. Python zipfile của agent đọc STORED bình thường.
function buildStoredZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 filename
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (minimal valid)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0x21, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + entry.data.length;
  }

  const centralDir = Buffer.concat(centrals);
  const localPart = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDir.length, 12); // central dir size
  eocd.writeUInt32LE(localPart.length, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([localPart, centralDir, eocd]);
}

export async function POST(request: NextRequest) {
  // Auth + RBAC (operator) + CSRF — đồng bộ với proxy agent-admin.
  const auth = getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasRole(auth.role, "operator")) {
    audit(auditActor(auth.username), "kb_sync_folder_denied", request.nextUrl.pathname, { role: auth.role });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (auth.csrfRequired && !verifyCsrf(request.headers.get("x-csrf-token"), auth.tokenHash)) {
    return NextResponse.json({ error: "csrf" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_multipart_body" }, { status: 400 });
  }
  const apply = String(form.get("apply") || "") === "true";
  const remotePrefix = sanitizePath(String(form.get("remotePrefix") || "").trim());
  let relPaths: string[];
  try {
    relPaths = JSON.parse(String(form.get("paths") || "[]"));
    if (!Array.isArray(relPaths)) throw new Error("paths must be an array");
  } catch {
    return NextResponse.json({ error: "invalid_paths" }, { status: 400 });
  }
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "no_files" }, { status: 400 });
  if (files.length !== relPaths.length) {
    return NextResponse.json({ error: "files_paths_length_mismatch" }, { status: 400 });
  }
  if (files.length > MAX_FILES) return NextResponse.json({ error: "too_many_files", count: files.length }, { status: 413 });

  // Connection đang chọn (header x-agent-connection-id) hoặc default — giống proxy.
  const requestedConnectionId = request.headers.get("x-agent-connection-id")?.trim();
  const filterUserId = auth.role === "superadmin" ? null : auth.userId;
  const connection = requestedConnectionId
    ? getAgentConnectionWithSecrets(requestedConnectionId, filterUserId)
    : getDefaultAgentConnectionWithSecrets(filterUserId);
  if (!connection || !connection.enabled) {
    return NextResponse.json(
      { error: requestedConnectionId ? "agent_connection_not_found" : "agent_connection_not_configured" },
      { status: requestedConnectionId ? 404 : 503 },
    );
  }
  if (!connection.adminToken) {
    return NextResponse.json({ error: "agent_admin_token_not_configured" }, { status: 503 });
  }
  const agentHeaders = {
    Authorization: `Bearer ${connection.adminToken}`,
    "X-Acting-User": auth.username,
    "X-Acting-Role": auth.role,
  };

  // 1) Đọc file đã upload + tính sha256, dựng map theo KB path.
  const local = new Map<string, { buffer: Buffer; sha: string }>();
  let totalBytes = 0;
  for (let i = 0; i < files.length; i++) {
    const rel = sanitizePath(relPaths[i]);
    if (!rel) continue;
    const buffer = Buffer.from(await files[i].arrayBuffer());
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: "folder_too_large", bytes: totalBytes }, { status: 413 });
    }
    const remotePath = remotePrefix ? `${remotePrefix}/${rel}` : rel;
    local.set(remotePath, { buffer, sha: sha256(buffer) });
  }
  if (local.size === 0) return NextResponse.json({ error: "folder_empty" }, { status: 400 });

  // 2) Lấy manifest agent để biết base_version + file nào đã đổi.
  let manifest: { kb_version: number | null; files: Record<string, { sha256: string }> };
  try {
    const response = await fetch(buildAgentUrl(connection.baseUrl, "/admin/api/kb/manifest"), {
      headers: agentHeaders,
      signal: AbortSignal.timeout(Number(process.env.AGENT_PROXY_TIMEOUT_MS || 30_000)),
    });
    if (!response.ok) return NextResponse.json({ error: "manifest_failed", status: response.status }, { status: 502 });
    manifest = await response.json();
  } catch (error) {
    console.error("[kb-sync-folder] manifest fetch failed:", error);
    return NextResponse.json({ error: "agent_unreachable" }, { status: 502 });
  }

  const manifestFiles = manifest.files || {};
  const changed = [...local.entries()]
    .filter(([remotePath, info]) => manifestFiles[remotePath]?.sha256 !== info.sha)
    .map(([remotePath]) => remotePath)
    .sort();

  const summary = {
    baseVersion: manifest.kb_version,
    remotePrefix: remotePrefix || "(gốc)",
    totalLocalFiles: local.size,
    changedCount: changed.length,
    unchangedCount: local.size - changed.length,
    changedPreview: changed.slice(0, 50),
  };

  // Dry-run: chỉ trả về delta để user xem trước, KHÔNG đụng vào agent.
  if (!apply) return NextResponse.json({ status: "preview", ...summary });
  if (manifest.kb_version === null) {
    return NextResponse.json({ error: "no_active_kb_version", hint: "Hãy upload KB đầy đủ (zip) trước khi delta-sync." }, { status: 409 });
  }
  if (changed.length === 0) return NextResponse.json({ status: "no_changes", ...summary });

  // 3) Đóng gói file đã đổi thành ZIP (in-memory, thuần JS) -> POST /admin/api/kb/delta.
  // Delta = base + added_modified (deleted=[] để KHÔNG xoá file ngoài folder => an toàn cho sub-folder).
  try {
    const zipBuffer = buildStoredZip(changed.map((remotePath) => ({ name: remotePath, data: local.get(remotePath)!.buffer })));
    const meta = { base_version: manifest.kb_version, deleted: [] as string[], added_modified: changed };
    const out = new FormData();
    out.append("meta", JSON.stringify(meta));
    out.append("archive", new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" }), "delta.zip");

    const response = await fetch(buildAgentUrl(connection.baseUrl, "/admin/api/kb/delta"), {
      method: "POST",
      headers: agentHeaders, // KHÔNG set Content-Type — để fetch tự đặt multipart boundary.
      body: out,
      signal: AbortSignal.timeout(Number(process.env.AGENT_PROXY_UPLOAD_TIMEOUT_MS || 120_000)),
    });
    const agentResult = await response.json().catch(() => ({}));
    audit(auditActor(auth.username), "kb_sync_folder_applied", connection.id, {
      remotePrefix,
      changedCount: changed.length,
      baseVersion: manifest.kb_version,
      status: response.status,
    });
    if (!response.ok) {
      return NextResponse.json({ error: "delta_rejected", status: response.status, agent: agentResult, ...summary }, { status: 502 });
    }
    return NextResponse.json({ status: "applied", agent: agentResult, ...summary });
  } catch (error) {
    console.error("[kb-sync-folder] apply failed:", error);
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
