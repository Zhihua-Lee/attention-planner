# Attention Planner sync broker

This Cloudflare Worker provides two existing services and an optional remote MCP interface for the personal PWA:

1. A server-side Google OAuth code flow. The refresh token is encrypted with AES-256-GCM before storage in a per-user Durable Object. The browser receives short-lived access tokens and calls Drive directly for ordinary PWA sync. This path does not upload task/calendar JSON to the Worker. `drive.appdata` covers the hidden task file; `drive.file` covers the private Outlook export created by the PWA.
2. Per-device Web Push scheduling. A Durable Object stores push subscriptions, opaque reminder IDs and fire times, not task titles, descriptions or calendar contents.
3. **Remote MCP, disabled by default.** `/api/mcp` exposes bounded task tools to separately authorized AI clients. The Worker fetches the application snapshot from Drive to validate and merge changes; this explicitly broadens the content-processing boundary. It does not persist a full snapshot. Operation records, including necessary task content and before/after previews, are application-encrypted in `McpWorkspace` and expire after seven days. Human approvals expire after 24 hours. The ordinary sync and push paths retain their existing boundaries.

The broker performs Google OAuth with PKCE and accepts only the exact `ALLOWED_EMAIL`. Its encrypted, HttpOnly, SameSite browser session lasts 180 days. Browser management/approval writes require same-origin and CSRF validation. MCP calls instead require audience-bound OAuth access tokens; browser cookies do not authorize MCP tool calls. Never give an AI client a Google token or browser session cookie.

Required secrets:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ALLOWED_EMAIL`
- `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64url encoded)
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Generate VAPID keys with `npx web-push generate-vapid-keys`. Generate the token encryption key with a cryptographically secure 32-byte random value. Set production values with `wrangler secret put NAME`; do not add them to `wrangler.jsonc` or Git.

The Google OAuth Web client must allow this exact redirect URI:

`https://todo.onthat.top/api/google/callback`

The PWA build must set `VITE_SYNC_BROKER_URL=/api`.

## Remote MCP deployment status and prerequisites

The committed configuration has `MCP_ENABLED=false`. Source-level tests are not a deployed service or proof of real ChatGPT/Codex/Google Drive interoperability. Complete the [MCP setup and acceptance checklist](../../docs/attention-planner-mcp.md) before enabling it.

- Existing Google secrets and the single-account allowlist are reused; no broader Google Drive scopes are requested.
- Provision a dedicated Cloudflare KV namespace and bind it as **`OAUTH_KV`** before enabling MCP. No production namespace ID is committed. The OAuth provider stores its client/grant/token state there.
- Keep the **`MCP_WORKSPACES` → `McpWorkspace`** Durable Object binding and **`v2-mcp`** SQLite migration. Do not remove or rename an already-applied migration when disabling MCP.
- Route both `todo.onthat.top/api/*` and `todo.onthat.top/.well-known/oauth-*` to this Worker. `PUBLIC_ORIGIN` must match the HTTPS origin exactly.
- Deploy the corresponding PWA update to all active devices before enabling remote writes. Both clients and Worker require strong Drive ETags for `If-Match` conditional updates and reject ambiguous duplicate task files. Old PWA clients are not made safe by a server update alone.
- Disable quickly by setting `MCP_ENABLED=false` and redeploying. This stops MCP access; it does not undo already-applied task changes or erase encrypted records immediately.
- Configure edge rate limits/access protection for public OAuth registration and authorization routes before exposing the service. Available controls and pricing depend on the Cloudflare plan. The per-warm-Durable-Object limit of 60 calls/minute covers authenticated workspace traffic only; it does not protect public registration or replace edge abuse controls. Monitor request metadata without logging bodies or credentials.

## Tools and authorization

| Tool | Required scope | Effect |
| --- | --- | --- |
| `list_tasks`, `get_task` | `tasks:read` | Read latest uploaded task state; no attachments, settings or Outlook exports |
| `create_draft` | `tasks:read` baseline + `tasks:create` | Create a root Inbox task with optional body/checklist, using an idempotency key |
| `propose_change` | `tasks:read` + `tasks:propose` | Prepare content, hierarchy, dates, complete/reopen, soft-delete or planner-work-block edits; **no immediate mutation** |
| `get_operation` | Own grant and matching operation scopes | Inspect status; reconcile an uncertain write without replaying it |

Read permission is the required OAuth/resource baseline and is library-wide, not a per-task ACL. Create and proposal scopes are optional additions; there is no create-only authorization mode in v1. Field projections reduce returned data but do not prevent an authorized client from querying other tasks. Only the authenticated owner can accept a proposal at `/api/mcp/proposals/:id`; the MCP tool catalog contains no approval tool. Approval is bound to the preview and current task/container fingerprint. Stale previews must be regenerated. A Drive `409`/`412` is a conflict; a lost write response remains uncertain until reconciliation proves the expected effect. Do not retry uncertain writes with new idempotency keys.

Manage/revoke individual AI connections at `/api/mcp/connections`. Access tokens last 15 minutes; refresh tokens are configured for 30 days. Revocation is checked again at approval, but KV propagation is eventually consistent: do not promise instantaneous global revocation. Disable MCP when an immediate service-wide stop is required.

## Content and scheduling limits

- Cloudflare handles the full synchronized application snapshot transiently; AI providers receive selected tool results. Do not log bodies, snapshots or credentials. Worker observability is disabled in the committed configuration, which is not a guarantee about every infrastructure log.
- No read or write of `outlook-calendar.json`, no attachment download, no arbitrary Drive paths, no raw AppData patches, no permanent purge.
- Scheduling checks known task work blocks only. Each approval explicitly warns that Outlook and other external calendars have not been checked.
- Completion uses the shared core recurrence engine and previews any generated occurrence. The server runs in UTC; users must review timed recurrence dates, particularly around daylight-saving transitions.
- Independent children survive parent completion/deletion. Reopening does not silently delete the next recurring instance or reactivate cancelled work blocks.
- Record access expires seven days after creation; an hourly Durable Object alarm removes expired records. AI conversation retention is controlled separately by the chosen provider/account.

The legacy [`apps/mcp-server`](../mcp-server) remains a local SQLite/Mindwtr Cloud integration. It is not the new Google Drive PWA endpoint.
