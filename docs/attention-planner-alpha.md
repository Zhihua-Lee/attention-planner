# Attention Planner Alpha

## Source of truth

- Repository: `https://github.com/Zhihua-Lee/attention-planner`
- Upstream baseline: Mindwtr `v1.1.5` (`2dcc77d28200d74190088cabdcd1615aa0c10528`)
- GitHub is the version and deployment source of truth. A permanent local project checkout is not required; temporary build checkouts should be removed after verification.

## Live PWA deployment

- Production URL: `https://todo.onthat.top/`
- Cloudflare Pages project: `attention-planner`
- Fallback hostname: `https://attention-planner.pages.dev/`
- Hosting model: static PWA shell only; task data is not stored in Cloudflare Pages.
- Response hardening: CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, no-referrer, restricted browser permissions, and search-engine noindex headers.
- `index.html` and the service worker are served with revalidation so a new deployment can replace the installed shell without changing the stable custom-domain browser storage origin.

The custom domain and HTTPS certificate are active. A live HEAD request returned HTTP 200 with the expected security headers on 2026-08-23.

## Delivered vertical slice

### NOW

The top card in Agenda resolves one immediate item in this order:

1. A calendar event happening now.
2. A task whose scheduled start window includes now.
3. A task explicitly focused today.
4. A next action matching the active flexible Frame, preferring work that fits the time remaining.
5. A deterministic next action fallback.

Task actions include Done, Later (30 minutes), and Show another. All-day calendar events are intentionally excluded from NOW.

### Flexible Frames

Frames define a name, start/end time, weekday preset, and an optional `@context` or `#tag`. They may cross midnight, can be toggled or deleted, and are sanitized before use.

Frames are stored in `settings.gtd.attentionFrames` and included in the existing GTD settings sync allowlist, so they travel through Mindwtr's existing cross-device synchronization instead of creating a second data system.

### Outlook read-only calendar

The Integrations page now includes a Microsoft Outlook section using MSAL browser OAuth with PKCE and delegated `Calendars.Read` only. No client secret is used.

- OAuth token cache: browser session storage only.
- Local non-secret configuration: browser local storage.
- Graph API: `/me/calendarView/delta`.
- Delta pages and deletions are applied to a per-account, per-range session cache.
- Graph dates are requested in UTC and mapped into the existing external-calendar event model.
- Outlook events appear in both the existing calendar surfaces and NOW selection.
- A stale delta token (`410`) automatically falls back to a fresh initial sync.

### Google Drive private sync and Outlook export bridge

The Web/PWA Sync page includes a Google Drive provider using a single-account server-side OAuth code flow with PKCE. It requests `drive.appdata` for hidden task data and `drive.file` for the one ordinary Outlook export file created by the PWA.

- Remote data file: `appDataFolder/data.json`, a hidden area that only Attention Planner can access.
- Ordinary export file: `My Drive/outlook-calendar.json`, private by default. With `drive.file`, the PWA can access files it created or the user explicitly opened, but cannot browse all of Drive.
- Power Automate can update this file with the minimal fields `id`, `title`, `start`, `end`, `location`, and `allDay`. It intentionally omits body, attendees, meeting links, and organizer.
- Cloudflare does not receive task/calendar data or short-lived access tokens; the browser communicates directly with Google Drive over HTTPS.
- The refresh token is encrypted at the application layer in a per-user Cloudflare Durable Object. Browser access tokens remain in session storage/in memory and expire after roughly one hour.
- Writes compare Google Drive file versions and use the remote ETag when available so concurrent changes become sync conflicts rather than silent overwrites.
- Binary attachment synchronization is not part of this alpha; the main task/project/settings JSON is synchronized.

The production Google OAuth web client authorizes only `https://todo.onthat.top`, is in testing mode, and has one explicitly listed test user. Two consecutive live syncs completed successfully on 2026-08-23 with zero conflicts, confirming initial creation and subsequent read/update of the remote `data.json`.

### OneDrive personal sync (experimental)

The Web/PWA Sync page now includes a OneDrive provider implemented with MSAL browser OAuth, PKCE, and delegated `Files.ReadWrite.AppFolder` only. The permission is scoped to the app's private OneDrive application folder and is supported for personal Microsoft accounts.

- Remote data file: the app folder's `data.json`.
- Cloudflare does not receive task data or Microsoft tokens; the browser communicates directly with Microsoft Graph over HTTPS.
- Graph downloads use Microsoft's short-lived pre-authenticated download URL without forwarding the bearer token to that URL.
- Writes use the remote eTag as an optimistic concurrency guard. A concurrent remote change becomes a normal sync conflict instead of silently overwriting another device.
- The exact connected personal account ID is stored separately from the exact connected Outlook school account ID, so MSAL cannot silently swap the two accounts.
- Local OAuth caches and non-secret client configuration remain isolated by the stable `todo.onthat.top` origin.
- Binary attachment synchronization is not part of this OneDrive alpha; the main task/project/settings JSON is synchronized.

Live validation currently returns `OneDriveGraphError: Access denied` from Microsoft Graph for the personal account even though the Entra registration and delegated AppFolder permission are present. No OneDrive data was created or overwritten. Google Drive `appDataFolder` is therefore the working production sync path.

## Google Cloud setup

1. Enable the Google Drive API in a Google Cloud project.
2. Configure Google Auth Platform for an external audience. Testing mode is sufficient for a personal deployment.
3. Add the intended Google account as a test user.
4. Create an OAuth client of type **Web application** with authorized JavaScript origin `https://todo.onthat.top`. No redirect URI or client secret is required for the GIS token model.
5. Under **Data access**, select `https://www.googleapis.com/auth/drive.appdata` and `https://www.googleapis.com/auth/drive.file`. The latter is limited to files created by the app or explicitly opened by the user; do not request full-drive scope for the PWA.
6. Build with `VITE_GOOGLE_CLIENT_ID` set to the public OAuth client ID, or enter the client ID in Settings -> Sync -> Google Drive.
7. Connect the listed test account, test the connection, and run the first sync.

## Microsoft Entra setup

1. Register an application in a Microsoft Entra tenant where the user can create app registrations.
2. Choose **Accounts in any organizational directory and personal Microsoft accounts** so the same public client can authorize personal OneDrive and the separate school Outlook account.
3. Under **Authentication**, add the Single-page application (SPA) redirect URI `https://todo.onthat.top/`.
4. Under **API permissions**, add Microsoft Graph delegated `Files.ReadWrite.AppFolder` and `Calendars.Read`.
5. Keep public client/SPA authorization-code flow with PKCE; do not create or paste a client secret.
6. In Settings → Sync, select OneDrive, enter the application client ID with tenant `common`, save, then connect the personal Microsoft account.
7. In Settings → Integrations → Microsoft Outlook, enter the same application client ID with tenant `common`, save, enable the integration, then connect the school account.

School policy may require administrator consent. That tenant-side decision cannot be bypassed by the app.

A personal Entra application registration is now available. The remaining Microsoft blockers are the personal OneDrive Graph AppFolder `Access denied` response and possible school-admin consent for the University of Iowa Outlook account.

For the local production preview used during development, the redirect URI is `http://127.0.0.1:4174/`. A deployed HTTPS URL must be registered separately.

## Run and verify

From `D:\code\attention-planner` with Bun available on `PATH`:

```powershell
bun install --frozen-lockfile
bun run desktop:web
bun run desktop:web:build
```

Useful focused checks:

```powershell
bun test packages/core/src/attention-frames.test.ts packages/core/src/sync-helpers.test.ts packages/core/src/sync-merge-settings.test.ts
bun test apps/desktop/src/lib/outlook-calendar.test.ts
bun test packages/core/src/sync-backend-google-drive.test.ts packages/core/src/sync-client-helpers.test.ts packages/core/src/sync-service-utils.test.ts
bun test apps/desktop/src/lib/google-drive-sync.test.ts apps/desktop/src/lib/desktop-auto-sync-eligibility.test.ts apps/desktop/src/components/views/settings/sync/SyncConfigurationSection.test.tsx apps/desktop/src/security-headers.test.ts
```

The production PWA can be served from `apps/desktop/dist` by any HTTPS static host with SPA fallback to `index.html`.

## Validation snapshot

- Core typecheck: passed.
- Desktop/PWA typecheck: passed.
- Production PWA build: passed.
- Google Drive transport, token-storage, settings, auto-sync, provider, and security focused tests: 42 passed.
- Google Drive live connection test: passed; `appDataFolder` reachable.
- Google Drive live round trip: two consecutive syncs passed with 0 conflicts.
- Live Cloudflare response: HTTP 200 with GIS-compatible CSP, popup-compatible COOP, frame denial, nosniff, no-referrer, restricted permissions, and noindex.
- OneDrive transport, eTag conflict, account-isolation, auto-sync, and settings focused tests: 18 passed.
- NOW/Agenda + Outlook focused Vitest: 52 passed.
- Frame + settings sync tests: 49 passed.
- Cross-platform schema guard: 8 passed.
- Full desktop/PWA suite: 1,439 passed.
- Browser acceptance: desktop and 390 × 844 mobile layouts passed; Frame survived reload; no console errors.
- Full core suite: 1,955 passed, 4 skipped, 1 known upstream date-sensitive failure in `store.test.ts:2299`. The same failure existed on the unmodified baseline because its April 2026 tombstone has expired by the current August 2026 date.

## Alpha boundaries

- Google Drive synchronization is the validated Web/PWA path. Its browser access token expires after roughly one hour, so the user may need to press **Connect Google Drive** again before later syncs.
- OneDrive remains blocked by a live Microsoft Graph AppFolder `Access denied` response. Outlook still requires live validation with the school account and may require school-admin consent.
- OAuth login is enabled for Web/PWA. The Tauri desktop shell shows a deliberate Alpha notice instead of attempting an unreliable embedded popup flow.
- Native Windows packaging was not attempted on this machine because the Rust/MSVC toolchain is not installed; the tested Windows delivery is the installable PWA.
- The current PWA data adapter remains upstream Mindwtr local storage. Existing Mindwtr sync can carry data across devices, but a future storage hardening milestone should move the browser adapter to IndexedDB/OPFS before treating it as a high-volume long-term store.
