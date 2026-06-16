# Kế hoạch chi tiết: Tích hợp quản trị Agent vào Didi AI Tool

Bản kế hoạch kỹ thuật chi tiết này được thiết kế để chuẩn bị trực tiếp cho việc coding. Nó bao gồm thiết kế cấu trúc thư mục, chi tiết Schema DB, mã nguồn khung (code skeleton) cho các file nghiệp vụ cốt lõi, luồng API BFF proxy, và kịch bản xác minh bảo mật/regression.

---

## 1. Cấu trúc thư mục dự kiến sau khi sửa đổi

Các file có dấu `[NEW]` hoặc `[MODIFY]` đại diện cho các thay đổi cần thực hiện trong `/Users/lap16947/Lab/Didi Ai Tool`.

```
Didi Ai Tool/
├── data/
│   ├── didi.sqlite3                  # [NEW] Cơ sở dữ liệu xác thực & Vault
│   ├── tasks.json                    # Schema cũ giữ nguyên, thêm credentialRef (optional)
│   ├── workflows.json                # Schema cũ giữ nguyên
│   └── history.json                  # Schema cũ giữ nguyên
├── src/
│   ├── middleware.ts                 # [NEW] Kiểm soát truy cập, IP allowlist, security headers
│   ├── app/
│   │   ├── login/
│   │   │   └── page.tsx              # [NEW] Trang đăng nhập + Setup OTP 2FA
│   │   ├── agent-admin/              # [NEW] Các trang trong phân hệ Agent Admin
│   │   │   ├── page.tsx              # Redirect sang dashboard
│   │   │   ├── dashboard/page.tsx    # Dashboard trạng thái & LLM chart
│   │   │   ├── instructions/page.tsx # Markdown editor cho Instruction/Persona
│   │   │   ├── skills/page.tsx       # Quản lý triggers, aliases của Skills
│   │   │   ├── workflows/page.tsx    # Quản lý lịch chạy, chạy thử Workflows
│   │   │   ├── runs/page.tsx         # Theo dõi log chi tiết của từng lượt chạy (Runs)
│   │   │   ├── knowledge/page.tsx    # Quản lý KB versions, sync delta, search-test FTS
│   │   │   ├── access/page.tsx       # Duyệt & thu hồi tài khoản Telegram
│   │   │   ├── accounts/page.tsx     # Quản lý admin users (chỉ superadmin)
│   │   │   ├── audit/page.tsx        # Bảng hiển thị lịch sử thao tác hệ thống
│   │   │   └── settings/page.tsx     # Cấu hình cài đặt Quéo Agent, Model Router
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   └── [...action]/      # [NEW] API xử lý đăng nhập, đăng xuất, setup/verify 2FA
│   │   │   ├── credentials/          # [NEW] API quản lý token trong vault cá nhân
│   │   │   ├── agent-admin/
│   │   │   │   └── [...path]/        # [NEW] BFF Proxy API gửi request có Bearer + Actor sang Agent
│   │   │   └── knowledge-base/
│   │   │       └── push-to-agent/    # [NEW] API đóng gói delta zip và sync sang backend của Agent
│   │   └── layout.tsx                # [MODIFY] Check AUTH_MODE để chèn Provider hoặc ẩn UI nếu chưa đăng nhập
│   ├── components/
│   │   ├── layout/
│   │   │   └── sidebar.tsx           # [MODIFY] Thêm nhóm menu Agent Admin
│   │   └── agent-admin/              # [NEW] Các components phục vụ riêng cho Agent Admin
│   ├── lib/
│   │   ├── db.ts                     # [NEW] Khởi tạo SQLite via better-sqlite3 + migrations
│   │   ├── auth.ts                   # [NEW] Hàm băm scrypt, sinh/xác minh mã TOTP
│   │   ├── crypto.ts                 # [NEW] Mã hóa AES-256-GCM cho Credential Vault
│   │   └── db-helpers.ts             # [NEW] Quản lý session, audit log và truy vấn DB
│   └── scripts/
│       ├── worker/
│       │   └── syncDaemon.js         # [MODIFY] Hỗ trợ resolve credentialRef và spawn-bằng-env
│       └── confluence_docs_tools/
│           └── crawlers_wrapper.py   # [NEW] Wrapper python chuyển env API KEY thành process args
├── package.json                      # [MODIFY] Thêm "better-sqlite3" và "@types/better-sqlite3"
└── Dockerfile                        # [NEW] Multi-stage build cho Didi AI Tool kèm python/venv
```

---

## 2. Thiết kế Schema Cơ sở Dữ liệu (`didi.sqlite3`)

DDL dưới đây sẽ được tự động khởi tạo trong `src/lib/db.ts` khi ứng dụng boot:

```sql
PRAGMA journal_mode=WAL;

-- Bảng lưu người dùng quản trị
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,             -- Định dạng: "scrypt$<n>$<r>$<p>$<salt_b64>$<hash_b64>"
  role TEXT NOT NULL CHECK(role IN ('superadmin','operator','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  totp_secret TEXT,                        -- Encrypted string lưu secret 2FA (NULL = chưa kích hoạt)
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,                       -- Định dạng ISO string thời gian khóa tài khoản tạm thời
  last_login_at TEXT,
  last_login_ip TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Bảng quản lý phiên hoạt động (Session)
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,             -- sha256 của session token truyền qua cookie
  user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,                -- TTL 12h
  last_seen_at TEXT,                       -- Idle timeout 1h
  ip TEXT,
  user_agent TEXT
);

-- Bảng quản lý Personal Access Token (cho API/CI)
CREATE TABLE IF NOT EXISTS admin_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,         -- sha256 của token
  expires_at TEXT NOT NULL,                -- Max 90 ngày
  last_used_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Bảng Credential Vault của từng user
CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('confluence','jira','gitlab')),
  label TEXT NOT NULL DEFAULT 'default',
  username TEXT NOT NULL,
  token_encrypted BLOB NOT NULL,          -- AES-256-GCM băm mã hóa
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE(user_id, source, label)
);

-- Bảng Audit Log ghi lại lịch sử thao tác
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,                     -- Định dạng: "didi:<username>"
  action TEXT NOT NULL,                    -- Vd: 'login_ok', 'login_fail', 'kb_push', 'change_persona'...
  target TEXT,                             -- Đối tượng chịu tác động (vd ID task, user id)
  detail TEXT,                             -- Chi tiết dạng JSON string (không chứa secrets)
  created_at TEXT NOT NULL
);
```

---

## 3. Mã nguồn khung (Code Skeletons) phục vụ Coding

### 3.1. DB Module: `src/lib/db.ts`
Khởi tạo và cấu hình database qua thư viện `better-sqlite3`.

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const stateDir = process.env.STATE_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(stateDir)) {
  fs.mkdirSync(stateDir, { recursive: true });
}

const dbPath = path.join(stateDir, 'didi.sqlite3');
const db = new Database(dbPath);

// Cấu hình WAL mode để tránh lock file khi đọc ghi đồng thời
db.pragma('journal_mode = WAL');

// Khởi chạy migrations DDL
export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('superadmin','operator','viewer')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      totp_secret TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_login_at TEXT,
      last_login_ip TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    -- Thêm các bảng khác (admin_sessions, admin_tokens, credentials, audit_log) tại đây...
  `);

  // Hạt giống (Seed) tài khoản superadmin đầu tiên nếu DB trống
  const row = db.prepare('SELECT count(*) as count FROM admin_users').get() as { count: number };
  if (row.count === 0) {
    const bootstrapUser = process.env.DIDI_BOOTSTRAP_USER || 'admin';
    const bootstrapPass = process.env.DIDI_BOOTSTRAP_PASSWORD || 'BootstrapPassword123!';
    
    // Logic băm password bằng scrypt sẽ nằm ở đây...
    // Insert user với role='superadmin' và must_change_password=1
  }
}

export default db;
```

---

### 3.2. Crypto Module: `src/lib/crypto.ts`
Mã hóa AES-256-GCM cho Credential Vault của User bằng khóa dẫn xuất từ `DIDI_APP_SECRET`.

```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT_LEN = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.DIDI_APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('DIDI_APP_SECRET must be at least 32 characters in production');
  }
  // Sử dụng HKDF để tạo ra khóa 32 bytes an toàn từ secret
  return crypto.hkdfSync('sha256', secret, '', 'cred-vault', KEY_LEN);
}

export function encrypt(text: string): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  
  // Đóng gói: [iv (12 bytes)] + [tag (16 bytes)] + [encrypted_data]
  return Buffer.concat([iv, tag, encrypted]);
}

export function decrypt(buffer: Buffer): string {
  const key = getEncryptionKey();
  const iv = buffer.subarray(0, IV_LEN);
  const tag = buffer.subarray(IV_LEN, IV_LEN + 16);
  const encrypted = buffer.subarray(IV_LEN + 16);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

---

### 3.3. Auth Helpers: `src/lib/auth.ts`
Băm mật khẩu scrypt và xác minh TOTP sử dụng module `crypto` thuần của Node.js.

```typescript
import crypto from 'crypto';

// Băm mật khẩu sử dụng scrypt
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('base64');
    // Cấu hình tham số scrypt: N=16384, r=8, p=1 theo ADR-2/v3
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$16384$8$1$${salt}$${derivedKey.toString('base64')}`);
    });
  });
}

// So khớp mật khẩu
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [algo, nStr, rStr, pStr, salt, keyBase64] = hash.split('$');
    if (algo !== 'scrypt') return resolve(false);
    
    const N = parseInt(nStr, 10);
    const r = parseInt(rStr, 10);
    const p = parseInt(pStr, 10);
    const originalKey = Buffer.from(keyBase64, 'base64');
    
    crypto.scrypt(password, salt, originalKey.length, { N, r, p }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(originalKey, derivedKey));
    });
  });
}

// Xác minh mã TOTP (RFC 6238)
export function verifyTOTP(secret: string, token: string): boolean {
  // Decode Base32 secret sang buffer byte
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (let i = 0; i < secret.length; i++) {
    const val = base32chars.indexOf(secret.charAt(i).toUpperCase());
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  const key = Buffer.from(bytes);

  // Xác minh trong khoảng lệch ±1 time-step (mỗi bước 30 giây)
  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = 30;
  const currentStep = Math.floor(epoch / timeStep);

  for (let stepOffset = -1; stepOffset <= 1; stepOffset++) {
    const step = currentStep + stepOffset;
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(BigInt(step), 0);

    const hmac = crypto.createHmac('sha1', key);
    hmac.update(buffer);
    const hmacResult = hmac.digest();

    const offset = hmacResult[hmacResult.length - 1] & 0xf;
    const code =
      ((hmacResult[offset] & 0x7f) << 24) |
      ((hmacResult[offset + 1] & 0xff) << 16) |
      ((hmacResult[offset + 2] & 0xff) << 8) |
      (hmacResult[offset + 3] & 0xff);

    const checkToken = (code % 1_000_000).toString().padStart(6, '0');
    if (checkToken === token) {
      return true;
    }
  }
  return false;
}
```

---

### 3.4. Middleware Kiểm Soát Quyền: `src/middleware.ts`
Chặn/chuyển tiếp luồng request, kiểm soát IP Allowlist và Cookie Session ở server mode.

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const authMode = process.env.AUTH_MODE || 'off';
  
  // 1. Nếu AUTH_MODE=off (Local mode): Bỏ qua toàn bộ kiểm tra bảo mật
  if (authMode === 'off') {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // 2. Cho phép bỏ qua kiểm tra Session đối với trang login và kiểm tra health
  if (pathname === '/login' || pathname.startsWith('/api/auth') || pathname === '/api/health') {
    return NextResponse.next();
  }

  // 3. Kiểm tra IP Allowlist nếu cấu hình
  const ipAllowlist = process.env.DIDI_IP_ALLOWLIST;
  if (ipAllowlist) {
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] || request.ip;
    const allowedIps = ipAllowlist.split(',').map(ip => ip.trim());
    if (clientIp && !allowedIps.includes(clientIp)) {
      // Trả về 404 để bảo mật, giấu sự tồn tại của admin tool
      return new NextResponse('Not Found', { status: 404 });
    }
  }

  // 4. Xác minh session token từ cookie 'qs_session'
  const sessionCookie = request.cookies.get('qs_session')?.value;
  if (!sessionCookie) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Tiếp tục chuyển tiếp xử lý, xác thực DB sâu hơn sẽ làm tại API handler
  return NextResponse.next();
}
```

---

### 3.5. BFF Proxy API Router: `src/app/api/agent-admin/[...path]/route.ts`
Nhận request từ Didi UI -> Thực thi RBAC -> Đính kèm token hệ thống và metadata danh tính người dùng -> Forward sang FastAPI Agent.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import crypto from 'crypto';

// Ma trận quyền tối thiểu tại Didi (đại diện)
const MIN_ROLES: { [key: string]: 'superadmin' | 'operator' | 'viewer' } = {
  'GET': 'viewer',
  'POST': 'operator',
  'PATCH': 'operator',
  'DELETE': 'operator',
  // Override cụ thể cho các hành động nhạy cảm
  'POST:/admin/api/settings': 'superadmin',
  'POST:/admin/api/backup': 'superadmin',
  'POST:/admin/api/backup/restore': 'superadmin'
};

async function checkSessionAndRole(request: NextRequest) {
  const sessionToken = request.cookies.get('qs_session')?.value;
  if (!sessionToken) return null;
  
  const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
  
  const session = db.prepare(`
    SELECT s.*, u.username, u.role, u.status 
    FROM admin_sessions s
    JOIN admin_users u ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.status = 'active'
  `).get(tokenHash) as { username: string, role: 'superadmin' | 'operator' | 'viewer' } | undefined;
  
  return session || null;
}

export async function generateHandler(request: NextRequest, { params }: { params: { path: string[] } }) {
  const session = await checkSessionAndRole(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const method = request.method;
  const pathStr = '/admin/api/' + params.path.join('/');
  
  // Xác định quyền tối thiểu cần có
  const actionKey = `${method}:${pathStr}`;
  const requiredRole = MIN_ROLES[actionKey] || MIN_ROLES[method] || 'operator';
  
  // So sánh vai trò (viewer < operator < superadmin)
  const roleWeights = { 'viewer': 1, 'operator': 2, 'superadmin': 3 };
  if (roleWeights[session.role] < roleWeights[requiredRole]) {
    // Lưu audit log về hành động bị từ chối
    db.prepare('INSERT INTO audit_log (actor, action, target, created_at) VALUES (?, ?, ?, datetime("now"))')
      .run(`didi:${session.username}`, 'denied_admin', pathStr);
      
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Gọi proxy sang FastAPI Agent
  const agentBaseUrl = process.env.AGENT_BASE_URL || 'http://localhost:8080';
  const targetUrl = new URL(request.nextUrl.pathname.replace('/api/agent-admin', '/admin/api') + request.nextUrl.search, agentBaseUrl);
  
  const body = method !== 'GET' && method !== 'HEAD' ? await request.arrayBuffer() : undefined;
  
  try {
    const response = await fetch(targetUrl.toString(), {
      method,
      headers: {
        'Authorization': `Bearer ${process.env.AGENT_ADMIN_TOKEN}`,
        'X-Acting-User': session.username,
        'X-Acting-Role': session.role,
        'Content-Type': request.headers.get('content-type') || 'application/json'
      },
      body
    });

    const data = await response.arrayBuffer();
    
    // Ghi audit log nếu đây là thao tác thay đổi dữ liệu (mutation)
    if (method !== 'GET') {
      db.prepare('INSERT INTO audit_log (actor, action, target, created_at) VALUES (?, ?, ?, datetime("now"))')
        .run(`didi:${session.username}`, `api_call:${method}`, pathStr);
    }

    return new NextResponse(data, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json'
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Agent Connection Failed', details: err.message }, { status: 502 });
  }
}

export { generateHandler as GET, generateHandler as POST, generateHandler as PATCH, generateHandler as DELETE };
```

---

### 3.6. Python Crawler Wrapper: `src/scripts/confluence_docs_tools/crawlers_wrapper.py`
Giúp che giấu API key khi spawn tiến trình.

```python
import sys
import os
import path

def main():
    if len(sys.argv) < 2:
        print("[!] Target crawler name required (confluence|jira|gitlab).")
        sys.exit(1)
        
    target = sys.argv[1]
    # Pop target name ra khỏi sys.argv để không gây lỗi khi argparse trong crawler parse
    sys.argv.pop(1)
    
    # Đọc credentials ẩn từ biến môi trường
    api_key = os.environ.get("CRAWLER_API_KEY", "")
    username = os.environ.get("CRAWLER_USERNAME", "")
    
    # Nối thêm các tham số nhạy cảm vào đối số của script
    sys.argv.extend(["--api-key", api_key, "--username", username])
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    script_name = f"crawl_{target}.py"
    script_path = os.path.join(script_dir, script_name)
    
    if not os.path.exists(script_path):
        print(f"[!] Target script not found: {script_name}")
        sys.exit(1)
        
    sys.path.insert(0, script_dir)
    with open(script_path, "r", encoding="utf-8") as f:
        code = f.read()
        
    # Thực thi script gốc trong cùng tiến trình hiện tại
    exec(code, {"__name__": "__main__", "__file__": script_path})

if __name__ == "__main__":
    main()
```

---

## 4. Giao diện (Frontend Pages & UI) trong Phân hệ Quản trị

Mỗi trang sẽ có giao diện cao cấp, áp dụng bảng màu trung tính, bóng đổ (soft shadows), bo góc (`rounded-2xl`) và animation mượt mà:

1. **Dashboard (`/agent-admin/dashboard`):**
   - Panel trạng thái hoạt động: Hiển thị model router chính, số lượng người dùng Telegram được cho phép, phiên bản tri thức hiện hoạt.
   - Thống kê chi phí và số lượt gọi LLM trong 7 ngày qua (vẽ biểu đồ mượt mà bằng Canvas/CSS).
   - Danh sách 10 sự kiện audit log mới nhất.
2. **Biên soạn Instruction (`/agent-admin/instructions`):**
   - Markdown Editor `@uiw/react-md-editor` chỉnh sửa trực tiếp Persona/Instruction hệ thống.
   - Bảng hiển thị danh sách phiên bản, người cập nhật, thời gian và nút nhấn Rollback.
3. **Quản lý Skills & Workflows (`/agent-admin/skills`, `/agent-admin/workflows`):**
   - Bảng thống kê trạng thái (Enabled/Disabled), Nút sửa Trigger, Thiết lập Cron Schedule cho Workflow.
   - Editor ghi đè nội dung (`content_override`). Nút "Run now" để kích hoạt kiểm thử lập tức.
4. **Theo dõi lượt chạy (`/agent-admin/runs`):**
   - Danh sách lịch sử thực thi workflows. Nhấp chọn xem chi tiết: Log console thời gian thực từng step, danh sách tool calls đã gọi, các tệp artifacts tạo ra kèm link tải.
5. **Knowledge Hub (`/agent-admin/knowledge`):**
   - Khung kéo thả tải file `.zip` tri thức mới.
   - Khối cấu hình đồng bộ tự động (Auto-sync) hiển thị lịch sử đồng bộ delta push từ máy anh Duy, cảnh báo dung lượng/giới hạn xóa file (>30%).
   - Thanh Search-test cho phép nhập câu hỏi để kiểm tra kết quả trả về của FTS5 BM25.
6. **Bảng phân quyền tài khoản & Audit (`/agent-admin/accounts`, `/agent-admin/audit`):**
   - Superadmin quản lý danh sách tài khoản, vô hiệu hóa tài khoản, thu hồi session token.
   - Lọc audit logs theo hành động/actor/khoảng thời gian.

---

## 5. Kịch bản xác minh Zero-Regression (R1 - R7)

Sau khi hoàn tất mỗi Milestone phát triển, lập trình viên bắt buộc phải chạy kịch bản kiểm thử tĩnh và động để đảm bảo không lỗi ứng dụng cũ:

1. **R1:** Chạy `Start App.command` kiểm tra app khởi chạy bình thường, cổng Next.js không đổi.
2. **R2:** Mở 5 trang tính năng cũ (`/`, `/knowledge-base`, `/workflows`, `/history`, `/settings`) kiểm tra không có lỗi console hay crash giao diện.
3. **R3:** Chạy tay 1 crawl Confluence đã cấu hình từ trước xem file markdown có được tải chính xác về thư mục `outputDir` của local máy Duy hay không.
4. **R4:** Kích hoạt cron daemon chạy tự động 1 task hourly kiểm tra chạy đúng tiến độ và ghi lịch sử chạy.
5. **R5:** Chạy thử nghiệm workflow xích 2 task crawl liên tục kiểm tra kết quả chạy tuần tự.
6. **R6:** Kiểm tra cài đặt lưu trữ localStorage vẫn lưu giữ các cấu hình cũ (ở chế độ Local mode).
7. **R7:** Dùng lệnh `git diff` xác nhận không có bất kỳ dòng code nào bị thay đổi trong các file crawlers gốc (`crawl_*.py`) và các file kịch bản điều khiển (`*.command`).
