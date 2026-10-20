# Attention Planner

<!-- Stable facts only. Current state lives in the handoff (see Project context). Keep this file under ~80 lines. -->

## Purpose

A to-do list that plans itself (PWA at todo.onthat.top), with an MCP server so AI assistants can read the list and
propose changes the owner approves in the app. One owner's data, synced through their own Google Drive.

## Layout

- `src/model/`: plain functions over one JSON document (tasks, steps, plans, rounds, areas, settings); all logic.
- `src/ui/`: React views; `src/store/`: device storage, Drive sync, Outlook export reading.
- `mcp/`: Cloudflare Worker for `/api/mcp` and `/api/ai/*` (tools in `mcp/src/tools.ts`, change schema in
  `mcp/src/changes.ts`, which must agree with `src/model/changes.ts`).
- `broker/`: Cloudflare Worker for `/api/*` (Google sign-in, tokens, push).
- `functions/`: Pages Functions (`/ics` proxy, `/assets` cache guard).
- `tests/`, `src/**/*.test.ts`: Vitest; `e2e/`: Playwright on desktop, phone and reduced motion.
- `docs/`: user guide, how the parts interact, design, AI connections, Outlook setup (Chinese first).

## Conventions

- Work on `main`; push straight to it. Deploy only after CI on `main` passes, from a clean tree.
- Every change ships with tests (unit for the model, e2e for the UI) and updates the docs it touches (README in both
  languages, `docs/user-guide.md`, `docs/interactions.md`, `docs/ai-connections.md` as relevant) and `CHANGELOG.md`;
  bump `package.json` version per release.
- UI copy: short labels; explanations go behind an ⓘ in plain words. Chinese first, English beside it via `t()`.
- Docs plain and direct; no defensive writing.
- Changes made by an AI are proposals the owner approves; keep the MCP schema and the model's `Change` type in step.
- Prettier formats everything (`npx prettier --check .`).

## Commands

- Dev: `npm run dev`
- Check: `npx prettier --check .`, `npx tsc -b`, `npx tsc -p mcp/tsconfig.json`, `npx tsc -p broker/tsconfig.json`,
  `npx vitest run`, `npm run build` then `npm run test:ui` (Playwright against `vite preview --port 4173`)
- Deploy (after CI): `npx wrangler pages deploy dist --project-name attention-planner-next --branch main
--commit-hash <sha>`; Workers: `npx wrangler deploy --config mcp/wrangler.jsonc` (and `broker/wrangler.jsonc`)
- After a Pages deploy, verify on the `*.pages.dev` URL; on todo.onthat.top read only `index.html` at first (a new
  `/assets/*` fetched there too early can be cached wrongly).

## Sensitive data

- The owner's tasks live in their Google Drive app folder and on their devices, never in this repository. Do not copy
  task contents, calendar events or account details into commits, tests or notes; tests use made-up examples.

## Project context

Working notes for agents (`HANDOFF.md`: current state and next steps; `decisions.md`: dated decisions) are in `.ai/` here, or kept outside this repository by the owner's tooling.

- Before starting, read the handoff (`.ai/HANDOFF.md` if present; otherwise a session-start hook loads it). If it disagrees with the files, trust the files and correct the handoff.
- Before ending substantial work, rewrite the handoff (under about 60 lines) and append lasting decisions, dated, to `decisions.md` next to it. Then tell the user the full path of each file written.
- Never write secrets or personal data about other people into these notes; point to where such data lives.
