# Backend Handoff - Agent Admin + Didi Platform

Status: backend-first implementation for PLAN-V3-OPUS.

This document is the contract for the frontend engineer. The current backend supports local mode (`AUTH_MODE=off`) and server mode (`AUTH_MODE=required`). Frontend work should consume these APIs directly and avoid duplicating auth, RBAC, credential, or agent-token logic in the browser.

## Global Rules

- All dynamic timestamps returned by new platform APIs are epoch milliseconds.
- In `AUTH_MODE=off`, existing Didi pages should behave as before.
- In `AUTH_MODE=required`, browser never sends plaintext Confluence/Jira/GitLab tokens to crawl/test APIs. Use `credentialRef`.
- Mutating requests with cookie session must send `X-CSRF-Token`.
- Bearer personal tokens are for API/CI and do not require CSRF.
- `viewer` can read; `operator` can mutate collector and agent-admin content; `superadmin` can manage accounts/settings.

## Auth Bootstrap

Server mode first boot requires:

```text
AUTH_MODE=required
DIDI_APP_SECRET=<32+ chars>
DIDI_BOOTSTRAP_USER=<admin username>
DIDI_BOOTSTRAP_PASSWORD=<12+ chars>
```

Backend creates the first `superadmin` with `mustChangePassword=true`.

## Common Frontend Boot Flow

1. Call `GET /api/me`.
2. If `authenticated=false`, route to `/login`.
3. Store `csrfToken` from `/api/me` or call `GET /api/security/csrf`.
4. Use `user.role` to hide controls, but still expect backend 403.
5. If `user.mustChangePassword`, route to `/change-password`.
6. If `AUTH_MODE=required`, server may return `nextStep=setup_2fa` after login.

Example `GET /api/me` response:

```json
{
  "authMode": "required",
  "authenticated": true,
  "user": {
    "id": 1,
    "username": "duy",
    "role": "superadmin",
    "mustChangePassword": false,
    "hasTotp": true
  },
  "csrfToken": "1710000000000.abcd..."
}
```

## Auth APIs

### `POST /api/auth/login`

Body:

```json
{ "username": "duy", "password": "********", "otp": "123456" }
```

Responses:

```json
{ "requiresOtp": true }
```

```json
{
  "success": true,
  "nextStep": "change_password",
  "user": { "id": 1, "username": "duy", "role": "superadmin", "mustChangePassword": true, "hasTotp": false },
  "csrfToken": "..."
}
```

`nextStep` values: `change_password`, `setup_2fa`, `app`.

### `POST /api/auth/logout`

Clears `qs_session`.

### `POST /api/auth/change-password`

Requires session.

Body:

```json
{ "currentPassword": "old", "newPassword": "new-12-chars-min" }
```

### `POST /api/auth/setup-2fa/start`

Requires session.

Response:

```json
{
  "secret": "BASE32SECRET",
  "otpauthUrl": "otpauth://totp/Queo:duy?secret=...&issuer=Queo"
}
```

Frontend can render QR from `otpauthUrl`; backend intentionally does not require a QR dependency.

### `POST /api/auth/setup-2fa/verify`

Requires session.

Body:

```json
{ "secret": "BASE32SECRET", "otp": "123456" }
```

## CSRF

### `GET /api/security/csrf`

Response:

```json
{ "csrfToken": "1710000000000.abcd..." }
```

Send this token on mutating calls:

```http
X-CSRF-Token: 1710000000000.abcd...
```

## Accounts APIs

Superadmin only.

### `GET /api/accounts`

Returns:

```json
{ "users": [{ "id": 1, "username": "duy", "role": "superadmin", "status": "active", "hasTotp": true }] }
```

### `POST /api/accounts`

Headers: `X-CSRF-Token`.

Body:

```json
{ "username": "operator1", "role": "operator", "password": "optional-temp-pass" }
```

If `password` is omitted, backend returns `temporaryPassword` once.

### `PATCH /api/accounts/:id`

Headers: `X-CSRF-Token`.

Body examples:

```json
{ "role": "viewer" }
```

```json
{ "status": "disabled" }
```

```json
{ "resetPassword": true }
```

```json
{ "resetTotp": true }
```

Disabling or resetting password/2FA revokes active sessions.

## Session APIs

### `GET /api/sessions`

Lists own sessions. Superadmin can call `GET /api/sessions?all=1`.

### `DELETE /api/sessions/:tokenHash`

Headers: `X-CSRF-Token`.

User can revoke own session; superadmin can revoke any.

## Personal Token APIs

### `GET /api/tokens`

Lists own tokens. Plaintext token is never returned.

### `POST /api/tokens`

Headers: `X-CSRF-Token`.

Body:

```json
{ "name": "ci", "expiresAt": 1710000000000 }
```

Returns plaintext token exactly once:

```json
{ "success": true, "token": "dpat_...", "expiresAt": 1710000000000 }
```

Max TTL is 90 days.

### `DELETE /api/tokens/:id`

Headers: `X-CSRF-Token`.

Revokes token.

## Credential Vault APIs

Every role can manage its own credentials. Superadmin can revoke another user's credential by id but cannot read plaintext.

### `GET /api/credentials`

Returns metadata only:

```json
{
  "credentials": [
    {
      "id": 1,
      "source": "confluence",
      "label": "default",
      "username": "duy",
      "createdAt": 1710000000000,
      "updatedAt": 1710000000000,
      "lastUsedAt": null,
      "revoked": 0
    }
  ]
}
```

### `POST /api/credentials`

Headers: `X-CSRF-Token`.

Body:

```json
{
  "source": "confluence",
  "label": "default",
  "username": "duy",
  "token": "plaintext only in this request"
}
```

The token is encrypted at rest and never returned.

### `DELETE /api/credentials/:id`

Headers: `X-CSRF-Token`.

Revokes credential.

## Existing Collector APIs In Server Mode

### Tasks

`GET /api/knowledge-base/tasks`

- `AUTH_MODE=off`: returns tasks unchanged.
- `AUTH_MODE=required`: returns tasks with `apiKey` masked as `[redacted]`.

`POST /api/knowledge-base/tasks`

- `AUTH_MODE=off`: accepts old task shape.
- `AUTH_MODE=required`: backend strips `apiKey`, sets `createdByUserId`, and sets `scheduleOwnerUserId` for scheduled tasks.

Server-mode task shape:

```json
{
  "id": "task-1",
  "name": "MMF Confluence",
  "source": "confluence",
  "url": "https://confluence.example.com",
  "username": "",
  "apiKey": "",
  "credentialRef": { "source": "confluence", "label": "default" },
  "outputDir": "",
  "rules": [],
  "formats": ["md"],
  "isAutoSync": false
}
```

### Run Crawl

`POST /api/knowledge-base/crawl`

Headers: `X-CSRF-Token`.

Server-mode body must use `credentialRef`:

```json
{
  "source": "confluence",
  "url": "https://confluence.example.com",
  "credentialRef": { "source": "confluence", "label": "default" },
  "rules": [],
  "taskId": "task-1",
  "taskName": "MMF Confluence"
}
```

Do not send plaintext `apiKey` in server mode. Backend resolves vault credential and writes output into:

```text
${STATE_DIR}/staging/<taskId>
```

### Test Connection

`POST /api/knowledge-base/test-connection`

Headers: `X-CSRF-Token`.

Server-mode body:

```json
{
  "source": "confluence",
  "url": "https://confluence.example.com",
  "credentialRef": { "source": "confluence", "label": "default" }
}
```

### Open Folder

`POST /api/knowledge-base/open-folder`

- Local mode: existing behavior.
- Server mode: always 404. Frontend should hide this action.

## Agent Admin BFF

Frontend calls:

```text
/api/agent-admin/<agent-admin-path>
```

Backend proxies to:

```text
${AGENT_BASE_URL}/admin/api/<agent-admin-path>
```

It injects:

```http
Authorization: Bearer ${AGENT_ADMIN_TOKEN}
X-Acting-User: <username>
X-Acting-Role: <role>
```

RBAC:

- `GET /api/agent-admin/**`: viewer+
- `POST /api/agent-admin/kb/search-test`: viewer+
- skill/workflow/instruction/kb/access mutations: operator+
- `PATCH /api/agent-admin/settings`: superadmin
- `POST /api/agent-admin/backup*`: superadmin

All non-GET calls require `X-CSRF-Token`.

Example:

```ts
await fetch("/api/agent-admin/status");
await fetch("/api/agent-admin/skills/issue-investigator", {
  method: "PATCH",
  headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
  body: JSON.stringify({ enabled: true })
});
```

## Push To Agent KB

`POST /api/knowledge-base/push-to-agent`

Headers: `X-CSRF-Token`.

Body:

```json
{
  "taskId": "task-1",
  "source": "confluence",
  "pathPrefix": "02. Context/Confluence/MMF"
}
```

Current backend validates staging folder and path prefix, fetches agent manifest, and returns packaging readiness:

```json
{
  "status": "ready_to_package",
  "taskId": "task-1",
  "source": "confluence",
  "pathPrefix": "02. Context/Confluence/MMF",
  "fileCount": 42,
  "next": "package_delta_zip_and_post_/admin/api/kb/delta"
}
```

Frontend can wire the button and display readiness. Final multipart delta packaging is marked D5 because it depends on agent-side sync body limits.

## Frontend Page Mapping

- `/login`: calls `POST /api/auth/login`.
- `/change-password`: calls `POST /api/auth/change-password`.
- `/setup-2fa`: calls `setup-2fa/start`, renders QR from `otpauthUrl`, then calls `setup-2fa/verify`.
- `/accounts`: superadmin-only, uses `/api/accounts`, `/api/sessions?all=1`.
- `/credentials` or Settings tab: uses `/api/credentials`.
- Existing `/knowledge-base`: branch UI by `authMode`; in server mode hide API key/outputDir/Open Folder.
- `/agent-admin/**`: use BFF paths and role from `/api/me`.

## Error Shape

Common errors:

```json
{ "error": "unauthorized" }
{ "error": "forbidden" }
{ "error": "csrf" }
{ "error": "invalid_credentials" }
{ "error": "password_policy" }
{ "error": "agent_unreachable" }
```

Frontend should treat HTTP status as source of truth:

- 401 -> route to login.
- 403 -> show read-only/forbidden state.
- 423 -> account locked; show `lockedUntil` if present.
- 429 -> too many attempts.
- 5xx -> backend or upstream agent failure.
