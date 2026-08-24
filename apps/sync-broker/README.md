# Attention Planner sync broker

This Cloudflare Worker provides two narrowly scoped services for the public PWA:

1. A server-side Google OAuth code flow. The refresh token is encrypted with AES-256-GCM before it is stored in a per-user Durable Object. The browser receives only short-lived access tokens and calls Google Drive `appDataFolder` directly, so the Worker does not receive task JSON.
2. Per-device Web Push scheduling. A Durable Object stores the browser push subscription, opaque reminder IDs, and fire times. Titles, task IDs, descriptions, project names, and calendar data are never uploaded.

Every public request must pass Cloudflare Access. Configure Worker-level Access for the exact permitted account before adding secrets or routing production traffic.

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
