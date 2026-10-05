# Development

## Stack

TypeScript, React 19, Vite 8 and `vite-plugin-pwa`. Motion for the few animations that help you keep your place.
`marked` + DOMPurify render notes. Tests: Vitest for the model, Playwright for the interface. No server code here; sync
goes to Google Drive through the existing sync broker.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (model, parsing, import, sync)
npm run test:ui      # builds, serves on :4173 and runs Playwright: desktop, phone and reduced-motion
npm run build        # PWA in dist/
npm run format       # Prettier
npm run notices      # regenerate THIRD-PARTY-NOTICES.txt
npm run icons        # render PNG icons from public/icon.svg
```

On a machine that already has a Playwright Chromium build, set `PW_CHROMIUM` to its `chrome` executable to avoid a
download. Run UI tests with one worker locally (`--workers=1`, the default outside CI); the full run is about two
minutes.

## Layout

```
src/model/        pure logic, no browser APIs
  types.ts        the document: tasks, plan entries, steps, rounds, areas, projects, settings
  doc.ts          every change (stamped), round logic, undo by restore
  repeat.ts       calendar and after-completion rules, rounds, next copy
  derive.ts       NOW candidates, free time, capacity check, list order, agenda
  parse.ts        one-line capture parsing (Chinese and English)
  merge.ts        sync merge: per field, child records by id, tombstones
  legacyImport.ts import from the previous app's JSON
  ics.ts          .ics import with simple repeats
src/store/        IndexedDB storage, the app store (undo, autosave, autosync), sync engine, Google Drive remote
src/ui/           React components
functions/        Pages Functions (`/ics`: calendar subscriptions)
mcp/              the MCP Worker (`/api/mcp`, `/api/ai/*`): OAuth for AI clients, tools, review pages
tests/            unit tests outside src (the `/ics` function, the MCP tools)
e2e/              Playwright specs
```

## Data and sync

The whole document is one JSON value. Every change goes through `store.commit`, which runs a pure function from
`doc.ts`. Each change gets a stamp `{rev, at, by}`: `rev` is a Lamport counter, so later edits always win over what a
device had seen. Scalar task fields carry their own stamp (`fs`), so editing the title on one device and the deadline
on another keeps both. Plan entries, steps and finished rounds merge by id. Deletes are tombstones, purged after 90
days.

Undo writes the earlier values back as new, stamped edits, so an undo syncs like any other change.

Sync reads the remote copy, merges, and writes back only when the remote is missing something, using the file's ETag
so a concurrent writer causes a retry instead of a lost update. The Drive file is `attention-planner-v3.json` in the
app-data folder; the previous app's file is never touched. Calendar events imported from `.ics` stay on the device.

## MCP Worker

`mcp/` is a separate Cloudflare Worker (`attention-planner-mcp`) on the app's domain. It owns only `/api/mcp`,
`/api/ai/*` and the two `/.well-known/oauth-*` metadata paths; the rest of `/api` stays with the sync broker.

- **OAuth**: `@cloudflare/workers-oauth-provider` (dynamic registration, client metadata documents, PKCE), state in
  the KV namespace `OAUTH_KV`. The consent page (`/api/ai/authorize`) needs the broker's session cookie; the grant keeps
  that cookie (encrypted with the token) so the Worker can ask the broker for Google tokens through a service binding.
  The broker is not changed.
- **Data**: the same Drive file as the app, read and written with `src/store/drive.ts` and changed with the functions
  in `src/model/doc.ts`, stamped `by: ai`. Writes are conditional and retried. The Worker runs in UTC, so `mcp/src/clock.ts`
  runs edits on the owner's wall clock (`TIME_ZONE`) and swaps the real instant into the saved timestamps.
- **Changes**: new tasks are saved at once; `propose_changes` stores a proposal in KV, and the owner applies or rejects it
  at `/api/ai/review/<id>` (same-origin POST with a per-proposal nonce).
- `npm run typecheck` also checks `mcp/` against the Workers types; `tests/mcp.test.ts` runs the tools against an
  in-memory Drive. Deploy with `npm run deploy:mcp` after CI passes.

## Releasing

1. Update `version` in `package.json`, `CHANGELOG.md`, and add `docs/verification/vX.Y.Z.md` plus a row in
   `VERIFICATION.md`.
2. Push to `main`; CI runs formatting, types, unit tests, notices, build and the UI tests.
3. After CI passes, `npm run build` and `npm run deploy` (Cloudflare Pages project `attention-planner-next`, which
   serves todo.onthat.top). Use the Wrangler installed here: it also bundles `functions/` (the `/ics` calendar
   function).
