# Attention Planner

一个一次只回答一个问题的个人规划应用：**现在该做什么？**
它是可安装的 PWA，地址是 **[todo.onthat.top](https://todo.onthat.top)**；可以离线使用，数据通过你自己的 Google Drive 同步。

English: [README.md](./README.md) · 完整操作说明：[中文使用手册](./docs/attention-planner-user-guide-zh.md)

> Attention Planner 基于 dongdongbh 的 [Mindwtr](https://github.com/dongdongbh/Mindwtr) 修改而来，继续采用 [AGPL-3.0](./LICENSE) 许可。它保留了 Mindwtr 本地优先的数据模型和同步引擎，把 GTD 仪表盘换成了一套精简的规划流程。本项目不是 Mindwtr 官方版本。

## 三个入口

| 入口 | 用途 |
| --- | --- |
| **NOW** | 只给出此刻的一件事：正在进行的会议、你选定的工作，或适合剩余时间的任务。下面是今天剩余的安排：定时日程、你预留的工作时段、全天事件和“今天想做”。 |
| **收集箱** | 先写下来，整理和安排都可以稍后。选了“哪天想做”仍留在收集箱；只有预留具体时段才会加入待办。 |
| **计划** | 按天和日历查看。一个任务可以预留多个时段；错过的时段会在你设定的可用时间里、避开日历约束自动顺延，截止日期保持不变。 |

## 主要功能

- **任务页面直接编辑：**
  - 像 Notion 一样没有单独的“编辑模式”。标题、正文、步骤和属性停顿片刻、离开输入框或按 **Ctrl/Cmd+S** 即自动保存。
  - 顶部“撤销”可以逐次撤回本页已保存的修改。
  - 其他设备同时改了同一段文字时，由你选择保留哪一版。
- **清单：**
  - 步骤可以多行：Enter 新建下一步，Shift+Enter 换行。
  - 每一步可以按日历定时刷新（如每周二、四 06:00），也可以在整张清单完成后相隔一段时间再刷新。
  - 每一轮单独记录完成情况；结束日期包含当天；漏做不会堆积成新任务。
- **任务关联：** 一个任务可以指向任意另一个任务，平铺列表里两者排在一起。没有嵌套的子任务，拆步骤用清单。
- **日历：** 只读接入 Outlook，支持 Microsoft Graph，或用 Power Automate 导出到私人 Google Drive 文件。后者适合禁止应用授权的学校租户。
- **提醒：** Web Push，iPhone 主屏幕版本同样支持（iOS 16.4 及以上）。
- **AI 访问（可选，默认关闭）：** 为 ChatGPT 和 Codex 提供远程 MCP。新建的草稿进入收集箱；修改已有数据都要账号所有者在浏览器里确认。

## 开始使用

### 在线入口与数据同步

1. 打开 [todo.onthat.top](https://todo.onthat.top)。未连接同步时，数据只保存在当前浏览器的本地存储中。
2. 前往「设置 → 同步」，选择 **Google Drive** 并连接账号。
3. 页面显示“已长期授权”后，短时访问令牌会自动刷新。应用启动、回到前台、数据变化或手动点击“立即同步”时都会同步。
4. 任务数据写入 Google Drive 隐藏的 `appDataFolder/attention-planner-v2.json`，不会出现在普通 Drive 文件列表中，由浏览器直接读写。

Google Drive 同步与 Outlook 日历是两套相互独立的连接，可以分别使用个人 Google 账号和学校 Microsoft 账号。“长期授权”表示通常不必反复登录，不表示 iOS 会允许 PWA 在后台持续运行。

### 在 iPhone 上安装

需要 iOS/iPadOS 16.4 或更新版本，并且必须用 Safari 安装。

1. 在 Safari 中打开 [todo.onthat.top](https://todo.onthat.top)。
2. 点击底部“分享”，选择“添加到主屏幕”，名称保留为 **Attention Planner**。
3. 从主屏幕的新图标打开应用，在「设置 → 同步」连接 Google Drive。
4. 需要提醒时，在主屏幕版本的「设置 → 通知」打开通知和“iPhone 后台推送”，允许系统通知后点击“发送测试通知”。每台设备都要单独启用一次。

PWA 关闭后，服务器仍可以发送可见提醒；但 iOS 不允许静默推送唤醒应用，也不保证像原生 App 一样执行后台任务。

### Outlook 日历

学校租户禁止 Microsoft Graph 应用授权时，用 **Power Automate → 私人 Google Drive → PWA**，不需要 Premium：

1. 在「设置 → 同步」连接 Google Drive。这个连接只能访问隐藏的任务数据，以及本应用创建或你明确打开的文件，不能浏览整个云端硬盘。
2. 在「设置 → 集成 → Outlook → Google Drive」点击“准备私有导出文件”，生成私有的 `outlook-calendar.json`。
3. 在 Power Automate 中建一个定时云端流，依次是：Recurrence → `Get calendar view of events (V3)` → `Select` → Google Drive `Update file`。
4. 建议每 30 分钟运行一次，读取过去 30 天到未来 365 天，只导出 `id`、`title`、`start`、`end`、`location`、`allDay`。

完整的字段映射、验证步骤和安全边界见 [Outlook → Google Drive 导出说明](./docs/outlook-google-drive-export.md)。

如果租户允许，也可以直接用 Microsoft Graph：在 Microsoft Entra 注册一个单页应用，重定向 URI 设为 `https://todo.onthat.top/redirect`，只授予 delegated `Calendars.Read`。然后在「设置 → 集成 → Microsoft Outlook（日历只读）」填写客户端 ID；单租户应用还要填写租户 ID。两种方式都只读，不会把任务写入 Outlook。

### 快捷键

| 操作 | 按键 |
| --- | --- |
| 保存当前修改（任何地方） | Ctrl/Cmd+S |
| 撤销任务页面的上一处修改（光标不在输入框时） | Ctrl/Cmd+Z |
| 清单：新建下一步 / 步骤内换行 | Enter / Shift+Enter |
| 清单：删除空步骤 / 在步骤间移动 / 调整顺序 | Backspace / ↑↓ / Alt+↑↓ |

## 当前边界

- **Google Drive：** 已上线，并实际验证过长期授权与同步。
- **Outlook：** 只读，写入和双向同步都没有实现。
- **iPhone：** 可以安装、离线使用和接收 Web Push；推送权限需要在每台设备上由你授予并测试。
- **远程 MCP：** 代码已经完成，但默认 `MCP_ENABLED=false`，部署不等于启用。启用步骤和权限说明见 [远程 MCP 手册](./docs/attention-planner-mcp.md)。
- **数据路径：** 普通授权和推送不会上传任务正文。启用远程 MCP 后，Cloudflare Worker 会在请求期间处理应用数据并加密暂存操作预览，AI 提供商会收到工具返回的内容。详见 [隐私说明](./docs/PRIVACY.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [中文使用手册](./docs/attention-planner-user-guide-zh.md) | 日常使用、安装、同步、提醒、快捷键 |
| [产品模型](./docs/product-model.md) | 代码依据的概念：状态、日期、计划、关联 |
| [设计原则](./DESIGN.md) | 界面方向与取舍 |
| [清单定时刷新](./docs/checklist-refresh.md) | 按日历和完成后刷新、结束日期、同步 |
| [远程 MCP](./docs/attention-planner-mcp.md) | 启用 AI 访问、权限、确认流程 |
| [部署说明](./docs/attention-planner-alpha.md) | 托管、安全响应头、构建与部署 |
| [隐私](./docs/PRIVACY.md) · [安全](./SECURITY.md) · [更新记录](./CHANGELOG.md) | |

## 开发

需要 [Bun](https://bun.sh) 1.3.5（见 `.bun-version`）。

```bash
bun install --frozen-lockfile
```

```bash
bun desktop:web
```

然后打开 <http://localhost:5173>。

| 任务 | 命令 |
| --- | --- |
| 单元测试（core / PWA） | `bun run --filter @mindwtr/core test` / `bun run --filter mindwtr test` |
| 类型检查（PWA） | `bun run typecheck:desktop` |
| 端到端测试 | `bun run test:e2e` |
| 生产构建 | `bun run desktop:web:build`（输出到 `apps/desktop/dist`） |

目录说明：
- `apps/desktop` 是线上运行的 PWA；
- `apps/sync-broker` 是 Cloudflare Worker，负责 Google OAuth、Web Push 和可选的远程 MCP；
- `packages/core` 是共享的领域逻辑；
- `e2e` 是 Playwright 测试。

`apps/mobile`、`apps/cloud`、`apps/mcp-server`、原生桌面打包、商店元数据、`wiki/`、`docs/release-notes/` 和发布工作流都继承自 Mindwtr，本项目不维护也不部署。保留它们是为了让共享代码能正常构建，也方便和上游对比。

每个指向 `main` 的 PR 都会跑完整的 CI。部署是手动的：PWA 发布到 Cloudflare Pages，Worker 单独部署，步骤见 [部署说明](./docs/attention-planner-alpha.md) 和 [`apps/sync-broker`](./apps/sync-broker/README.md)。

## 许可与致谢

Attention Planner 基于 [Mindwtr](https://github.com/dongdongbh/Mindwtr)（上游基线 v1.1.5），原作者为 dongdongbh 及其贡献者。本项目以 [GNU Affero General Public License v3.0](./LICENSE) 发布。因为应用通过网络提供服务，本仓库即其完整源代码。
