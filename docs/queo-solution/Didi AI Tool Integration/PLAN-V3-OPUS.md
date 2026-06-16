# Plan V3 — Opus Review: Tích hợp quản trị Agent vào Didi AI Tool

**Trạng thái:** Bản coding-ready chính thức. Hợp nhất Codex V2 + Opus review.
**Supersedes:** `PLAN.md` (V1), `PLAN-V2-CODEX-REVIEW.md` (V2). Giữ V1/V2 làm tham chiếu lịch sử; **V3 là bản code theo**.
**Người duyệt:** Duy (duynq5@vng.com.vn) · **Ngày:** 2026-06-14

V2 (Codex) đã sửa đúng ~10/12 finding của Opus V1 (bootstrap fail-fast, RBAC matcher chính xác, CSRF, security headers, CIDR, vault resolve, wrapper `runpy`, milestone + acceptance, streaming upload). V3 **giữ nguyên toàn bộ phần đúng của V2** và bổ sung các correctness rule mà V2 còn sót — trong đó có **1 bug bảo mật thực sự đã được chứng minh bằng test** (session hết hạn vẫn được chấp nhận). Mọi code skeleton trong V3 đã **chạy thử trong sandbox** (Node 22), đánh dấu ✅ verified.

> Nguồn đối chiếu: `07-DIDI-INTEGRATION.md` (ADR-2 v3), `04-INTERFACES.md` (security spec §4.2), `03-DATA-AND-KB.md`, `05-DEPLOYMENT-AND-PLAN.md`, và `PLAN-V2-CODEX-REVIEW.md`. Source Didi live (`/Users/lap16947/Lab/Didi Ai Tool`) **không mount được trong session này** → mọi mô tả hiện trạng Didi lấy từ khảo sát `07 §1` + V2 §2; **bắt buộc re-verify trên source live ở D0** trước khi sửa (Fact > Doc theo CLAUDE.md).

---

## 1. Delta V3 so với V2 — đóng góp của Opus review

| # | Vấn đề V2 còn sót / chưa quyết | Mức | Quyết định V3 | Bằng chứng |
|---|---|---|---|---|
| O1 | **Format timestamp không thống nhất** → session hết hạn vẫn pass. V2 §7.3 yêu cầu check `expires_at > now` nhưng KHÔNG chốt kiểu dữ liệu/format; nếu ghi `expires_at` bằng JS `toISOString()` (có `T`) rồi so với SQLite `datetime('now')` (có space) thì so chuỗi sai vì `'T'(84) > ' '(32)` | **Blocker (security)** | **Mọi cột thời gian = `INTEGER` epoch milliseconds.** So sánh numeric, bind `Date.now()`. **CẤM** `datetime('now')`/`datetime("now")` trong mọi query | §2.1 + test ✅ |
| O2 | **Next.js 16: `params` của route động là `Promise`** — phải `await`. V2 §11 (BFF `[...path]`) không nhắc → `params.path` = `undefined`, crash runtime | **Blocker** | Mọi route handler động `await params`; `next/headers` `cookies()`/`headers()` async → `await` | §2.2 |
| O3 | `request.ip` đã bị gỡ từ Next 15 (Didi là Next 16) — V2 ngụ ý nhưng không cấm tường minh | Cao | Cấm `request.ip`/`request.geo`; chỉ lấy IP từ header ingress (`x-forwarded-for` hop đầu, xác minh ở D5) | §2.2 |
| O4 | **better-sqlite3 × Next 16 build/runtime** chưa có cấu hình cụ thể (V2 chỉ nêu "build risk") | Cao | `serverExternalPackages:['better-sqlite3']`; route/middleware `runtime='nodejs'`; DB singleton qua `globalThis`; `output:'standalone'` + copy native `.node`; `foreign_keys=ON` mỗi connection | §2.3 |
| O5 | Bất nhất nội bộ V2: file RBAC ghi 2 nơi (`src/lib/rbac/agent-admin-rbac.ts` ở §5 vs `src/lib/agent-admin/rbac.ts` ở §8.1) | Thấp | Chuẩn hoá: `src/lib/rbac/roles.ts`, `src/lib/rbac/agent-admin.ts`, `src/lib/rbac/didi.ts` | §5, §9 |
| O6 | V2 DDL còn để timestamp `TEXT` (hệ quả của O1) | Blocker (kéo theo O1) | DDL V3 đổi hết sang `INTEGER` | §6 |
| O7 | Thiếu test bắt đúng lớp bug O1/O2 | TB | Thêm test bắt buộc: expired-session → 401; route động `await params`; build có `serverExternalPackages` | §16 |

Các finding Opus V1 đã được **V2 xử lý xong** (không cần lặp lại, V3 kế thừa): hardcoded bootstrap password → fail-fast; RBAC `PATCH settings`=superadmin + matcher path động; CSRF; security headers + `DIDI_ENABLED`; CIDR; `import path` → `runpy`; sketch resolve credential + spawn-by-env; milestone + security checklist.

---

## 2. Correctness rules bắt buộc (đọc trước khi code)

### 2.1. Chuẩn thời gian — chống bug session-expiry (O1, O6)

**Luật:** mọi cột thời gian trong `didi.sqlite3` là `INTEGER` = epoch **milliseconds** (`Date.now()`). Mọi so sánh là numeric với tham số bind. **Tuyệt đối không** dùng `datetime('now')`, `CURRENT_TIMESTAMP`, hay trộn chuỗi ISO của JS với hàm ngày của SQLite.

Lý do (đã chứng minh bằng test trong sandbox):

```
expires_at lưu JS toISOString()  = "2026-06-14T00:00:00.000Z"   (đã hết hạn lúc 00:00)
SQLite datetime('now')           = "2026-06-14 14:14:36"
WHERE expires_at > datetime('now')  →  TRUE   ← session hết hạn vẫn được coi là ACTIVE
(vì so chuỗi: ký tự thứ 11 'T'(0x54) > ' '(0x20))
```

Cách đúng (✅ verified):

```ts
// src/lib/time.ts
export const now = () => Date.now();              // epoch ms, nguồn thời gian DUY NHẤT
export const fromNow = (ms: number) => Date.now() + ms;
// So sánh expiry: numeric, không có cạm bẫy chuỗi/timezone
// WHERE expires_at > @now AND (last_seen_at + @idleMs) > @now
```

Hệ quả phụ: bug `datetime("now")` (nháy kép) trong audit INSERT của V1 cũng biến mất vì không còn dùng hàm ngày SQLite. UI Audit/Accounts tự format `INTEGER ms → local time` khi render.

### 2.2. Next.js 16 App Router — API đã đổi (O2, O3)

Didi là **Next.js 16**. Các skeleton V1/V2 viết theo idiom Next 13/14 sẽ lỗi:

- **Route động `params` là `Promise`** (từ Next 15): 
  ```ts
  export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;   // BẮT BUỘC await
  }
  ```
- **`next/headers` `cookies()` / `headers()` / `draftMode()` là async** → `const c = await cookies();`. (Trong **middleware** thì `req.cookies.get()` / `req.headers.get()` vẫn **sync** — không nhầm hai chỗ này.)
- **`request.ip` / `request.geo` đã bị gỡ** (Next 15+). GreenNode không phải Vercel nên kể cả bản cũ cũng `undefined`. Lấy IP qua helper đọc `x-forwarded-for` (hop đầu) — header thực tế của AgentBase ingress **verify ở D5**, ghi `IMPLEMENTATION_NOTES.md`.
- Mọi route đụng DB/`crypto`/`better-sqlite3` phải chạy **Node runtime**: thêm `export const runtime = 'nodejs';` (đừng để Edge).

### 2.3. better-sqlite3 × Next 16 (O4)

- `next.config.ts`: `serverExternalPackages: ['better-sqlite3']` (Next 16 đã đưa lên top-level, không còn `experimental.serverComponentsExternalPackages`). Không bundle native addon.
- **Không** import `better-sqlite3` trong `src/middleware.ts` (middleware = Edge, không chạy native). Validate session bằng helper Node trong route/server action (đúng như V2 §7.2).
- **DB singleton** chống tạo nhiều handle khi Next hot-reload/route tách module:
  ```ts
  // src/lib/db.ts  (rút gọn)
  import Database from 'better-sqlite3';
  const g = globalThis as unknown as { __didiDb?: Database.Database };
  export function getDb() {
    if (!g.__didiDb) {
      const db = new Database(`${process.env.STATE_DIR || 'data'}/didi.sqlite3`);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');   // phải set mỗi connection
      g.__didiDb = db;
      runMigrations(db);
    }
    return g.__didiDb;
  }
  ```
- Docker: `output: 'standalone'`; multi-stage Node 22-slim; đảm bảo `node_modules/better-sqlite3/build/Release/better_sqlite3.node` có mặt ở runner stage (standalone trace đôi khi sót native binary — verify bằng `node -e "require('better-sqlite3')"` trong image ở D5).

---

## 3. Mục tiêu & bất biến (kế thừa V2 §1)

**Mục tiêu:** Didi là admin console duy nhất; Queo Agent headless (`/admin/api/**`); Didi server mode có login/2FA/RBAC/audit/vault + BFF proxy + push KB delta; Didi local mode chạy y nguyên; credential không còn đi từ browser xuống server khi `AUTH_MODE=required`.

**Bất biến zero-regression (vi phạm = fail review):**

1. Không đổi schema bắt buộc của `data/tasks.json`, `workflows.json`, `history.json` — chỉ THÊM field optional.
2. Không đổi route/page/API cũ: `/`, `/knowledge-base`, `/workflows`, `/history`, `/settings`, `/api/knowledge-base/**`, `/api/workflows/**`, `/api/history`.
3. Không sửa crawler gốc `crawl_confluence.py` / `crawl_jira.py` / `crawl_gitlab.py`.
4. Không đổi `Start App.command`, `Stop App.command`, launchd local.
5. `AUTH_MODE` không set = `off` = hành vi local y hệt hôm nay (kể cả localStorage settings).
6. Server mode KHÔNG import `data/tasks.json` local của Duy lên production.
7. Không log/audit secret; không truyền secret qua process args ở server mode.

**Non-goals:** không migrate task local sang vault; không thay workflow editor; không multi-tenant; không vector search / parse PDF-XLSX cho agent; không cho browser gọi thẳng agent admin API.

---

## 4. Ground truth Didi & boundary route (kế thừa V2 §2, §4)

**Stack hiện tại (verify lại ở D0):** Next.js 16 App Router, TS, Tailwind 4, zustand, `@xyflow/react`, `node-cron`, Python crawler trong `.venv`.

**API cũ:** `/api/knowledge-base/{crawl,tasks,test-connection,logs,open-folder,generate-diagram,generate-doc-prompt,generate-image}`, `/api/workflows/{,(root),tasks,execute,email}`, `/api/history`. **State cũ:** `data/{tasks,workflows,history}.json`, `data/{app.pid,app.port,syncDaemon.pid}`. `data/tasks.json` chứa credential plaintext — **không trích, không deploy lên server**.

**Boundary (quan trọng — sửa từ V1):**

- **Platform Didi** (không proxy sang agent): `/login`, `/change-password`, `/setup-2fa`, `/accounts` (superadmin), `/credentials` (hoặc tab trong `/settings`), + các trang collector cũ. APIs: `/api/auth/[...action]`, `/api/me`, `/api/accounts/**`, `/api/sessions/**`, `/api/tokens/**`, `/api/credentials/**`, `/api/security/csrf`, + API cũ (bọc RBAC khi `required`).
- **Agent Admin** (render trong Didi, gọi agent qua BFF): `/agent-admin/{dashboard,instructions,skills,workflows,runs,knowledge,access,audit,settings}`. **Không** có `/agent-admin/accounts` — Accounts thuộc platform.
- **BFF:** browser → `/api/agent-admin/[...path]` → `{AGENT_BASE_URL}/admin/api/[...path]` (+ `Authorization: Bearer ${AGENT_ADMIN_TOKEN}`, `X-Acting-User`, `X-Acting-Role`). Token agent không bao giờ xuống browser.

---

## 5. Cấu trúc file (chuẩn hoá tên — sửa O5)

```text
Didi Ai Tool/
├── Dockerfile                                   # NEW (chỉ server deploy)
├── next.config.ts                               # MODIFY: serverExternalPackages, output:'standalone'
├── package.json                                 # MODIFY
├── data/
│   ├── didi.sqlite3                             # NEW (không commit/deploy local)
│   ├── tasks.json | workflows.json | history.json  # EXISTING — chỉ thêm field optional
├── src/
│   ├── middleware.ts                            # NEW (stateless: headers, DIDI_ENABLED, IP CIDR, gate cookie)
│   ├── app/
│   │   ├── login/ change-password/ setup-2fa/ accounts/ credentials/   # NEW pages (platform)
│   │   ├── agent-admin/{dashboard,instructions,skills,workflows,runs,knowledge,access,audit}/page.tsx  # NEW
│   │   ├── api/auth/[...action]/route.ts        # NEW
│   │   ├── api/me/route.ts | api/accounts/** | api/sessions/** | api/tokens/** | api/credentials/**  # NEW
│   │   ├── api/security/csrf/route.ts           # NEW
│   │   ├── api/agent-admin/[...path]/route.ts   # NEW (BFF)
│   │   ├── api/knowledge-base/push-to-agent/route.ts  # NEW
│   │   ├── api/health/route.ts                  # NEW
│   │   └── api/{knowledge-base,workflows,history}/**   # MODIFY: requireRole + server-mode branch
│   ├── components/{auth,credentials,agent-admin}/   # NEW
│   ├── lib/
│   │   ├── time.ts                              # NEW (now(): epoch ms — nguồn thời gian duy nhất)
│   │   ├── db.ts | migrations.ts                # NEW
│   │   ├── env.ts                               # NEW (fail-fast production)
│   │   ├── crypto.ts                            # NEW (AES-256-GCM + HKDF)
│   │   ├── auth/{password.ts,totp.ts,session.ts,csrf.ts,ip.ts}   # NEW
│   │   ├── rbac/{roles.ts,didi.ts,agent-admin.ts}                 # NEW  ← chuẩn hoá
│   │   ├── credentials/vault.ts                 # NEW
│   │   └── audit.ts                             # NEW
│   └── scripts/
│       ├── worker/syncDaemon.js                 # MODIFY (resolve credentialRef + spawn-env, nhánh cũ giữ nguyên)
│       └── confluence_docs_tools/crawlers_wrapper.py  # NEW
```

**Package thêm:** `better-sqlite3`, `@types/better-sqlite3`, `qrcode` + `@types/qrcode` (render QR TOTP server-side, tránh CDN ngoài để hợp CSP). CIDR: tự viết `src/lib/auth/ip.ts` (đã verify, không cần dep); nếu muốn IPv6 đầy đủ thì `ipaddr.js`.

---

## 6. Data model `data/didi.sqlite3` (DDL V3 — timestamp INTEGER)

Migration runner idempotent, bọc transaction, gọi 1 lần khi `getDb()` khởi tạo:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
```

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Tất cả *_at, *_until là INTEGER epoch milliseconds (xem §2.1)
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,            -- "scrypt$<N>$<r>$<p>$<salt_b64>$<hash_b64>"
  role TEXT NOT NULL CHECK(role IN ('superadmin','operator','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  totp_secret TEXT,                       -- base32 secret, AES-GCM encrypted (info 'totp-secret'); NULL=chưa bật
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,                   -- epoch ms
  last_login_at INTEGER, last_login_ip TEXT,
  created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,            -- sha256(session token)
  user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,            -- created_at + TTL
  last_seen_at INTEGER NOT NULL,          -- idle timeout mốc
  ip TEXT, user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON admin_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS admin_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,            -- ≤ 90 ngày
  last_used_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('confluence','jira','gitlab')),
  label TEXT NOT NULL DEFAULT 'default', username TEXT NOT NULL,
  token_encrypted BLOB NOT NULL,          -- AES-256-GCM, key=HKDF(DIDI_APP_SECRET,'cred-vault')
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_used_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, source, label)
);
CREATE INDEX IF NOT EXISTS idx_cred_owner ON credentials(user_id, source, label);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,                    -- "didi:<username>" hoặc "system"
  action TEXT NOT NULL, target TEXT, detail TEXT,   -- detail = JSON đã sanitize (không secret)
  ip TEXT, user_agent TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time  ON audit_log(actor, created_at);

CREATE TABLE IF NOT EXISTS login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username_hash TEXT, ip TEXT, reason TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_fail_ip ON login_failures(ip, created_at);
```

---

## 7. Crypto & auth skeletons (✅ verified trong sandbox)

### 7.1. `crypto.ts` — AES-256-GCM + HKDF (round-trip ✅)

```ts
import crypto from 'crypto';
const ALGO = 'aes-256-gcm', IV = 12, KEYLEN = 32;

function key(info: string): Buffer {
  const s = process.env.DIDI_APP_SECRET;
  if (!s || s.length < 32) throw new Error('DIDI_APP_SECRET must be >= 32 chars');
  return Buffer.from(crypto.hkdfSync('sha256', s, '', info, KEYLEN)); // hkdfSync trả ArrayBuffer → bọc Buffer
}
export function encrypt(text: string, info = 'cred-vault'): Buffer {
  const iv = crypto.randomBytes(IV);
  const c = crypto.createCipheriv(ALGO, key(info), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);        // [iv 12][tag 16][ciphertext]
}
export function decrypt(buf: Buffer, info = 'cred-vault'): string {
  const iv = buf.subarray(0, IV), tag = buf.subarray(IV, IV + 16), enc = buf.subarray(IV + 16);
  const d = crypto.createDecipheriv(ALGO, key(info), iv); d.setAuthTag(tag);
  return d.update(enc) + d.final('utf8');
}
```
> `totp_secret` dùng `info='totp-secret'`; vault dùng `info='cred-vault'` → tách miền khoá (V2 §6.3). Đã bỏ hằng `SALT_LEN` dead-code của V1.

### 7.2. `password.ts` — scrypt (verify/reject ✅)

```ts
import crypto from 'crypto';
export function hashPassword(pw: string): Promise<string> {
  return new Promise((res, rej) => {
    const salt = crypto.randomBytes(16).toString('base64');
    crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, dk) =>
      e ? rej(e) : res(`scrypt$16384$8$1$${salt}$${dk.toString('base64')}`));
  });
}
export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return new Promise((res, rej) => {
    const [a, N, r, p, salt, k] = hash.split('$'); if (a !== 'scrypt') return res(false);
    const orig = Buffer.from(k, 'base64');
    crypto.scrypt(pw, salt, orig.length, { N: +N, r: +r, p: +p }, (e, dk) =>
      e ? rej(e) : res(crypto.timingSafeEqual(orig, dk)));
  });
}
```

### 7.3. `totp.ts` — RFC 6238 tự implement (khớp test vector ✅: T=59→287082, T=1111111109→081804)

```ts
import crypto from 'crypto';
// secret: base32 PLAINTEXT (caller decrypt totp_secret bằng crypto.decrypt(..,'totp-secret') trước khi gọi)
export function verifyTOTP(secret: string, token: string, atSec = Math.floor(Date.now() / 1000)): boolean {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const ch of secret) { const v = B32.indexOf(ch.toUpperCase()); if (v >= 0) bits += v.toString(2).padStart(5, '0'); }
  const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const k = Buffer.from(bytes), step = Math.floor(atSec / 30);
  for (let off = -1; off <= 1; off++) {                    // chấp nhận lệch ±1 step (30s)
    const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(step + off));
    const h = crypto.createHmac('sha1', k).update(b).digest(); const o = h[h.length - 1] & 0xf;
    const code = ((h[o] & 0x7f) << 24) | ((h[o+1] & 0xff) << 16) | ((h[o+2] & 0xff) << 8) | (h[o+3] & 0xff);
    if ((code % 1_000_000).toString().padStart(6, '0') === token) return true;
  }
  return false;
}
```

### 7.4. `session.ts` — expiry numeric (KHÔNG dùng datetime(); chống O1, ✅ verified)

```ts
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { now } from '@/lib/time';
const TTL = (+(process.env.DIDI_SESSION_TTL_HOURS || 12)) * 3600_000;
const IDLE = (+(process.env.DIDI_SESSION_IDLE_MINUTES || 60)) * 60_000;

export function getSession(rawToken: string) {
  const th = crypto.createHash('sha256').update(rawToken).digest('hex'); const t = now();
  const row = getDb().prepare(`
    SELECT s.token_hash, s.user_id, s.expires_at, s.last_seen_at, u.username, u.role, u.status
    FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND (s.last_seen_at + ?) > ? AND u.status = 'active'
  `).get(th, t, IDLE, t) as any;        // ← so sánh numeric: hết hạn/idle/disabled đều loại đúng
  if (!row) return null;
  if (t - row.last_seen_at > 60_000)    // throttle ghi, tránh write mỗi request
    getDb().prepare('UPDATE admin_sessions SET last_seen_at=? WHERE token_hash=?').run(t, th);
  return row;
}
export function createSession(userId: number, ip?: string, ua?: string) {
  const raw = crypto.randomBytes(32).toString('hex');
  const th = crypto.createHash('sha256').update(raw).digest('hex'); const t = now();
  getDb().prepare(`INSERT INTO admin_sessions(token_hash,user_id,created_at,expires_at,last_seen_at,ip,user_agent)
                   VALUES(?,?,?,?,?,?,?)`).run(th, userId, t, t + TTL, t, ip ?? null, ua ?? null);
  return raw;                            // set cookie qs_session; rotate = destroy cũ + create mới sau login
}
export const destroyAllSessions = (uid: number) =>
  getDb().prepare('DELETE FROM admin_sessions WHERE user_id=?').run(uid);  // disable user → mọi session chết
```

### 7.5. `csrf.ts` — HMAC bind session (V2 §7.7, thêm TTL)

```ts
import crypto from 'crypto'; import { now } from '@/lib/time';
const MAX_AGE = 8 * 3600_000;
export function issueCsrf(sessionTokenHash: string) {
  const ts = now(); const payload = `${sessionTokenHash}.${ts}`;
  const sig = crypto.createHmac('sha256', process.env.DIDI_APP_SECRET!).update(payload).digest('hex');
  return `${ts}.${sig}`;
}
export function verifyCsrf(token: string, sessionTokenHash: string) {
  const [ts, sig] = (token || '').split('.'); if (!ts || !sig) return false;
  if (now() - +ts > MAX_AGE) return false;
  const exp = crypto.createHmac('sha256', process.env.DIDI_APP_SECRET!).update(`${sessionTokenHash}.${ts}`).digest('hex');
  return sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp));
}
```
> Gửi qua header `X-CSRF-Token` cho mọi mutation; Bearer personal token miễn CSRF. Cookie đã `SameSite=Strict` (lớp 1), CSRF token là defense-in-depth (lớp 2).

### 7.6. `ip.ts` — CIDR matcher IPv4 (✅ verified)

```ts
const toInt = (ip: string) => ip.split('.').reduce((a, o) => ((a << 8) + (+o)) >>> 0, 0);
function inCidr(ip: string, cidr: string) {
  if (!cidr.includes('/')) return ip === cidr;
  const [base, b] = cidr.split('/'); const bits = +b; if (bits === 0) return true;
  const mask = (~((2 ** (32 - bits)) - 1)) >>> 0;
  return (toInt(ip) & mask) === (toInt(base) & mask);
}
export const ipAllowed = (ip: string, list: string) =>
  list.split(',').map(s => s.trim()).filter(Boolean).some(c => inCidr(ip, c));
export function clientIp(req: Request) {           // KHÔNG dùng request.ip (đã gỡ Next 15)
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '';
}
```

---

## 8. `middleware.ts` — stateless gate (sửa O3; không DB, không request.ip)

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { ipAllowed, clientIp } from '@/lib/auth/ip';

const SEC_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex',
};
const withHeaders = (r: NextResponse) => { for (const [k, v] of Object.entries(SEC_HEADERS)) r.headers.set(k, v); return r; };

export function middleware(req: NextRequest) {
  if ((process.env.AUTH_MODE || 'off') === 'off') return NextResponse.next();          // local: passthrough
  if (process.env.DIDI_ENABLED === 'false') return new NextResponse('Not Found', { status: 404 }); // tắt khẩn cấp
  const { pathname } = req.nextUrl;

  const allow = process.env.DIDI_IP_ALLOWLIST;
  if (allow && !ipAllowed(clientIp(req), allow)) return new NextResponse('Not Found', { status: 404 }); // ngoài CIDR → 404

  if (pathname === '/login' || pathname === '/api/health' || pathname.startsWith('/api/auth'))
    return withHeaders(NextResponse.next());

  const hasCookie = !!req.cookies.get('qs_session')?.value;     // req.cookies = sync trong middleware
  const hasBearer = req.headers.get('authorization')?.startsWith('Bearer ');
  if (!hasCookie && !hasBearer) {
    if (pathname.startsWith('/api/')) return withHeaders(NextResponse.json({ error: 'unauthorized' }, { status: 401 }));
    return withHeaders(NextResponse.redirect(new URL('/login', req.url)));
  }
  return withHeaders(NextResponse.next());     // validate DB/role/CSRF nằm ở route helper (Node runtime)
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
```

> Middleware **chỉ** kiểm tra sự hiện diện cookie/Bearer + IP + headers. Validate session thật (DB), RBAC, CSRF làm trong `requireSession`/`requireRole`/`requireCsrf` ở từng API/page (Node runtime) — vì middleware Edge không chạy better-sqlite3 (§2.3).

---

## 9. RBAC V3 (chuẩn hoá file — O5; matcher ✅ verified)

`src/lib/rbac/roles.ts`: `export const ORDER = { viewer: 1, operator: 2, superadmin: 3 }`.

### 9.1. Agent Admin BFF — `src/lib/rbac/agent-admin.ts`

Pattern matcher `method + path` (hỗ trợ `:param` và `/**`), **explicit thắng wildcard**, **default DENY** (không default `POST=operator`). Bảng (giữ nguyên V2 §8.1):

| Pattern | Role tối thiểu |
|---|---|
| `GET /admin/api/**` | viewer |
| `POST /admin/api/kb/search-test` | viewer |
| `POST /admin/api/instructions`, `POST .../instructions/:id/activate` | operator |
| `POST /admin/api/skills`, `PATCH /admin/api/skills/:id` | operator |
| `POST /admin/api/workflows`, `PATCH .../workflows/:id`, `POST .../workflows/:id/run` | operator |
| `POST /admin/api/runs/:id/cancel` | operator |
| `POST /admin/api/kb/upload`, `POST /admin/api/kb/:id/activate`, `POST /admin/api/kb/delta` | operator |
| `POST /admin/api/access/:id` | operator |
| `PATCH /admin/api/settings` | **superadmin** |
| `POST /admin/api/backup`, `POST /admin/api/backup/restore` | **superadmin** |

```ts
// resolve: lọc rule khớp method+path; explicit (không '/**') & path dài hơn ưu tiên; rỗng → null = DENY
export function requiredRole(method: string, path: string): 'viewer'|'operator'|'superadmin'|null { /* §verify */ }
```
Agent (defense-in-depth) vẫn tự check `X-Acting-Role` theo cùng ma trận `04 §4.2.2`.

### 9.2. Didi platform + collector — `src/lib/rbac/didi.ts` (giữ nguyên V2 §8.2)

Điểm cốt yếu: `GET` đọc = mọi role; mutate task/crawl/workflow/history = operator+; `open-folder` server mode = **404 mọi role**; `generate-*` = operator+ (tốn LLM); `/api/accounts/**` = superadmin; `/api/credentials|sessions|tokens/**` = own (không ai đọc plaintext, superadmin chỉ revoke). **UI ẩn nút chỉ là tiện dụng — API mới là chốt enforcement.**

---

## 10. Credential Vault (kế thừa V2 §9)

**Task optional field mới** (không đổi task cũ): `credentialRef?: {source, label?}`, `createdByUserId?`, `scheduleOwnerUserId?`. Server mode: `apiKey` rỗng, `credentialRef` bắt buộc, owner set server-side.

**`vault.ts` resolveCredential — thứ tự:**
- *Server mode:* (1) manual run → credential của actor bấm Run; (2) scheduled → của `scheduleOwnerUserId`; (3) thiếu/revoked → **fail rõ ràng + audit `credential_missing`, KHÔNG fallback plaintext**; (4) env fallback chỉ khi `DIDI_ALLOW_ENV_CREDENTIAL_FALLBACK=true` (mặc định false).
- *Local mode:* (1) `task.apiKey` inline; (2) `.env`; (3) vault nếu có context — không bắt buộc. → **task cũ chạy y nguyên**.

**API sửa:** `crawl`/`test-connection` server mode nhận `credentialRef` (reject `apiKey` non-empty bằng 400 + audit), resolve server-side; `GET tasks` **mask apiKey** trước khi trả browser; `POST tasks` sanitize + set owner. **UI `/knowledge-base`:** `AUTH_MODE=off` giữ nguyên; `required` ẩn input `apiKey`/`outputDir`/Open-Folder, render selector credential + link `/credentials`, không đọc `crawler_settings_store.*.apiKey`.

---

## 11. Crawler wrapper + spawn-by-env (sửa `import path`; ✅ `runpy`)

**Node spawn (server mode):** token/username **chỉ** qua env của child, **không vào argv**.
```ts
spawn(venvPython, [wrapperPath, task.source, '--base-url', task.url, '--output-dir', stagingDir /* arg KHÔNG nhạy cảm */], {
  env: { ...safeEnv(process.env), CRAWLER_USERNAME: resolved.username, CRAWLER_API_KEY: resolved.token },
});
// Local mode: giữ path cũ spawn(venvPython, [scriptPath, '--username', task.username, '--api-key', task.apiKey, ...]) → zero-regression
```
**`crawlers_wrapper.py`** (whitelist script + `runpy`, **không** `import path`, **không** `exec`):
```python
import os, runpy, sys
from pathlib import Path
SCRIPT_MAP = {"confluence":"crawl_confluence.py","jira":"crawl_jira.py","gitlab":"crawl_gitlab.py"}
def main():
    if len(sys.argv) < 2 or sys.argv[1] not in SCRIPT_MAP:
        print("[!] Target required (confluence|jira|gitlab)", flush=True); sys.exit(1)
    target, rest = sys.argv[1], sys.argv[2:]
    user, key = os.environ.get("CRAWLER_USERNAME",""), os.environ.get("CRAWLER_API_KEY","")
    if not user or not key: print("[!] Missing crawler credential env", flush=True); sys.exit(1)
    script = Path(__file__).resolve().parent / SCRIPT_MAP[target]
    sys.argv = [str(script), *rest, "--username", user, "--api-key", key]   # chỉ trong process, KHÔNG hiện /proc/<pid>/cmdline
    runpy.run_path(str(script), run_name="__main__")                        # crawler gốc KHÔNG bị sửa
if __name__ == "__main__": main()
```
> Acceptance: `ps`/`/proc/<pid>/cmdline` + log sau crawl **không** có token; crawler gốc không đổi (R7).

---

## 12. BFF proxy V3 (sửa O2: await params; + streaming + header hygiene)

```ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { requiredRole } from '@/lib/rbac/agent-admin';
import { ORDER } from '@/lib/rbac/roles';
import { audit } from '@/lib/audit';

async function handler(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;                       // ← O2: BẮT BUỘC await
  const session = requireSession(req); if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const adminPath = '/admin/api/' + path.join('/');
  const need = requiredRole(req.method, adminPath);
  if (!need || ORDER[session.role] < ORDER[need]) {        // default-deny + so cấp
    audit('agent_admin_proxy_denied', `didi:${session.username}`, adminPath); 
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' &&
      !verifyCsrf(req.headers.get('x-csrf-token') || '', session.token_hash))
    return NextResponse.json({ error: 'csrf' }, { status: 403 });

  const url = new URL(adminPath + req.nextUrl.search, process.env.AGENT_BASE_URL);
  const ct = req.headers.get('content-type') || '';
  const isStream = req.method !== 'GET' && req.method !== 'HEAD' && ct.includes('multipart/form-data');
  try {
    const res = await fetch(url, {
      method: req.method,
      headers: {                                            // KHÔNG forward Cookie/Host/Authorization của browser
        'Authorization': `Bearer ${process.env.AGENT_ADMIN_TOKEN}`,
        'X-Acting-User': session.username, 'X-Acting-Role': session.role,
        ...(ct ? { 'Content-Type': ct } : {}),
      },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined
           : isStream ? req.body : await req.arrayBuffer(), // upload lớn → stream, không nuốt RAM
      ...(isStream ? { duplex: 'half' as const } : {}),     // Node fetch streaming yêu cầu duplex:'half'
    });
    if (req.method !== 'GET') audit(`agent_admin_proxy_call:${req.method}`, `didi:${session.username}`, adminPath);
    return new NextResponse(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' } });
  } catch (e) {
    audit('agent_admin_proxy_failed', `didi:${session.username}`, adminPath);
    return NextResponse.json({ error: 'agent_unreachable' }, { status: 502 });   // KHÔNG trả err.stack/secret
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
```

---

## 13. Push KB từ Didi & Frontend (kế thừa V2 §12–§13)

**`POST /api/knowledge-base/push-to-agent`** (operator+): xác định `staging/<taskId>` → `GET {AGENT_BASE_URL}/admin/api/kb/manifest` (header `X-Sync-Api-Key: ${AGENT_SYNC_API_KEY}`) → diff theo `pathPrefix` (validate prefix trong allowlist) → zip delta → nếu xoá >30% trong prefix thì reject/confirm → `POST .../kb/delta` → audit `kb_push_to_agent`. Local mode vẫn dùng `queo_sync.py` từ máy Duy.

> **Lưu ý env naming:** Didi giữ giá trị ở `AGENT_SYNC_API_KEY`, gửi cho agent qua **header `X-Sync-Api-Key`**; agent validate với env riêng của nó là `SYNC_API_KEY` (05). Đừng đặt nhầm tên.

**Frontend:** `/login`,`/change-password`,`/setup-2fa` ẩn sidebar; sidebar thêm nhóm "Agent Admin" chỉ khi `required` + role ≥ viewer; `/accounts` chỉ superadmin. Trang cũ: local mode y nguyên; server mode ẩn apiKey/outputDir/Open-Folder, disable mutation với viewer (API vẫn enforce). 9 trang Agent Admin theo `04 §3`, mỗi trang có loading/empty/401→login/403→read-only.

---

## 14. Env & production fail-fast (kế thừa V2 §7.1 + bổ sung)

```text
AUTH_MODE=off|required   DIDI_APP_SECRET=   DIDI_BOOTSTRAP_USER=   DIDI_BOOTSTRAP_PASSWORD=
DIDI_REQUIRE_2FA=true    DIDI_IP_ALLOWLIST=   DIDI_ENABLED=true
DIDI_SESSION_TTL_HOURS=12   DIDI_SESSION_IDLE_MINUTES=60   DIDI_ALLOW_ENV_CREDENTIAL_FALLBACK=false
AGENT_BASE_URL=   AGENT_ADMIN_TOKEN=   AGENT_SYNC_API_KEY=
STATE_DIR=/data   GEMINI_API_KEY=   S3_ENDPOINT= S3_BUCKET= S3_ACCESS_KEY= S3_SECRET_KEY= S3_REGION=
```
**Fail-fast khi `AUTH_MODE=required`:** `DIDI_APP_SECRET` ≥ 32; nếu `admin_users` rỗng thì bắt buộc có `DIDI_BOOTSTRAP_USER` + `DIDI_BOOTSTRAP_PASSWORD` (≥ 12 ký tự) — **không có fallback password**; nếu bật Agent Admin thì `AGENT_ADMIN_TOKEN` ≥ 32 + `AGENT_BASE_URL` bắt buộc. Sau bootstrap, xoá `DIDI_BOOTSTRAP_*` khỏi runtime env.

---

## 15. Milestone D0→D5 (kế thừa V2 §14, bổ sung acceptance O1/O2/O4)

| MS | Nội dung | Thời lượng | Acceptance bổ sung của V3 |
|---|---|---|---|
| **D0** Baseline | branch riêng; **re-verify source Didi live** (Next ver, API/page, syncDaemon, crawler); ghi inventory; `.gitignore`/`.dockerignore` đủ; baseline `npm run build`; test helper auth/RBAC | 0,5 ngày | R1–R7 baseline ghi nhận; xác nhận **Next 16** (chốt luật §2.2); không đụng crawler/`*.command` |
| **D1** DB+env+envelope | `time.ts`, `db.ts` (singleton + `foreign_keys=ON`), `migrations.ts` (DDL §6, **INTEGER ts**), `env.ts` fail-fast, `crypto.ts`, `middleware.ts`, `/api/health`, `next.config` `serverExternalPackages` | 0,5–1 ngày | `AUTH_MODE=off` chạy như cũ; `required` không cookie→redirect/401; `DIDI_ENABLED=false`→404; headers có trên `/login`; **`npm run build` pass với `serverExternalPackages`** (O4) |
| **D2** Auth+RBAC+Accounts+CSRF | login/logout/change-pw/setup-2fa; session rotate, TTL 12h + idle 1h (numeric §7.4); lockout 5/user + IP ≥10/15m (`login_failures`); `/accounts`,`/api/{me,accounts,sessions,tokens}`; RBAC bọc API cũ; CSRF | 1–1,5 ngày | login đầu ép đổi pass + 2FA; viewer mutate→403+audit; operator tạo account→403; disable user đang login→401; thiếu CSRF→403; **expired session (set `expires_at` quá khứ)→401** (O1); R1–R7 pass ở `off` |
| **D3** Vault + collector server mode | `/credentials` UI/API; `vault.ts` encrypt/decrypt/revoke; sửa UI `/knowledge-base` theo mode; sửa `crawl`/`test-connection`/`tasks`; `syncDaemon.js` resolve credentialRef + spawn-env; `crawlers_wrapper.py`; mask log | 1 ngày | crawl bằng vault của người bấm Run OK; scheduled dùng `scheduleOwnerUserId`; A không dùng cred của B; superadmin revoke (không đọc); `ps`/log không lộ token; task cũ apiKey inline vẫn chạy (R3/R4) |
| **D4** Agent Admin BFF + pages | `/api/agent-admin/[...path]` (**`await params`** O2, streaming, header hygiene); RBAC matcher; 9 trang `/agent-admin/**` nối `04`; audit proxy | 1,5–2 ngày | viewer GET/`kb/search-test` OK, mutate→403; operator sửa skill/workflow OK, `PATCH settings`→403; agent audit `didi:<username>`; **upload KB qua proxy không nuốt full RAM**; **route động không crash vì params** (O2) |
| **D5** Push KB + Docker + hardening + deploy | `push-to-agent` (delta theo prefix, limit xoá >30%); Dockerfile multi-stage Node22+py+venv + `output:'standalone'`; STATE_DIR + S3; **verify outbound Confluence/GitLab từ runtime**; security checklist `04 §4.3` mục 8–12 | 1–1,5 ngày | login ngoài + 2FA; crawl→staging→push; hỏi Queo thấy tri thức mới; redeploy không mất `didi.sqlite3`/state; IP ngoài allowlist→404; `DIDI_BOOTSTRAP_*` đã xoá; **`node -e "require('better-sqlite3')"` chạy trong image** (O4) |

> Mỗi milestone trên branch riêng, chạy R1–R7 local mode trước khi merge. D4 phụ thuộc agent M3 headless (`07`).

---

## 16. Test plan (kế thừa V2 §15 + test bắt O1/O2/O4)

**Unit:** hash/verify password; TOTP ±1 step + sai OTP; AES-GCM sai key fail; CSRF valid/expired/tampered; **CIDR allowlist** (✅); **RBAC matcher** agent-admin + Didi (✅, gồm `PATCH settings`=superadmin, default-deny); vault create/update/revoke + không trả plaintext; sanitize tasks mask apiKey; wrapper builder không có token trong argv.

**Integration:** login flow + lockout; ma trận role×route; `AUTH_MODE=off` API cũ không đổi behavior; `required` `crawl` reject inline apiKey; BFF thêm `Authorization`+`X-Acting-*` & deny trước khi gọi agent; push-to-agent gọi manifest→delta với `X-Sync-Api-Key`. **Mới (V3):** **expired-session → 401** (set `expires_at = now-1`, chống O1); **idle-timeout → 401**; **route động BFF `await params`** trả đúng (chống O2 — smoke 1 request `GET /api/agent-admin/status`).

**Build (mới — O4):** `npm run build` pass với `serverExternalPackages`; image chạy `require('better-sqlite3')` OK; middleware không import better-sqlite3 (grep).

**Manual R1–R7** (zero-regression, giữ nguyên): R1 boot `Start App.command` đúng port; R2 mở 5 trang cũ không lỗi; R3 crawl Confluence cũ về đúng outputDir; R4 daemon hourly chạy + ghi history; R5 workflow chain 2 task; R6 settings localStorage local mode; R7 `git diff` không đụng `crawl_*.py`/`*.command`.

**Security checklist (Didi §4.3 mục 8–12):** sai pass 5 lần→khoá 15'; login đầu→đổi pass+2FA; thiếu OTP→reject; viewer mutate→403+audit; operator account/settings/backup→403; disable account→session invalid; thiếu CSRF→403; IP ngoài allowlist→404; `DIDI_ENABLED=false`→404; grep log/process args không có token; A không đọc/dùng cred của B; bootstrap env removed.

---

## 17. Rủi ro (kế thừa V2 §16 + Next-16 API drift)

| Rủi ro | Mức | Đối sách |
|---|---|---|
| GreenNode không vào được Confluence/GitLab nội bộ | Cao | Verify curl đầu D5; fail → crawl giữ local, Didi server chỉ admin/vault (`07 §8`) |
| **Next 16 API drift** (params Promise, request.ip gỡ, async headers) | **Cao nếu copy idiom cũ** | §2.2 là luật bắt buộc; test route động ở D4; lint cấm `request.ip` |
| Next middleware không chạy SQLite native | Cao nếu thiết kế sai | Middleware stateless; DB auth ở Node route helper (§2.3, §8) |
| Upload KB lớn qua BFF nổ RAM | TB | Stream multipart + `duplex:'half'`, không `arrayBuffer()` với zip (§12) |
| better-sqlite3 build trong Docker | Thấp-TB | multi-stage, pin Node 22, `serverExternalPackages`, verify native binary D5 |
| Worktree Didi đang dirty | TB | Branch riêng, không revert thay đổi không liên quan, đọc diff trước khi sửa |
| Role matrix drift Didi↔agent | TB | Matcher hardcode + test; agent vẫn defense-in-depth check `X-Acting-Role` |
| Secret trong tasks local lên server | TB | `.dockerignore` loại `/data`; server tạo task mới; nếu import → script strip apiKey |

---

## 18. Definition of Done & thứ tự coding

**DoD** (V2 §17 + bổ sung): (1) `AUTH_MODE=off` pass R1–R7; (2) `required` pass security checklist 8–12; (3) RBAC matrix có automated test; (4) token không xuất hiện ở response/audit/log/process args; (5) BFF không để token agent xuống browser; (6) Accounts ngoài `/agent-admin`; (7) Agent Admin mutation hot-reload trên agent; (8) push-to-agent delta thành công; (9) image không chứa `.env`/`/data`/`*.sqlite3`/log; (10) README/IMPLEMENTATION_NOTES cập nhật vận hành + rollback. **(11 — V3) mọi cột thời gian là INTEGER ms, không còn `datetime()` trong query; (12 — V3) mọi route động `await params`, không còn `request.ip`, build pass với `serverExternalPackages`.**

**Thứ tự coding (giảm rủi ro):** D0 baseline (chưa đụng code đang chạy) → D1 middleware/env/DB ở `off` (ít ảnh hưởng nhất) → D2 auth/RBAC API cũ (điều kiện để public) → D3 vault/crawler (điểm có secret) → D4 BFF/pages (phụ thuộc agent M3) → D5 deploy/push (phụ thuộc network). Gặp source Didi dirty: **không revert**, đọc diff, giữ thay đổi của user, chỉ sửa phần cần thiết.

---

## 19. Doc cần cập nhật sau khi chốt V3

| Doc | Sửa |
|---|---|
| `07 §3.1`, `§5` | DDL Didi dùng **INTEGER epoch ms** cho mọi timestamp; thêm chú thích Next-16 (await params, no request.ip) |
| `04 §4.2.1` | Session expiry mô tả theo numeric ms (đồng bộ §2.1) |
| `05 §7` (D-series) | Trỏ tới `PLAN-V3-OPUS.md` là bản code theo; thêm bước verify `serverExternalPackages` + native binary |
| `IMPLEMENTATION_NOTES.md` (Didi repo) | Ghi header IP thực tế của AgentBase ingress (D5); thời gian/dung lượng build |
