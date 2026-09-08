> [!NOTE]
> This repository hosts the **Attention Planner** personal PWA fork at [todo.onthat.top](https://todo.onthat.top). It adds attention frames and NOW selection, Google Drive synchronization, read-only Outlook calendar adapters, a single-account Google-authenticated long-lived OAuth broker, and privacy-preserving Web Push reminders. See the public [privacy policy](https://todo.onthat.top/privacy.html) and [`apps/sync-broker`](./apps/sync-broker) for the server design. Task and exported calendar JSON travel directly between the PWA and Google Drive; the broker stores no task or calendar content.
>
> 本仓库是 **Attention Planner** 个人 PWA 分支。上游项目为 [dongdongbh/Mindwtr](https://github.com/dongdongbh/Mindwtr)，本分支继续采用 AGPL-3.0。

## 中文使用手册

首次使用和日常操作请阅读 **[Attention Planner 中文使用手册](./docs/attention-planner-user-guide-zh.md)**；开发以 **[Attention Planner 产品模型](./docs/product-model.md)** 为概念基线，界面取舍遵循 **[设计原则](./DESIGN.md)**。当前一级导航只有 NOW、Inbox、Plan，原有 GTD 高级视图收进 More。

## Attention Planner 快速开始

最短工作流：想到事情先放入 **Inbox**，默认只回答“可执行／稍后／将来／删除”；在 **Plan → Today** 中只处理“今日承诺／时间块／可执行”；执行时回到 **NOW**，一次只看当前一件事。更细的 Waiting、Reference、Context 等只在 More 的高级流程中出现。Available、Scheduled、Snoozed 与 Due 是不同时间语义，不再共用一个开始时间字段。

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

完整、可复现的 Power Automate 字段映射、验证步骤、安全边界和故障排查见 [`docs/outlook-google-drive-export.md`](./docs/outlook-google-drive-export.md)。

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

中文 | [English](./README.md)

**把脑子里的事都倒出来。** Mindwtr 是一款免费开源的待办应用，基于「搞定」（Getting Things Done，GTD）方法：随手记下每个任务和想法，它帮你看清下一步该做什么。无需账号，无需订阅，数据保存在你自己的设备上。

*Mindwtr 取自 "mind like water"（心静如水）：脑子里不再惦记一堆事，人自然就静了。项目统一使用 Mindwtr 作为正式名称；中文社区也可以亲切地简称为「如水」。*

[快速开始](https://docs.mindwtr.app/start/getting-started) · [常见问题](https://docs.mindwtr.app/start/faq) · [文档](https://docs.mindwtr.app/) · [数据与同步](https://docs.mindwtr.app/data-sync/) · [云端部署](https://docs.mindwtr.app/data-sync/cloud-deployment) · [MCP 服务器](https://docs.mindwtr.app/power-users/mcp)

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
    <img alt="在 Flathub 获取"
         src="https://flathub.org/api/badge?locale=zh-Hans"
         align="center"
         style="height: 50px"
         height="50" />
  </a>
  <a href="https://apt.izzysoft.de/packages/tech.dongdongbh.mindwtr" target="_blank">
    <img src="https://gitlab.com/IzzyOnDroid/repo/-/raw/master/assets/IzzyOnDroid.png"
         align="center"
         alt="在 IzzyOnDroid 获取"
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
    <img alt="从 Snap Store 获取"
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
    <i>Arch Linux 与 Android 上的本地优先 GTD</i>
  </p>
</div>

## 这些场景，是不是很熟悉？

- **「这事我记得住。」其实记不住。** 一个快捷键，敲下来，就能放心忘掉。这就是收集。
- **清单上躺着 80 件事，你干脆不打开它。** 「聚焦」只显示你现在能做的那几件。
- **「筹备妈妈的生日」卡了好几周。** 把它拆成一小步一小步的项目，下一步永远清清楚楚。
- **拜托同事的事，你俩都忘了。** 放进「等待中」，到时候记得去催。
- **「有空学吉他」一直在清单里让你内疚。** 放进「将来/也许」：留着，但不再烦你。
- **周日晚上，感觉一切都失控了。** 跟着每周回顾走一遍，重新掌控局面。

## 怎么用

大脑是用来产生想法的，不是用来存放它们的（David Allen 说的，GTD 这本书就是他写的）。存放的活儿，交给 Mindwtr：

1. **先记下来。** 任务、想法、惦记的事：打字或说话，直接进收件箱。桌面端有全局快捷键，手机上有小组件和系统分享。
2. **理一理。** 跟着向导快速过一遍收件箱：两分钟能做完？现在就做。有日期？排上日程。在等别人？记入等待清单。只是个念头？放进「将来/也许」。
3. **去做。** 打开「聚焦」，只看现在能做的几件事，其他一概不出现。
4. **每周清一次。** 每周回顾向导帮你收拾漏网的事，让清单一直可信、脑子一直清爽。

熟悉 GTD 的话：这就是完整的收集、澄清、组织、执行、回顾。不熟悉也没关系：Mindwtr 每一步都有引导，想深入了解可以读读 [15 分钟入门 GTD](https://hamberg.no/gtd)。

## 理念

**我只是想骑车，不要给我驾驶舱。**

Mindwtr 默认简单，需要时也足够强大：

- 高级选项在需要时才出现。
- 更少字段、更少按钮、更少干扰。
- 清爽胜过堆料，坚决不做功能膨胀。

## 功能

- 完整的 GTD 流程，全程有引导：记下来、理一理、去做、每周回顾。
- 聚焦视图把今天的日程和下一步行动放在同一屏。
- 数据保存在你自己的设备上。同步是可选的，存哪儿你说了算：Apple 设备上的 iCloud、Dropbox、共享文件夹、自己的服务器，或 WebDAV。
- 项目支持分区、领域与手动排序，适合更复杂的多步骤规划。
- 从 Obsidian 笔记导入任务，并可链接回源笔记（桌面端）。
- 可选 AI 助手：接入你自己的 OpenAI、Gemini 或 Claude 账号，或在自己电脑上运行本地模型。默认关闭。
- 提供 Windows、macOS、Linux、iPhone、Android 应用，另有可离线使用的网页版。
- 面向开发者：本地 REST API、CLI，以及让 AI 助手管理任务的 [`mindwtr-mcp`](https://www.npmjs.com/package/mindwtr-mcp) 服务器。

<details>
<summary>查看完整功能列表</summary>

### GTD 工作流
- **收集** - 随时快速添加任务（全局快捷键弹窗、托盘、分享、语音）
- **澄清** - 2 分钟法则引导的收件箱处理
- **组织** - 项目、分区、情境与状态清单
- **回顾** - 带提醒的每周回顾向导
- **执行** - 基于情境筛选的下一步行动
- **AI 辅助（可选）** - 用你自己的 AI 账号（OpenAI、Gemini、Claude）或本地/自托管的 OpenAI 兼容模型，完成澄清、拆解与回顾

### 视图
- 📥 **收件箱** - 任务收集区与处理向导
- 🎯 **聚焦** - 日程（时间维度）+ 下一步行动合并视图
- 📁 **项目** - 支持分区、领域与手动任务排序的多步骤成果
- 🏷️ **情境** - 按在哪儿、用什么做来给任务打标签；嵌套情境（如 @work/meetings）也会匹配上级 @work
- ⏳ **等待中** - 委派事项
- 💭 **将来/也许** - 延后想法
- 📅 **日历** - 基于时间的规划，移动端周视图密度可调
- 📋 **看板** - 看板式拖拽
- 📝 **回顾** - 每日 + 每周回顾流程
- 📦 **归档** - 隐藏历史，按需搜索

### 生产力功能
- 🔍 **全局搜索** - 全领域搜索，并支持搜索操作符（`status:`、`context:`、`assigned:`、`location:`、`where:`、`id:`、`-id:`、`due:<=7d`）
- 📦 **批量操作** - 多选、批量移动/打标签/删除
- 📎 **附件** - 任务支持文件与链接
- ✏️ **Markdown 备注** - 富文本描述与预览
- 🗂️ **项目状态** - 进行中、等待中、将来/也许、归档
- ♾️ **流动重复** - 下次日期按完成时间计算
- ♻️ **可复用清单** - 复制任务或重置清单
- ✅ **清单模式** - 清单任务快速勾选
- ✅ **语音收集** - 语音快速记录、自动转写并创建任务
- 🧭 **Copilot 建议** - 可选的情境/标签/时间提示
- 🍅 **番茄专注（可选）** - 在聚焦视图使用 15/3、25/5、50/10 番茄钟面板，并可添加一个自定义预设
- 🔔 **通知** - 开始提醒与截止提醒分开设置，并支持稍后提醒
- 📊 **每日摘要** - 早间简报 + 晚间回顾
- 📅 **每周回顾** - 可定制的每周提醒

### 数据与同步
- 🔄 **同步选项** - 支持后端与配置方式请见 [数据与同步文档](https://docs.mindwtr.app/data-sync/)
- 🍎 **iCloud 同步** - 在受支持的 iPhone、iPad 与 macOS 构建中内置（CloudKit）
- ☁️ **Dropbox 同步（可选）** - 登录 Dropbox 后通过专属应用文件夹同步（商店版提供，FOSS 构建不含）
- 📤 **导出/备份** - 导出 JSON 数据
- ♻️ **从备份恢复** - 先创建恢复快照，再用已验证的 Mindwtr 备份替换本地数据
- 📥 **TickTick + Todoist + DGT GTD + OmniFocus + Apple Reminders 导入** - 将 TickTick CSV/ZIP、Todoist CSV/ZIP、DGT GTD JSON/ZIP、OmniFocus 导出或未完成的 Apple Reminders 导入到 Mindwtr
- 🔗 **Obsidian 集成** - 桌面端导入 Vault 中的任务，并可深度链接回源笔记
- 🗓️ **外部日历（系统日历 + ICS）** - 移动端读取系统日历并推送带日期的任务；macOS 桌面端可读取 Apple Calendar 并推送带日期的任务；桌面/Web 也支持 ICS 订阅与从事件创建任务

### 自动化
- 🔌 **CLI** - 仓库辅助工具，可从终端添加/列出/完成/搜索
- 🌐 **REST API** - 桌面端本地 API，使用设置中生成的 bearer token 进行脚本化访问
- 🌍 **网页应用** - 在浏览器中运行，支持离线使用（PWA）
- 🧠 **MCP 服务器** - 让 AI 助手读取和管理你的任务（本地 Model Context Protocol 服务），可通过 [`mindwtr-mcp`](https://www.npmjs.com/package/mindwtr-mcp) 或 [MCP Registry](https://registry.modelcontextprotocol.io/) 获取

桌面端可在 **设置 -> 高级** 启动本地 REST API，默认监听 `127.0.0.1:3456` 并使用生成的 bearer token。CLI 仍是仓库辅助工具；stdio MCP 服务器可用 `npm install -g mindwtr-mcp` 安装，或由 MCP 客户端通过 `npx -y mindwtr-mcp` 启动。

### 跨平台
- 🖥️ **桌面端** - Tauri v2（macOS、Linux、Windows）
- 📱 **移动端** - React Native/Expo（iOS 通过 App Store/TestFlight、Android），内置手势与应用快捷方式提示
- 📲 **Android 小部件** - 桌面焦点/下一步小组件
- ⌨️ **键盘快捷键** - 标准（Gmail 风格）、Vim 与 Emacs 预设
- 🎨 **主题** - 明亮、暗色、OLED、Nord、Sepia、电子墨水与 Material 3
- 🌍 **国际化** - 英文、越南语、简体中文、繁體中文、西班牙语、印地语、阿拉伯语、德语、俄语、日语、法语、葡萄牙语、波兰语、韩语、捷克语、意大利语、土耳其语、荷兰语
- 🐳 **Docker** - 使用 Docker 运行 PWA + 自托管同步服务

</details>

## 为什么选择 Mindwtr（快速对比）

Mindwtr 适合想在一个应用里用上完整 GTD 方法、并且数据完全归自己的人。下面是与主流任务应用和 GTD 垂直应用的简短、尊重事实的对比。

| 能力 | Mindwtr | Todoist | TickTick | Everdo | NirvanaHQ |
|---|---|---|---|---|---|
| 开源 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 开箱即用的完整 GTD 方法 | ✅ | ⚠️ | ⚠️ | ✅ | ✅ |
| 全平台可用：Windows、Mac、Linux、iPhone、Android、网页 | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| 可离线使用，无需账号 | ✅ | ❌ | ❌ | ✅ | ❌ |
| 可选 AI 助手（用自己的 AI 账号，或跑在自己电脑上） | ✅ | ❌ | ❌ | ❌ | ❌ |
| 数据同步到哪儿由你选（Dropbox、自己的服务器、文件夹、WebDAV） | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| 完全免费 | ✅ | ❌ | ❌ | ❌ | ❌ |

说明：`✅` = 支持，`❌` = 不支持，`⚠️` = 部分或受限支持。

*以上信息基于公开产品页面/文档整理。如有变更，欢迎附来源提交 issue/PR。*

## 安装

完整且最新的安装指南请见[桌面端安装](https://docs.mindwtr.app/start/desktop-installation)与[移动端安装](https://docs.mindwtr.app/start/mobile-installation)。

快速选择：

- Windows：Microsoft Store、Winget、Chocolatey、Scoop 或 GitHub Releases。
- macOS：Mac App Store、Homebrew、TestFlight 测试版或 GitHub Releases。
- Linux：Flathub、Snap、AUR、APT/RPM 仓库或 GitHub Releases。
- Android：Google Play、F-Droid、IzzyOnDroid 或 GitHub Releases APK。
- iOS：App Store 或 TestFlight 测试版。
- Web / 自托管：[云端部署](https://docs.mindwtr.app/data-sync/cloud-deployment)或 [Docker 指南](docker/README.md)。

<details>
<summary>包管理器快速命令</summary>

```bash
flatpak install flathub tech.dongdongbh.mindwtr
yay -S mindwtr-bin
brew install --cask mindwtr
```

```powershell
winget install dongdongbh.Mindwtr
```

APT/RPM 仓库配置、源码构建、便携版 ZIP、移动商店变体与 Docker 设置请参考上方完整安装指南。

</details>

## 社区

Mindwtr 的发展离不开用户与贡献者的支持，感谢大家一起把它变得更好。

### :hearts: 贡献与支持

如果你想参与代码贡献，请先阅读 [CONTRIBUTING.md](docs/CONTRIBUTING.md)。

你可以通过以下方式帮助项目：

1. **帮忙传播：** 向朋友和社区推荐 Mindwtr，并在 [Product Hunt](https://www.producthunt.com/products/mindwtr) 与 [AlternativeTo](https://alternativeto.net/software/mindwtr/) 支持它。
2. **留下应用商店评价：** 在 [App Store](https://apps.apple.com/app/mindwtr/id6758597144)、[Google Play](https://play.google.com/store/apps/details?id=tech.dongdongbh.mindwtr) 或 [Microsoft Store](https://apps.microsoft.com/detail/9n0v5b0b6frx?ocid=webpdpshare) 的好评对项目帮助很大。
3. **Star 并分享：** 给仓库点个 Star，并在 [X](https://twitter.com/intent/tweet?text=I%20like%20Mindwtr%20https%3A%2F%2Fgithub.com%2Fdongdongbh%2FMindwtr)、[Reddit](https://www.reddit.com/submit?url=https%3A%2F%2Fgithub.com%2Fdongdongbh%2FMindwtr&title=I%20like%20Mindwtr)、[LinkedIn](https://www.linkedin.com/shareArticle?mini=true&url=https%3A%2F%2Fgithub.com%2Fdongdongbh%2FMindwtr&title=I%20like%20Mindwtr) 发布使用体验。
4. **报告问题与提出需求：** 在 [GitHub Issues](https://github.com/dongdongbh/Mindwtr/issues) 提交 Bug 和功能建议。
5. **加入社区讨论：** 欢迎加入 [Discord](https://discord.gg/gc4h5t58PR)。
6. **参与翻译：** 在 [`packages/core/src/i18n/locales/`](packages/core/src/i18n/locales/) 提交语言翻译改进。
7. **贡献代码或文档：** 提交 PR，并遵循[贡献指南](docs/CONTRIBUTING.md)和提交规范。
8. **认领并实现：** 欢迎社区成员从任何开放 issue 中认领条目并提交 PR。
9. **赞助项目：** 可通过 [GitHub Sponsors](https://github.com/sponsors/dongdongbh) 或 [Ko-fi](https://ko-fi.com/D1D01T20WK) 支持持续开发。

## 文档

- 📚 [官方文档](https://docs.mindwtr.app/)
- 🚀 [快速开始](https://docs.mindwtr.app/start/getting-started)
- ❓ [FAQ](https://docs.mindwtr.app/start/faq)
- 🔄 [数据与同步](https://docs.mindwtr.app/data-sync/)
- 🛠️ [云端部署](https://docs.mindwtr.app/data-sync/cloud-deployment)
- ☁️ [云端 API](https://docs.mindwtr.app/developers/cloud-api)
- 🧠 [MCP 服务器](https://docs.mindwtr.app/power-users/mcp)
- 📝 [版本说明索引](docs/release-notes/README.md)

## Star History

<a href="https://www.star-history.com/?repos=dongdongbh%2FMindwtr&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=dongdongbh/Mindwtr&type=date&theme=dark&legend=top-left&sealed_token=o7AhNqQCMIgsAPrJNNtM_vXOeX8W0bIEpvmIena9PV3XimmgI9az7lbogUApV_fH-XpQ4OuVXrpI4qP3V7ixza9r8lDKbwNU0-oQrJywIWFf0kNhQD71ypiYzU7MpatFfUn30EeKyKyEpEqUlOtHfAb0XEs59TKha6lmoUfazzlSHvmR47bncqR7gUGO" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=dongdongbh/Mindwtr&type=date&legend=top-left&sealed_token=o7AhNqQCMIgsAPrJNNtM_vXOeX8W0bIEpvmIena9PV3XimmgI9az7lbogUApV_fH-XpQ4OuVXrpI4qP3V7ixza9r8lDKbwNU0-oQrJywIWFf0kNhQD71ypiYzU7MpatFfUn30EeKyKyEpEqUlOtHfAb0XEs59TKha6lmoUfazzlSHvmR47bncqR7gUGO" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=dongdongbh/Mindwtr&type=date&legend=top-left&sealed_token=o7AhNqQCMIgsAPrJNNtM_vXOeX8W0bIEpvmIena9PV3XimmgI9az7lbogUApV_fH-XpQ4OuVXrpI4qP3V7ixza9r8lDKbwNU0-oQrJywIWFf0kNhQD71ypiYzU7MpatFfUn30EeKyKyEpEqUlOtHfAb0XEs59TKha6lmoUfazzlSHvmR47bncqR7gUGO" />
 </picture>
</a>

## 赞助者

感谢这些按月赞助 Mindwtr 的朋友。

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
