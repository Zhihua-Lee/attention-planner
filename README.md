# Attention Planner

A personal planning app that answers one question at a time: **what should I do now?**
It runs as an installable PWA at **[todo.onthat.top](https://todo.onthat.top)**, works offline, and syncs through your own Google Drive.

中文说明：[README_zh.md](./README_zh.md) · Full user guide: [中文使用手册](./docs/attention-planner-user-guide-zh.md)

> Attention Planner is a fork of [Mindwtr](https://github.com/dongdongbh/Mindwtr) by dongdongbh and remains under the [AGPL-3.0](./LICENSE). It keeps Mindwtr's local-first data model and sync engine, and replaces the GTD dashboard with a small planning workflow. It is not an official Mindwtr release.

## The workflow

| Surface | What it is for |
| --- | --- |
| **NOW** | One suggestion for this moment: the meeting in progress, your chosen work, or a task that fits the time. Below it is the rest of today: timed appointments, your reserved work blocks, all-day events and what you chose for today. |
| **Inbox** | Write things down first; organizing and scheduling can wait. Choosing a day keeps a capture in the Inbox, and only reserving a time makes it Ready. |
| **Plan** | Day and calendar views. A task can hold several work blocks. A missed block is rescheduled into your planning windows around calendar constraints, and the deadline stays the same. |

## Features

- **Task pages edited in place:**
  - Like a Notion page, with no separate edit mode. The title, note, steps and properties save themselves after a pause, when you leave a field, or with **Ctrl/Cmd+S**.
  - A header **Undo** reverts the page's saved changes one by one.
  - If another device changed the same text meanwhile, you choose which version to keep.
- **Checklists:**
  - Multi-line steps: Enter starts the next step, Shift+Enter adds a line break.
  - A step can refresh on a calendar schedule (for example every Tuesday and Thursday at 06:00), or a set time after the whole list is completed.
  - Each round keeps its own completion record; end dates are inclusive, and missed rounds never pile up.
- **Task links:** a task can point at any other task, in any project or area, and flat lists show the two together. There are no nested subtasks; steps are checklists.
- **Calendars:** Outlook is read-only, either through Microsoft Graph or through a Power Automate export to a private Google Drive file. The export suits school tenants that block app consent.
- **Reminders:** Web Push, including iPhone home-screen installs (iOS 16.4+).
- **AI access (optional, off by default):** a remote MCP endpoint for ChatGPT and Codex. New drafts go to the Inbox; any change to existing data needs the owner's approval in the browser.

## Getting started

### Online and sync

1. Open [todo.onthat.top](https://todo.onthat.top). Without sync, data stays in this browser's local storage.
2. Go to **Settings → Sync**, choose **Google Drive** and connect your account.
3. Once it shows long-term authorization, short-lived tokens refresh on their own. The app syncs when it starts, when it returns to the foreground, when data changes, and when you press **Sync now**.
4. Tasks are stored in Google Drive's hidden `appDataFolder/attention-planner-v2.json`, which does not appear among your normal files. Your browser reads and writes it directly.

Google Drive sync and the Outlook calendar are separate connections, so you can use a personal Google account and a school Microsoft account. Long-term authorization means you rarely sign in again. It does not mean iOS keeps the PWA running in the background.

### Install on iPhone

This needs iOS/iPadOS 16.4 or later and must be done in Safari.

1. Open [todo.onthat.top](https://todo.onthat.top) in Safari.
2. Tap **Share → Add to Home Screen** and keep the name **Attention Planner**.
3. Open the app from the new icon, then connect Google Drive under **Settings → Sync**.
4. For reminders, open **Settings → Notifications** in the home-screen app, turn on notifications and iPhone background push, allow system notifications, then send a test notification. Do this once per device.

With the PWA closed, the server can still deliver visible reminders. However, iOS does not let silent pushes wake the app, and it does not run background work the way a native app can.

### Outlook calendar

If your school tenant blocks Microsoft Graph app consent, use **Power Automate → private Google Drive → PWA**, which needs no Premium license:

1. Connect Google Drive under **Settings → Sync**. The connection can only reach the hidden task data and files this app created or you opened with it; it cannot browse your whole Drive.
2. Under **Settings → Integrations → Outlook → Google Drive**, choose **Prepare private export file** to create a private `outlook-calendar.json`.
3. In Power Automate, build a scheduled cloud flow: Recurrence → `Get calendar view of events (V3)` → `Select` → Google Drive `Update file`.
4. Run it every 30 minutes over the past 30 and next 365 days, and export only `id`, `title`, `start`, `end`, `location` and `allDay`.

Field mapping, verification and safety boundaries are in the [Outlook → Google Drive export guide](./docs/outlook-google-drive-export.md).

If your tenant allows it, you can instead use Microsoft Graph directly:

1. Register a single-page app in Microsoft Entra, with the redirect URI `https://todo.onthat.top/redirect` and only the delegated `Calendars.Read` permission.
2. Enter its client ID under **Settings → Integrations → Microsoft Outlook (read-only calendar)**. Single-tenant apps also need the tenant ID.

Both options are read-only; tasks are never written to Outlook.

### Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Save current changes (anywhere) | Ctrl/Cmd+S |
| Undo the last change on a task page (outside text fields) | Ctrl/Cmd+Z |
| Checklist: next step / line break inside a step | Enter / Shift+Enter |
| Checklist: delete an empty step / move between steps / reorder | Backspace / ↑↓ / Alt+↑↓ |

## Current limits

- **Google Drive:** live, with long-term authorization and sync verified in production.
- **Outlook:** read-only. Writing tasks to Outlook and two-way sync are not implemented.
- **iPhone:** installable, works offline and receives Web Push. You grant and test push permission on each device.
- **Remote MCP:** implemented but disabled by default (`MCP_ENABLED=false`); deploying the Worker does not enable it. See the [remote MCP guide](./docs/attention-planner-mcp.md).
- **Data paths:** ordinary authorization and push never upload task content. With remote MCP enabled, the Cloudflare Worker processes app data during each request and stores encrypted change previews, and the AI provider receives whatever the tools return. See the [privacy notes](./docs/PRIVACY.md).

## Documentation

| Document | Contents |
| --- | --- |
| [User guide (中文)](./docs/attention-planner-user-guide-zh.md) | Everyday use, installation, sync, reminders, shortcuts |
| [Product model](./docs/product-model.md) | The concepts the code is built on: statuses, dates, plans, links |
| [Design principles](./DESIGN.md) | UI direction and trade-offs |
| [Checklist refresh](./docs/checklist-refresh.md) | Calendar and after-completion rounds, end dates, sync |
| [Remote MCP](./docs/attention-planner-mcp.md) | Enabling AI access, permissions, approval flow |
| [Deployment notes](./docs/attention-planner-alpha.md) | Hosting, security headers, build and deploy |
| [Privacy](./docs/PRIVACY.md) · [Security](./SECURITY.md) · [Changelog](./CHANGELOG.md) | |

## Development

Requires [Bun](https://bun.sh) 1.3.5 (see `.bun-version`).

```bash
bun install --frozen-lockfile
```

```bash
bun desktop:web
```

Then open <http://localhost:5173>.

| Task | Command |
| --- | --- |
| Unit tests (core / PWA) | `bun run --filter @mindwtr/core test` / `bun run --filter mindwtr test` |
| Type check (PWA) | `bun run typecheck:desktop` |
| End-to-end tests | `bun run test:e2e` |
| Production build | `bun run desktop:web:build` (output: `apps/desktop/dist`) |

Repository layout:
- `apps/desktop` is the PWA that runs at todo.onthat.top.
- `apps/sync-broker` is the Cloudflare Worker for Google OAuth, Web Push and the optional remote MCP.
- `packages/core` holds the shared domain logic.
- `e2e` holds the Playwright tests.

These parts come from Mindwtr and are not maintained or deployed by this fork:
- `apps/mobile`, `apps/cloud` and `apps/mcp-server`
- the native desktop packaging and store metadata
- `wiki/` and `docs/release-notes/`
- the release workflows

They are kept so shared code keeps building and upstream changes stay easy to compare.

CI runs the full suite on every pull request to `main`. Deployment is manual: the PWA goes to Cloudflare Pages, and the Worker is deployed separately. See the [deployment notes](./docs/attention-planner-alpha.md) and [`apps/sync-broker`](./apps/sync-broker/README.md).

## License and credits

Attention Planner is built on [Mindwtr](https://github.com/dongdongbh/Mindwtr) (upstream baseline v1.1.5), created by dongdongbh and its contributors. It is licensed under the [GNU Affero General Public License v3.0](./LICENSE). Because the app is offered over a network, its complete source is this repository.
