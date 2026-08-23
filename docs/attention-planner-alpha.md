# Attention Planner Alpha

## Working location

- Repository: `D:\code\attention-planner`
- Branch: `codex/attention-planner-alpha`
- Upstream baseline: Mindwtr `v1.1.5` (`2dcc77d28200d74190088cabdcd1615aa0c10528`)
- Portable Bun: `D:\code\toolchains\bun-1.3.5\bun-windows-x64\bun.exe`
- Bun cache: `D:\code\.cache\bun`
- Production PWA output: `D:\code\attention-planner\apps\desktop\dist`

The repository, dependencies, caches, and build output stay on D:. The existing Codex Node runtime on C: is only used as an executable and does not hold project data.

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

## Microsoft Entra setup

1. Register an application in Microsoft Entra ID.
2. Under **Authentication**, add a **Single-page application (SPA)** redirect URI matching the exact deployed PWA origin/path shown in Settings → Integrations → Microsoft Outlook.
3. Under **API permissions**, add Microsoft Graph delegated `Calendars.Read`.
4. Do not create or paste a client secret; a browser SPA must use authorization code + PKCE.
5. Enter the application client ID and either the school tenant ID/domain or `common`, save, enable the integration, and choose **Connect Microsoft**.

School policy may require administrator consent. That tenant-side decision cannot be bypassed by the app.

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
```

The production PWA can be served from `apps/desktop/dist` by any HTTPS static host with SPA fallback to `index.html`.

## Validation snapshot

- Core typecheck: passed.
- Desktop/PWA typecheck: passed.
- Production PWA build: passed.
- NOW/Agenda + Outlook focused Vitest: 52 passed.
- Frame + settings sync tests: 49 passed.
- Cross-platform schema guard: 8 passed.
- Full desktop/PWA suite: 1,439 passed.
- Browser acceptance: desktop and 390 × 844 mobile layouts passed; Frame survived reload; no console errors.
- Full core suite: 1,955 passed, 4 skipped, 1 known upstream date-sensitive failure in `store.test.ts:2299`. The same failure existed on the unmodified baseline because its April 2026 tombstone has expired by the current August 2026 date.

## Alpha boundaries

- Live Outlook authorization still requires a real Entra client ID and any school-admin consent.
- OAuth login is enabled for Web/PWA. The Tauri desktop shell shows a deliberate Alpha notice instead of attempting an unreliable embedded popup flow.
- Native Windows packaging was not attempted on this machine because the Rust/MSVC toolchain is not installed; the tested Windows delivery is the installable PWA.
- The current PWA data adapter remains upstream Mindwtr local storage. Existing Mindwtr sync can carry data across devices, but a future storage hardening milestone should move the browser adapter to IndexedDB/OPFS before treating it as a high-volume long-term store.
