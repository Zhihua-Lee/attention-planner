# Sync and the broker

The app syncs one file, `attention-planner-v3.json`, in the hidden app folder of your Google Drive. The browser never
holds a Google secret: the sync broker in `broker/` (the Cloudflare Worker `attention-planner-broker`) signs you in with
Google, keeps the refresh token encrypted in a Durable Object, and hands the app short-lived access tokens. It also sends
the push notifications (reminders, and a new AI proposal). The MCP Worker in `mcp/` gets its Google tokens from it too,
through a service binding.

The broker only answers its own origin: it is routed at `<host>/api/*`, checks that POSTs come from `PUBLIC_ORIGIN`, and
its session cookie is scoped to `/api` on that host. Only one Google account, `ALLOWED_EMAIL`, may sign in.

## Setting it up on your own host

1. Google Cloud console → an OAuth client of type "Web application", with the authorised redirect URI
   `https://<host>/api/google/callback`. The broker asks for `openid`, `email`, `drive.appdata` and `drive.file`.
2. In `broker/wrangler.jsonc`, set the route and `PUBLIC_ORIGIN`, `GOOGLE_REDIRECT_URI` and `VAPID_SUBJECT` to your host.
3. Set the secrets (`npx wrangler secret put <NAME> --config broker/wrangler.jsonc`):
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — from step 1;
   - `ALLOWED_EMAIL` — the one Google account that may use it;
   - `TOKEN_ENCRYPTION_KEY` — 32 random bytes, base64url;
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — from `npx web-push generate-vapid-keys`.
4. `npm run deploy:broker`, then deploy the app on the same host and open Settings → Sync and data → Connect.

For local work, copy `broker/.dev.vars.example` to `broker/.dev.vars` (never committed).

The Worker's name and its Durable Object classes (`UserVault`, `NotificationDevice`) must not change once it is in use:
the refresh token and the push devices live in them.

## What to check the first time

- After connecting, the cloud icon appears in the top bar; Settings shows "已同步 hh:mm".
- Add a task on one device, sync on another (focus the window or press "立即同步"); it appears.
- Edit different fields of the same task on two devices; both edits survive.
