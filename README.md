> [!NOTE]
> This repository hosts the **Attention Planner** personal PWA fork at [todo.onthat.top](https://todo.onthat.top). It adds attention frames and NOW selection, Google Drive synchronization, read-only Outlook calendar adapters, a single-account Google-authenticated long-lived OAuth broker, and privacy-preserving Web Push reminders. See the public [privacy policy](https://todo.onthat.top/privacy.html) and [`apps/sync-broker`](./apps/sync-broker) for the server design. Task and exported calendar JSON travel directly between the PWA and Google Drive; the broker stores no task or calendar content.
>
> 本仓库是 **Attention Planner** 个人 PWA 分支。上游项目为 [dongdongbh/Mindwtr](https://github.com/dongdongbh/Mindwtr)，本分支继续采用 AGPL-3.0。

## Attention Planner 快速开始

### 在线入口与数据同步

1. 打开 [todo.onthat.top](https://todo.onthat.top)。应用可以离线使用，未连接云端时数据只保存在当前浏览器的本地存储中。
2. 前往「设置 → 同步」，选择 **Google Drive** 并连接获准的 Google 账号。
3. 页面显示“已长期授权”后，短时访问令牌会自动刷新；应用启动、回到前台、数据变化或手动点击“立即同步”时会同步。
4. 任务数据写入 Google Drive 隐藏的 `appDataFolder`，不会出现在普通 Drive 文件列表中。PWA 直接读写任务 JSON，Cloudflare Worker 不接收任务标题、描述或笔记。

Google Drive 同步与 Outlook 日历是两套相互独立的连接，可以分别使用个人 Google 账号和学校 Microsoft 账号。长期授权表示通常不必反复手动登录，不表示 iOS 会允许 PWA 在后台持续运行。

### 在 iPhone 上安装

要求 iOS/iPadOS 16.4 或更新版本。必须使用 Safari 安装；仅在普通浏览器标签中打开并不等于已经安装 PWA。

1. 在 iPhone 的 Safari 中打开 [todo.onthat.top](https://todo.onthat.top)。
2. 点击底部的“分享”按钮。
3. 向下滚动并选择“添加到主屏幕”。
4. 名称保留为 **Attention Planner**，点击右上角“添加”。
5. 回到主屏幕，从新图标打开应用。
6. 进入「设置 → 同步」连接 Google Drive；首次使用可点击“立即同步”确认状态。

启用提醒：在主屏幕版本中进入「设置 → 通知」，先打开通知总开关，再启用“iPhone 后台推送”，允许系统通知，最后点击“发送测试通知”。每台设备都要单独启用一次。PWA 关闭后，服务器仍可发送可见提醒；iOS 不允许静默推送唤醒应用，也不保证像原生 App 一样执行任意后台任务。

### Outlook 日历同步

学校租户禁止 Microsoft Graph 应用授权时，正式方案使用 **Power Automate → 私人 Google Drive → PWA**，不需要 Premium：

1. 在「设置 → 同步」连接 Google Drive。该连接使用 `drive.appdata` 保存隐藏的任务数据，并使用 `drive.file` 访问仅由本应用创建或由你明确打开的普通 Drive 文件；它不能浏览整个云端硬盘。
2. 在「设置 → 集成 → Outlook → Google Drive」点击“准备私有导出文件”，创建普通“我的云端硬盘”中的私有 `outlook-calendar.json`。
3. 在 Power Automate 创建定时云端流：Recurrence → Office 365 Outlook `Get calendar view of events (V3)` → Data Operations `Select` → Google Drive `Update file`。
4. 查询建议为过去 30 天至未来 365 天，每 30 分钟运行一次。`Select` 只输出 `id`、`title`、`start`、`end`、`location`、`allDay`；开始/结束应使用带时区的输出。
5. `Update file` 选择 `outlook-calendar.json`，内容选择 `Select` 的输出。不要创建共享链接，也不要导出正文、参会者、会议链接或组织者。

PWA 在打开 Calendar、回到前台或手动刷新时从 Google Drive 直接读取该文件。Cloudflare Worker 只负责 Google OAuth 与短时令牌，不接收日历文件。Power Automate 的 Google Drive 连接由 Microsoft 管理，权限范围比 PWA 的 `drive.file` 更宽，因此该连接只应保留在受信任的个人账号并定期检查。

另有一个直接 Microsoft Graph 只读适配器：

当前已实现的是 **Microsoft Graph 只读同步**：使用最小的 delegated `Calendars.Read` 权限读取 Outlook 事件，通过 `calendarView/delta` 增量更新，并把会议显示在 Calendar 与 NOW 中。它目前不会把任务写入 Outlook，也不是双向同步。

连接步骤：

1. 在 Microsoft Entra 中注册一个“单页应用（SPA）”。
2. 添加重定向 URI：`https://todo.onthat.top/redirect`。
3. 只添加 Microsoft Graph delegated `Calendars.Read` 权限，不需要客户端密钥。
4. 在 Attention Planner 中打开「设置 → 集成 → Microsoft Outlook（日历只读）」，填写应用程序（客户端）ID；学校单租户应用还应填写租户 ID 或学校域名。
5. 保存配置、打开集成开关、点击“连接 Microsoft”，然后点击“立即同步”。

学校 Microsoft 365 租户可能禁止用户自行授权第三方应用。如果出现 `Need admin approval`，需要学校管理员批准；此时使用上面的 Power Automate 私有 Drive 导出方案。公开 ICS 可能把所有受保护事件显示成 `Private Appointment`，不适合作为正式来源。计划中的“将任务时间块写入独立 Outlook 日历”和有限双向修改尚未实现。

### 当前边界

- Google Drive：已部署并在线验证长期授权与同步。
- Outlook：支持直接 Graph 只读适配器，以及学校租户受限时的 Power Automate → 私人 Google Drive 只读导出；写入和双向同步未实现。
- iPhone：可安装 PWA、离线使用和接收 Web Push；实际推送权限必须在 iPhone 上由用户授予并逐设备测试。
- 源码与部署：GitHub 是版本真相；Cloudflare Pages 托管无数据的 PWA 静态壳，Worker 只处理登录、短时令牌和不含任务内容的提醒调度元数据。

<div align="center">

<img src="apps/mobile/assets/images/icon.png" width="120" alt="Mindwtr Logo">

# Mindwtr

English | [中文](./README_zh.md)

**Get everything out of your head.** Mindwtr is a free, open-source to-do app built on the Getting Things Done (GTD) method: it captures every task and idea in seconds, then shows you the one next thing to do. No account, no subscription, and your data stays on your device.

_Mindwtr = "mind like water": the calm you get when nothing is rattling around in your head._

[Getting Started](https://docs.mindwtr.app/start/getting-started) · [FAQ](https://docs.mindwtr.app/start/faq) · [Docs](https://docs.mindwtr.app/) · [Data & Sync](https://docs.mindwtr.app/data-sync/) · [Cloud Deployment](https://docs.mindwtr.app/data-sync/cloud-deployment) · [MCP Server](https://docs.mindwtr.app/power-users/mcp)

[![CI](https://github.com/dongdongbh/Mindwtr/actions/workflows/ci.yml/badge.svg)](https://github.com/dongdongbh/Mindwtr/actions/workflows/ci.yml)
[![GitHub license](https://img.shields.io/github/license/dongdongbh/Mindwtr?color=brightgreen)](LICENSE)
[![GitHub downloads](https://img.shields.io/github/downloads/dongdongbh/Mindwtr/total)](https://github.com/dongdongbh/Mindwtr/releases)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/dongdongbh/Mindwtr)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/gc4h5t58PR)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub-ff5f5f?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/dongdongbh)
[![Ko-fi](https://img.shields.io/badge/Sponsor-Ko--fi-29abe0?logo=kofi&logoColor=white)](https://ko-fi.com/D1D01T20WK)

<p align="center" style="text-align: center;">
  <a href="https://apps.microsoft.com/detail/9n0v5b0b6frx?ocid=webpdpshare" target="_blank">
    <img src="https://developer.microsoft.com/store/badges/images/English_get-it-from-MS.png"
         align="center"
         alt="Microsoft Store"
         style="height: 50px"
         height="50" />
  </a>
  <a href="https://play.google.com/store/apps/details?id=tech.dongdongbh.mindwtr" target="_blank">
    <img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png"
         align="center"
         alt="Google Play"
         style="height: 74px"
         height="74" />
  </a>
  <a href="https://apps.apple.com/app/mindwtr/id6758597144" target="_blank">
    <img src="https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us?size=250x83"
         align="center"
         alt="App Store"
         style="height: 50px"
         height="50" />
  </a>
  <a href="https://flathub.org/apps/tech.dongdongbh.mindwtr" target="_blank">
    <img alt="Get it on Flathub"
         src="https://flathub.org/api/badge?locale=en"
         align="center"
         style="height: 50px"
         height="50" />
  </a>
  <a href="https://apt.izzysoft.de/packages/tech.dongdongbh.mindwtr" target="_blank">
    <img src="https://gitlab.com/IzzyOnDroid/repo/-/raw/master/assets/IzzyOnDroid.png"
         align="center"
         alt="Get it at IzzyOnDroid"
         style="height: 74px"
         height="74" />
  </a>
  <a href="https://f-droid.org/en/packages/tech.dongdongbh.mindwtr/" target="_blank">
    <img src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png"
         align="center"
         alt="Get it on F-Droid"
         style="height: 74px"
         height="74" />
  </a>
  <a href="https://snapcraft.io/mindwtr" target="_blank">
    <img alt="Get it from the Snap Store"
         src="https://snapcraft.io/en/dark/install.svg"
         align="center"
         style="height: 50px"
         height="50" />
  </a>
</p>

</div>

<div align="center">
  <video src="https://github.com/user-attachments/assets/e62ac128-467d-4e2f-beb0-7fc3c947bfeb" width="60%" autoplay loop muted playsinline></video>
  
  <video src="https://github.com/user-attachments/assets/d6688a01-989f-41b9-b190-94b21b0ae821" width="25%" autoplay loop muted playsinline></video>

  <p>
    <i>Local-First GTD on Arch Linux & Android</i>
  </p>
</div>

## Sound familiar?

- **"I'll remember it." You won't.** One hotkey, type it, forget it safely. That's capture.
- **Your to-do list has 80 items, so you avoid it.** Focus shows only the few things you can do right now.
- **"Plan Mom's birthday" has been stuck for weeks.** Turn it into a project of small steps, so the next one is always obvious.
- **You asked a coworker for something and you both forgot.** Waiting For tracks it so you remember to follow up.
- **"Learn guitar someday" guilt-trips you from the list.** Park it in Someday/Maybe: kept, not nagging.
- **Sunday night, everything feels out of control.** A guided weekly review puts you back in charge.

## How it works

Your head is for having ideas, not for holding them (David Allen, who wrote the book on this). Mindwtr holds them for you:

1. **Dump it.** A task, an idea, a worry: type it (or speak it) and it lands in your Inbox. Global hotkey on desktop, widget and share sheet on your phone.
2. **Sort it.** A short guided pass over the Inbox. Takes two minutes? Do it now. Has a date? Schedule it. Waiting on someone else? Track it. Just a maybe? Shelve it for someday.
3. **Do it.** Open Focus and see only what you can act on right now. Everything else stays out of sight.
4. **Reset weekly.** A guided review catches loose ends, so the list stays trustworthy and your head stays clear.

If you know GTD: that is Capture, Clarify, Organize, Engage, and Reflect, end to end. If you don't, no problem: Mindwtr walks you through each step, and [GTD in 15 minutes](https://hamberg.no/gtd) is a friendly introduction whenever you're curious.

## Philosophy

**Don't show me a cockpit when I just want to ride a bike.**

Mindwtr is simple by default and powerful when you need it:

- Advanced options stay hidden until they matter.
- Fewer fields, fewer knobs, fewer distractions.
- Clarity beats clutter: we say no to feature creep.

## Features

- The full GTD loop, guided: capture, sort, do, review.
- Focus view puts today's schedule and your next actions on one screen.
- Your data lives on your device. Sync is optional, and you pick where: iCloud on Apple devices, Dropbox, a shared folder, your own server, or WebDAV.
- Projects with sections, areas, and manual task ordering for bigger plans.
- Import tasks from your Obsidian notes, with links back to the source (desktop).
- Optional AI helper: connect your own OpenAI, Gemini, or Claude account, or run a private AI on your own computer. Off by default.
- Apps for Windows, macOS, Linux, iPhone, and Android, plus a web app that works offline.
- For developers: a local REST API, a CLI, and the [`mindwtr-mcp`](https://www.npmjs.com/package/mindwtr-mcp) server so AI assistants can manage your tasks.

<details>
<summary>See all features</summary>

### GTD Workflow

- **Capture** - Quick add tasks from anywhere (global hotkey popup, tray, share sheet, voice)
- **Clarify** - Guided inbox processing with 2-minute rule
- **Organize** - Projects, sections, contexts, and status lists
- **Reflect** - Weekly review wizard with reminders
- **Engage** - Context-filtered next actions
- **AI Assist (Optional)** - Clarify, break down, and review with your own AI account (OpenAI, Gemini, Claude) or a local/self-hosted OpenAI-compatible model

### Views

- 📥 **Inbox** - Capture zone with processing wizard
- 🎯 **Focus** - Agenda (time-based) + Next Actions in one view
- 📁 **Projects** - Multi-step outcomes with sections, areas, and manual task ordering
- 🏷️ **Contexts** - Tag tasks by where or how you get them done; nested contexts like @work/meetings also match @work
- ⏳ **Waiting For** - Delegated items
- 💭 **Someday/Maybe** - Deferred ideas
- 📅 **Calendar** - Time-based planning with adjustable mobile week density
- 📋 **Board** - Kanban-style drag-and-drop
- 📝 **Review** - Daily + weekly review workflows
- 📦 **Archived** - Hidden history, searchable when needed

### Productivity Features

- 🔍 **Global Search** - Search all areas globally with operators (`status:`, `context:`, `assigned:`, `location:`, `where:`, `id:`, `-id:`, `due:<=7d`)
- 📦 **Bulk Actions** - Multi-select, batch move/tag/delete
- 📎 **Attachments** - Files and links on tasks
- ✏️ **Markdown Notes** - Rich text descriptions with preview
- 🗂️ **Project States** - Active, Waiting, Someday, Archived
- ♾️ **Fluid Recurrence** - Next date is calculated after completion
- ♻️ **Reusable Lists** - Duplicate tasks or reset checklists
- ✅ **Checklist Mode** - Fast list-style checking for checklist tasks
- ✅ **Audio Capture** - Quick voice capture with automatic transcription and task creation
- 🧭 **Copilot Suggestions** - Optional context/tag/time hints while typing
- 🍅 **Pomodoro Focus (Optional)** - 15/3, 25/5, 50/10 timer panel in Focus view with one optional custom preset
- 🔔 **Notifications** - Separate start and due reminders with snooze
- 📊 **Daily Digest** - Morning briefing + evening review
- 📅 **Weekly Review** - Customizable weekly reminder

### Data & Sync

- 🔄 **Sync Options** - See the [Data & Sync docs](https://docs.mindwtr.app/data-sync/) for supported backends and setup
- 🍎 **iCloud Sync** - Built-in sync on supported iPhone, iPad, and macOS builds (CloudKit)
- ☁️ **Dropbox Sync (Optional)** - Sign in with Dropbox and sync through a private app folder (store builds; not in FOSS builds)
- 📤 **Export/Backup** - Export data to JSON
- ♻️ **Restore from Backup** - Replace local data from a validated Mindwtr backup with a recovery snapshot first
- 📥 **TickTick + Todoist + DGT GTD + OmniFocus + Apple Reminders Import** - Import TickTick CSV/ZIP, Todoist CSV/ZIP, DGT GTD JSON/ZIP, OmniFocus exports, or incomplete Apple Reminders into Mindwtr
- 🔗 **Obsidian Integration** - Desktop vault task import with deep links back to source notes
- 🗓️ **External Calendars (System + ICS)** - Mobile reads system calendars and pushes dated tasks; macOS desktop reads Apple Calendar and can push dated tasks; desktop/web also support ICS subscriptions and task creation from events

### Automation

- 🔌 **CLI** - Add, list, complete, search from terminal by running the repo helper
- 🌐 **REST API** - Optional desktop localhost API server for token-authenticated scripting
- 🌍 **Web App** - Runs in your browser, works offline (PWA)
- 🧠 **MCP Server** - Lets AI assistants read and manage your tasks (a local Model Context Protocol server), available as [`mindwtr-mcp`](https://www.npmjs.com/package/mindwtr-mcp) and in the [MCP Registry](https://registry.modelcontextprotocol.io/)

Desktop builds can start the local REST API from **Settings -> Advanced** on `127.0.0.1` with default port `3456` and a generated bearer token. The CLI remains a repo helper; the stdio MCP server can be installed from npm with `npm install -g mindwtr-mcp` or launched by MCP clients with `npx -y mindwtr-mcp`.

### Cross-Platform

- 🖥️ **Desktop** - Tauri v2 (macOS, Linux, Windows)
- 📱 **Mobile** - React Native/Expo (iOS via App Store/TestFlight, Android) with in-app tips for gestures and app shortcuts
- 📲 **Android Widget** - Home screen focus/next widget
- ⌨️ **Keyboard Shortcuts** - Standard (Gmail-style), Vim, and Emacs presets
- 🎨 **Themes** - Light, Dark, OLED, Nord, Sepia, E-ink, and Material 3
- 🌍 **i18n** - English, Vietnamese, Chinese (Simplified), Chinese (Traditional), Spanish, Hindi, Arabic, German, Russian, Japanese, French, Portuguese, Polish, Korean, Czech, Italian, Turkish, Dutch
- 🐳 **Docker** - Run the PWA + self-hosted sync server with Docker

</details>

## Why Mindwtr (Quick Comparison)

Mindwtr is for people who want the full GTD method in one app, with data they own and no lock-in. Here is a brief, respectful comparison with mainstream task apps and GTD-focused alternatives.

| Capability                                                              | Mindwtr | Todoist | TickTick | Everdo | NirvanaHQ |
| ----------------------------------------------------------------------- | ------- | ------- | -------- | ------ | --------- |
| Open source                                                             | ✅      | ❌      | ❌       | ❌     | ❌        |
| Follows the full GTD method out of the box                              | ✅      | ⚠️      | ⚠️       | ✅     | ✅        |
| Works everywhere: Windows, Mac, Linux, iPhone, Android, web             | ✅      | ✅      | ✅       | ⚠️     | ⚠️        |
| Works offline, no account needed                                        | ✅      | ❌      | ❌       | ✅     | ❌        |
| Optional AI helper (your own AI account, or one on your computer)       | ✅      | ❌      | ❌       | ❌     | ❌        |
| You pick where your data syncs (Dropbox, your server, a folder, WebDAV) | ✅      | ❌      | ❌       | ⚠️     | ❌        |
| Completely free                                                         | ✅      | ❌      | ❌       | ❌     | ❌        |

Legend: `✅` = yes, `❌` = no, `⚠️` = partial/limited support.

_This comparison is based on the current public capabilities of each product. If any entry is outdated, feel free to open an issue or PR with sources._

## Installation

For the complete and current install guides, see [Desktop Installation](https://docs.mindwtr.app/start/desktop-installation) and [Mobile Installation](https://docs.mindwtr.app/start/mobile-installation).

Quick options:

- Windows: Microsoft Store, Winget, Chocolatey, Scoop, or GitHub Releases.
- macOS: Mac App Store, Homebrew, TestFlight beta, or GitHub Releases.
- Linux: Flathub, Snap, AUR, APT/RPM repos, or GitHub Releases.
- Android: Google Play, F-Droid, IzzyOnDroid, or GitHub Releases APK.
- iOS: App Store or TestFlight beta.
- Web / self-hosted: [Cloud Deployment](https://docs.mindwtr.app/data-sync/cloud-deployment) or the [Docker guide](docker/README.md).

<details>
<summary>Package manager quick commands</summary>

```bash
flatpak install flathub tech.dongdongbh.mindwtr
yay -S mindwtr-bin
brew install --cask mindwtr
```

```powershell
winget install dongdongbh.Mindwtr
```

For APT/RPM repo setup, source builds, portable ZIPs, mobile store variants, and Docker setup, use the full install guides above.

</details>

## Community

Mindwtr is shaped by its users and contributors. Thank you for helping improve it.

### :hearts: Contributing & Support

If you want to get involved for coding, start with [CONTRIBUTING.md](docs/CONTRIBUTING.md).

You can help in several ways:

1. **Spread the word:** Share Mindwtr with friends and communities, and support it on [Product Hunt](https://www.producthunt.com/products/mindwtr) and [AlternativeTo](https://alternativeto.net/software/mindwtr/).
2. **Leave store reviews:** A good rating/review on the [App Store](https://apps.apple.com/app/mindwtr/id6758597144), [Google Play](https://play.google.com/store/apps/details?id=tech.dongdongbh.mindwtr), or [Microsoft Store](https://apps.microsoft.com/detail/9n0v5b0b6frx?ocid=webpdpshare) helps a lot.
3. **Star and share:** Star the repo and post about Mindwtr on [X](https://twitter.com/intent/tweet?text=I%20like%20Mindwtr%20https%3A%2F%2Fgithub.com%2Fdongdongbh%2FMindwtr), [Reddit](https://www.reddit.com/submit?url=https%3A%2F%2Fgithub.com%2Fdongdongbh%2FMindwtr&title=I%20like%20Mindwtr), or [LinkedIn](https://www.linkedin.com/shareArticle?mini=true&url=https%3A%2F%2Fgithub.com%2Fdongdongbh%2FMindwtr&title=I%20like%20Mindwtr).
4. **Report bugs and request features:** Open issues on [GitHub Issues](https://github.com/dongdongbh/Mindwtr/issues).
5. **Join the community chat:** Come to [Discord](https://discord.gg/gc4h5t58PR).
6. **Help with translations:** Contribute locale updates in [`packages/core/src/i18n/locales/`](packages/core/src/i18n/locales/).
7. **Contribute code/docs:** Open a pull request and follow the [contribution guide](docs/CONTRIBUTING.md) and commit conventions.
8. **Pick and build:** Community members are welcome to pick any open issue and submit a PR.
9. **Sponsor the project:** Support ongoing development via [GitHub Sponsors](https://github.com/sponsors/dongdongbh) or [Ko-fi](https://ko-fi.com/D1D01T20WK).

## Documentation

- 📚 [Official Docs](https://docs.mindwtr.app/)
- 🚀 [Getting Started](https://docs.mindwtr.app/start/getting-started)
- ❓ [FAQ](https://docs.mindwtr.app/start/faq)
- 🔄 [Data & Sync](https://docs.mindwtr.app/data-sync/)
- 🛠️ [Cloud Deployment](https://docs.mindwtr.app/data-sync/cloud-deployment)
- ☁️ [Cloud API](https://docs.mindwtr.app/developers/cloud-api)
- 🧠 [MCP Server](https://docs.mindwtr.app/power-users/mcp)
- 📝 [Release Notes Index](docs/release-notes/README.md)

## Star History

<a href="https://www.star-history.com/?repos=dongdongbh%2FMindwtr&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=dongdongbh/Mindwtr&type=date&theme=dark&legend=top-left&sealed_token=o7AhNqQCMIgsAPrJNNtM_vXOeX8W0bIEpvmIena9PV3XimmgI9az7lbogUApV_fH-XpQ4OuVXrpI4qP3V7ixza9r8lDKbwNU0-oQrJywIWFf0kNhQD71ypiYzU7MpatFfUn30EeKyKyEpEqUlOtHfAb0XEs59TKha6lmoUfazzlSHvmR47bncqR7gUGO" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=dongdongbh/Mindwtr&type=date&legend=top-left&sealed_token=o7AhNqQCMIgsAPrJNNtM_vXOeX8W0bIEpvmIena9PV3XimmgI9az7lbogUApV_fH-XpQ4OuVXrpI4qP3V7ixza9r8lDKbwNU0-oQrJywIWFf0kNhQD71ypiYzU7MpatFfUn30EeKyKyEpEqUlOtHfAb0XEs59TKha6lmoUfazzlSHvmR47bncqR7gUGO" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=dongdongbh/Mindwtr&type=date&legend=top-left&sealed_token=o7AhNqQCMIgsAPrJNNtM_vXOeX8W0bIEpvmIena9PV3XimmgI9az7lbogUApV_fH-XpQ4OuVXrpI4qP3V7ixza9r8lDKbwNU0-oQrJywIWFf0kNhQD71ypiYzU7MpatFfUn30EeKyKyEpEqUlOtHfAb0XEs59TKha6lmoUfazzlSHvmR47bncqR7gUGO" />
 </picture>
</a>

## Sponsors

Thanks to these monthly sponsors for supporting Mindwtr.

<p align="center">
  <a href="https://github.com/jarrydstan" title="@jarrydstan">
    <img src="docs/assets/sponsors/jarrydstan.png" width="60" height="60" alt="@jarrydstan" />
  </a>
  <a href="https://github.com/ronmolenda" title="@ronmolenda">
    <img src="docs/assets/sponsors/ronmolenda.png" width="60" height="60" alt="@ronmolenda" />
  </a>
  <a href="https://github.com/karl1990" title="@karl1990">
    <img src="docs/assets/sponsors/karl1990.png" width="60" height="60" alt="@karl1990" />
  </a>
  <a href="https://github.com/srijan" title="@srijan">
    <img src="docs/assets/sponsors/srijan.png" width="60" height="60" alt="@srijan" />
  </a>
  <a href="https://github.com/davibicudo" title="@davibicudo">
    <img src="docs/assets/sponsors/davibicudo.png" width="60" height="60" alt="@davibicudo" />
  </a>
  <a href="https://github.com/PLPeeters" title="@PLPeeters">
    <img src="docs/assets/sponsors/plpeeters-avatar.png" width="60" height="60" alt="@PLPeeters" />
  </a>
  <a href="https://github.com/danhs" title="@danhs">
    <img src="docs/assets/sponsors/danhs.png" width="60" height="60" alt="@danhs" />
  </a>
</p>

<p align="center">
  <sub><a href="https://github.com/jarrydstan">@jarrydstan</a> · <a href="https://github.com/ronmolenda">@ronmolenda</a> · <a href="https://github.com/karl1990">@karl1990</a> · <a href="https://github.com/srijan">@srijan</a> · <a href="https://github.com/davibicudo">@davibicudo</a> · <a href="https://github.com/PLPeeters">@PLPeeters</a> · <a href="https://github.com/danhs">@danhs</a></sub>
</p>
