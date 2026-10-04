# Turning on sync

The app syncs through the existing sync broker (the `attention-planner-broker` Cloudflare Worker). The broker keeps the
Google refresh token and hands out short-lived access tokens. It only answers requests from its own origin: it is routed
at `todo.onthat.top/api/*`, checks that POSTs come from `https://todo.onthat.top`, and its session cookie is scoped to
`/api` on that host.

So the new app can sync wherever it is served on a host that the broker is routed to. The new app writes its own file,
`attention-planner-v3.json`; the previous app's `attention-planner-v2.json` is never written.

## Option A: when the new app replaces the old one (no broker change)

1. In Cloudflare Pages, remove the custom domain `todo.onthat.top` from the `attention-planner` project and add it to
   `attention-planner-next`.
2. Open https://todo.onthat.top, Settings → Sync → keep `/api` → Connect. If the browser is not signed in to the broker,
   it goes through the broker's Google sign-in and comes back.
3. Settings → Data → Import from the previous app, with a JSON export taken from the old app first.

Rollback: move the domain back to `attention-planner`.

## Option B: test sync before switching, on `next.onthat.top`

This changes the live broker, which the old app also uses, so do it deliberately.

1. Pages → `attention-planner-next` → Custom domains → add `next.onthat.top`.
2. Broker (`apps/sync-broker` in the legacy repository):
   - `wrangler.jsonc` → add a route `{ "pattern": "next.onthat.top/api/*", "zone_name": "onthat.top" }`.
   - Accept both origins: make `assertSameOrigin` compare against a list (for example a new `PUBLIC_ORIGINS` var,
     `"https://todo.onthat.top,https://next.onthat.top"`), and build the OAuth redirect URI from the request's host
     instead of the fixed `GOOGLE_REDIRECT_URI`.
   - Run its tests, then `wrangler deploy`.
3. Google Cloud console → the OAuth client → add the authorised redirect URI
   `https://next.onthat.top/api/google/callback`.
4. Open https://next.onthat.top → Settings → Sync → Connect.

## What to check the first time

- After connecting, the cloud icon appears in the top bar; Settings shows "已同步 hh:mm".
- Add a task on one device, sync on another (focus the window or press "立即同步"); it appears.
- Edit different fields of the same task on two devices; both edits survive.
