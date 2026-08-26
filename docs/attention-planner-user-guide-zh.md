# Attention Planner 中文使用手册

本文是 [Attention Planner](https://todo.onthat.top/) 的统一中文手册。它既说明如何使用当前线上版本，也记录最初提出的问题最终如何被实现、替代或保留为后续工作。

Attention Planner 是基于 [Mindwtr](https://github.com/dongdongbh/Mindwtr) 的个人 PWA 分支。界面中仍有部分位置显示 Mindwtr 名称；本手册只描述 `todo.onthat.top` 已部署并验证的功能，不把设想写成现状。

> 这是一套帮助外置记忆、减少选择负担的工具，不是 ADHD 的诊断或治疗。若注意力、睡眠、饮食或日常生活问题持续造成明显影响，应同时考虑寻求专业评估和支持。

## 目录

1. [先记住这一条流程](#先记住这一条流程)
2. [五分钟开始使用](#五分钟开始使用)
3. [核心概念与三个入口](#核心概念与三个入口)
4. [每天怎么用](#每天怎么用)
5. [任务、项目、日期与周期](#任务项目日期与周期)
6. [NOW、Plan 与 Flexible Frames](#nowplan-与-flexible-frames)
7. [手机、电脑与 Google Drive 同步](#手机电脑与-google-drive-同步)
8. [在 iPhone 上安装和启用通知](#在-iphone-上安装和启用通知)
9. [Outlook 日历导入](#outlook-日历导入)
10. [数据、隐私与安全边界](#数据隐私与安全边界)
11. [备份、恢复与更换设备](#备份恢复与更换设备)
12. [常见问题](#常见问题)
13. [从最初问题到当前方案](#从最初问题到当前方案)
14. [当前仍未实现的内容](#当前仍未实现的内容)

## 先记住这一条流程

```text
脑中冒出事情
    ↓
收集箱：先记下来，不要求当场整理
    ↓
Plan：决定 Ready、项目、日期或等待对象
    ↓
NOW：只看当前建议和少量今日承诺
    ↓
回顾：每天清一次收集箱，每周检查整个系统
```

一句话版本：**随时捕获，稍后整理；执行时只看现在，不反复浏览全部任务。**

这个系统不是为了把每一分钟排满。固定会议和生活锚点进入 Calendar，宽松时段用 Frame 表示“适合做哪类事”，具体任务只在真正需要时进入 Today commitments 或时间安排。

## 五分钟开始使用

### 第一次打开

1. 打开 [todo.onthat.top](https://todo.onthat.top/)。
2. 进入「设置 → 同步」，确认同步后端为 **Google Drive**。
3. 连接获准的个人 Google 账号，直到状态显示“已长期授权”。
4. 点击一次“立即同步”，确认页面显示“同步完成”。
5. 返回主界面，点击左上角“添加任务”。

未连接云端时也能使用，但数据只存在当前浏览器的本地存储中。第一次同步前，不要在多个设备同时创建两套彼此独立的数据。

### 先添加三件真实的事

不要先研究所有设置。建议只添加：

- 一件今天必须处理的事；
- 一件生活维护事项；
- 一件长期目标的最小下一步。

例如：

```text
回复导师关于摘要的邮件
今晚洗衣服 /due:today 8pm
打开第三章并读前 5 页 #exam
```

快速添加框支持类似界面示例的简单语法：

- `/due:tomorrow 5pm`：截止时间；
- `@phone`：执行情境；
- `#family`：标签。

不确定字段时只写自然语言标题，直接保存到收集箱。**捕获时少做决定**比格式完整更重要。

### 今天只做一个小闭环

1. 打开「收集箱」，选择一条任务。
2. 把模糊标题改成能直接开始的动作。
3. 如果今天要做，在「Plan → Today」把它加入今日承诺；如果有真实期限，再设置截止日期。
4. 打开「NOW」，从系统给出的一件事开始。
5. 完成后勾选，不需要立刻重构整个系统。

## 核心概念与三个入口

Attention Planner 把信息分成四层：

- **内容**：Area → Project → Task → Checklist，说明事情是什么；
- **状态**：Inbox、Ready、Waiting、Someday、Done，说明现在能不能做；
- **时间**：Event、Time Block、Due、Recurrence，说明什么时候发生；
- **注意力**：Today commitments、NOW、Frame，说明此刻看什么。

默认只保留三个一级入口：

- **NOW**：执行当前一件事；
- **Inbox**：快速捕获，稍后判断；
- **Plan**：管理 Today、Calendar、Projects、Later 和 Recurring。

Review、Contexts、Board、Reference 等保留在折叠的「More」中，需要时再用。完整的产品定义和兼容关系见 [产品模型](./product-model.md)。

### 收集箱

收集箱是临时入口，不是长期任务列表。想到什么先放进去，避免为了判断项目、优先级和日期而放弃记录。

适合放入：任务、想法、担忧、需要确认的事情。点击“整理”后，默认只需要四选一：

- **Ready**：现在可行动；
- **Later**：以后才可行动，只填写“何时可用”；
- **Someday**：现在不承诺；
- **Trash**：不再保留。

默认界面不再追问项目、领域、标签、情境、优先级、精力、时长、委派、Reference 或两分钟规则。确实需要这些字段时点“更多”，进入保留的高级整理流程。

### Ready 任务

Ready 表示任务现在可以直接行动；底层仍沿用兼容字段 `next`。Ready 任务的标题应能直接开始：

- 模糊：`准备考试`
- 可行动：`打开第三章并完成第 1 节习题`

如果一件事需要多个动作才能产生结果，它更适合成为项目。

### 项目与领域

- **项目**：需要多个步骤完成的结果，例如“提交论文修订稿”。
- **领域**：长期责任范围，例如“研究”“健康”“家庭”。

任务只放在一个容器中：项目，或直接属于一个领域。项目可以再分区段；不必为每个小任务建立项目。

### 等待中、将来/也许与参考

- **等待中**：下一步在别人手里，例如“等待导师确认会议时间”。
- **将来/也许**：现在不承诺，但不想忘记的想法。
- **参考**：不要求行动、只需保留的信息。

把这些内容移出可执行列表，可以避免 NOW 被不可行动事项污染。

### Today commitments（今日承诺）

今日承诺复用焦点星标，表示“我今天承诺关注它”，不是永久优先级。建议每天 1–3 项，状态不好时只保留 1 项。

### NOW 与 Plan

- **NOW**：执行主页，只显示一个当前建议和少量今日承诺。
- **Plan**：规划主页；Today 只放今日承诺、时间块和 Ready，Calendar 查看时间，Projects 管理成果和领域直属任务，Later 放置 Waiting/Someday，Recurring 检查周期。

Plan → Today 不再包含筛选器、保存视图、Top 3、Pomodoro、Review Due 或 Frame 编辑器；这些高级能力不会再和当天规划争抢注意力。

Calendar 回答“什么时候发生”，NOW 回答“现在把注意力放在哪里”。

## 每天怎么用

### 随时：捕获

脑中出现“我还要做……”时：

1. 点击“添加任务”；
2. 写成一句话；
3. 保存；
4. 回到刚才正在做的事。

不要在捕获时顺便研究工具、重新规划人生或整理全部项目。

### 每天开始：建立最小骨架

1. 查看 Outlook 会议和固定安排。
2. 确认吃饭、睡眠、通勤等生活锚点不会被忽略。
3. 在「Plan → Today」从 Ready 任务中选择 1–3 项今日承诺。
4. 给真正有硬期限的任务设置截止日期。
5. 打开「NOW」，让它成为执行时的返回点。

建议使用宽松时间框架，而不是给所有任务安排精确时间。例如上午是 Research Frame，下午是 Admin Frame；Frame 在后台帮助 NOW 选择，不需要把它当作任务容器。

### 卡住或分心后：不要重新规划整天

回到 Attention Planner，只回答：

1. 现在是否有正在发生的会议？
2. NOW 显示的任务是否还能做？
3. 如果不能，点 Later 或 Show another，选择一个更小动作。

计划被打断不等于一天失败。系统的作用是提供返回路径，而不是记录“欠下了多少计划”。

### 每天结束：五分钟清理

- 清理当天新进入的收集箱项目；
- 完成的任务勾选完成；
- 没做但仍重要的任务重新判断，而不是机械滚成逾期；
- 检查明天的会议和一个最重要动作；
- 确认同步状态正常。

### 每周：回顾

进入「回顾」，至少检查：

- 收集箱是否清空；
- 每个活跃项目是否有下一步行动；
- 等待中的事项是否需要跟进；
- 将来/也许中是否有内容需要启动；
- 未来一周日历是否有冲突；
- 周期任务是否仍然合理。

## 任务、项目、日期与周期

### 开始日期与截止日期

- **开始日期**：从什么时候开始考虑或执行。
- **截止日期**：真正不能晚于什么时候。

不要把“我想周三做”误写成“周三截止”。过多假截止日期会制造红色债务，使真正期限失去信号价值。

### 安排时间与外部事件

- 任务安排表示你打算在某段时间工作；
- Outlook 事件表示学校或他人已经确定的会议、课程和预约；
- 外部事件是只读边界，不应在 PWA 中随意移动。

### 周期任务

Mindwtr 已提供周期任务。设置时要区分：

- 固定日历周期，例如每周一倒垃圾；
- 完成后周期，例如完成后 7 天再次出现。

生活维护任务通常不应因为漏做几次就积累多条“逾期债务”。选择最符合实际行为的周期语义，并定期在每周回顾中调整。

### 一个推荐例子

```text
领域：研究
项目：提交论文修订稿
下一步行动：重画 Figure 3
截止日期：8 月 30 日
今日焦点：是
情境：@computer
```

项目保存结果，任务保存动作，日期保存时间约束；不要把三者都塞进任务标题。

## NOW、Plan 与 Flexible Frames

### NOW 如何选择内容

当前版本按以下顺序选择一件立即事项：

1. 正在发生的日历事件；
2. 当前已经安排的任务；
3. 与当前 Flexible Frame 匹配、且适合剩余时间的 Ready 任务；
4. 今天加了焦点星标的任务；
5. 确定性的 Ready 任务兜底。

全天日历事件不会占据 NOW。

可用动作：

- **Done**：完成；
- **Later**：推迟 30 分钟；
- **Show another**：换一项。

这些动作是为了降低重新决策成本，不是自动 AI 排程。

### Flexible Frame 是什么

Frame 只规定“这段时间适合做哪类事”，不强制具体任务。例如：

```text
Research：周一至周五 09:30–12:00，匹配 @research
Admin：周一至周五 14:00–15:30，匹配 #admin
Personal：每天 18:00–21:30，匹配 @home
```

在「Settings → GTD」的 **Attention rules** 中，可以设置：

- 名称；
- 开始和结束时间；
- 星期；
- 可选的 `@context` 或 `#tag`；
- 是否启用。

Frame 可以跨午夜，并随 GTD 设置同步到其他设备。

### 三种时间不要混用

- **以后可用（Available）**：在 Inbox 选择 Later 后填写；到时间前不会进入 Ready/NOW。
- **精确安排（Scheduled）**：在 Plan → Today 或 Calendar 安排；它是可移动的时间块。
- **暂时推迟（Snoozed）**：在 NOW 点 Later；只隐藏 30 分钟，不移动原来的日历安排。

旧数据中的“开始时间”仍可读取：只有日期的值按“以后可用”解释，带具体钟点的值按“精确安排”解释。默认 Inbox、Today、Calendar 和 NOW 操作会分别保存，不再让一次推迟意外改掉日历时间；高级编辑器和旧导入仍保留兼容字段。

## 手机、电脑与 Google Drive 同步

### 当前正式路径

```text
电脑浏览器本地数据 ─┐
                    ├─ Google Drive appDataFolder/data.json
iPhone PWA 本地数据 ─┘
```

所有操作先写入当前设备，本地数据使应用可以离线使用；Google Drive 用于设备间交换和合并数据。

### 自动同步发生在什么时候

PWA 会在以下时机同步：

- 应用启动；
- 页面重新获得焦点；
- 任务或项目变化后短暂延迟；
- 运行期间的定期同步；
- 手动点击“立即同步”。

页面显示“已长期授权”后，短时令牌会自动刷新。正常使用不需要每小时重新点击 Google 登录。

### 新设备第一次使用

1. 安装或打开 `todo.onthat.top`；
2. 不要先创建另一套任务；
3. 进入「设置 → 同步」并连接同一个 Google 账号；
4. 点击“立即同步”；
5. 确认任务和设置出现后再开始编辑。

### 同步冲突

同步写入会比较远端文件版本和 ETag。两个设备同时修改时，应产生可见冲突，而不是静默覆盖。

出现冲突时：

1. 暂停在其他设备继续编辑；
2. 查看同步历史和冲突数量；
3. 保留需要的版本；
4. 必要时使用同步前快照恢复；
5. 再执行一次同步确认收敛。

## 在 iPhone 上安装和启用通知

### 安装 PWA

要求 iOS/iPadOS 16.4 或更新版本。

1. 使用 Safari 打开 [todo.onthat.top](https://todo.onthat.top/)；
2. 点击“分享”；
3. 选择“添加到主屏幕”；
4. 名称保留为 Attention Planner；
5. 从主屏幕图标打开，而不是继续使用普通 Safari 标签；
6. 在这台设备连接 Google Drive 并同步。

### 启用后台推送

1. 从主屏幕版进入「设置 → 通知」；
2. 打开“任务提醒”；
3. 点击“启用此设备推送”；
4. 允许 iOS 系统通知；
5. 选择开始日期、截止日期和回顾日期提醒；
6. 使用测试通知确认。

每台设备都需要单独启用一次。任务日期变化后，让该设备至少打开并同步一次，以便把新的提醒时间发送给推送服务。

### PWA 通知的边界

- PWA 关闭或锁屏后，服务器仍可发送已登记的 Web Push；
- iOS 不允许 PWA 在后台任意持续运行；
- 日历文件更新不等于 PWA 界面会每 30 分钟在后台自动刷新；
- 服务器只保存推送端点、提醒时间和不可逆 ID，不保存任务标题或正文；
- 因此锁屏通知使用通用文字，打开应用后再查看具体任务。

## Outlook 日历导入

### 当前正式方案

```text
学校 Microsoft 365 Outlook
        ↓ Power Automate（每 30 分钟）
个人 Google Drive / outlook-calendar.json（私有）
        ↓ 浏览器直接读取
Attention Planner 日历与 NOW
```

学校 Outlook 与个人 Google Drive 可以是不同账号。这是当前已经跑通的正式路径。

### PWA 端

1. 确认「设置 → 同步」中的 Google Drive 已长期授权；
2. 进入「设置 → 集成」；
3. 展开“Outlook → Google Drive（日历只读）”；
4. 确认私有文件 `outlook-calendar.json` 已准备好；
5. 点击“刷新状态”，查看最近更新时间；
6. 打开「日历」，确认来源为 `Outlook (Google Drive)`。

### Power Automate 端

正式流为：

```text
Recurrence
  → Get calendar view of events (V3)
  → Select
  → Google Drive / Update file
```

当前推荐每 30 分钟运行，查询过去 30 天到未来 365 天，只导出：

- `id`
- `title`
- `start`
- `end`
- `location`
- `allDay`

不要导出正文、参会者、会议链接或组织者，也不要创建公开分享链接。Power Automate 必须更新 PWA 已创建的现有文件，不能每次创建同名副本。

完整字段表达式、验证和排错步骤见 [Outlook 日历经 Google Drive 导入 PWA](./outlook-google-drive-export.md)。

### 为什么没有继续使用公开 ICS

学校隐私策略可能把所有受保护事件压缩为 `Private Appointment`。这不是前端把标题压缩了，而是源头没有向 ICS 提供真实标题和地点。

### 为什么没有继续依赖 Microsoft Graph 直连

应用已经实现最小 `Calendars.Read` 的 Graph 只读适配器，但学校租户可要求管理员批准第三方应用。出现 `Need admin approval` 时，应用不能绕过学校策略。

因此当前生产配置保留代码能力，但使用 Power Automate 私有导出作为正式来源。

### 只读意味着什么

- 可以在 PWA 中查看 Outlook 标题、时间、地点和全天状态；
- 可以让当前会议参与 NOW 判断；
- 不能从 PWA 修改学校 Outlook 会议；
- 不能把任务写入 Outlook；
- 目前不是双向同步。

## 数据、隐私与安全边界

### 数据分别存在哪里

| 内容 | 主要位置 | Cloudflare 是否接收内容 |
| --- | --- | --- |
| 当前设备任务数据 | 浏览器本地存储 | 否 |
| 跨设备任务同步 | Google Drive 隐藏 `appDataFolder/data.json` | 否 |
| Outlook 导出 | Google Drive 私有 `outlook-calendar.json` | 否 |
| Google 长期授权 | 加密后的刷新令牌，Cloudflare Durable Object | 是，但不含任务或日历内容 |
| 短时 Google 令牌 | 浏览器内存或会话存储 | Worker 负责换取，但不接收 Drive 文件 |
| 推送登记 | 推送端点、提醒时间、不可逆 ID | 是，但不含任务标题或正文 |
| PWA 程序文件 | Cloudflare Pages | 只是静态应用壳 |

### 为什么要使用自有域名

浏览器按源隔离本地数据，`todo.onthat.top` 与 `attention-planner.pages.dev` 是两个不同存储空间。固定使用自有域名有两个作用：

- 以后更换托管商时仍可保持相同浏览器源；
- 避免用户在多个地址产生看起来“消失”的两套本地数据。

Google Drive 是跨设备和恢复路径，但本地浏览器仍保存当前工作副本，因此日常入口应始终固定为 `https://todo.onthat.top/`。

### Cloudflare 托管的风险边界

Cloudflare 能提供 PWA 的 HTML、JavaScript、图标和安全响应头，也能处理 OAuth broker 与推送调度。当前设计通过以下方式缩小风险：

- 任务和日历 JSON 由浏览器直接与 Google Drive 交换；
- 单账号登录限制；
- 刷新令牌应用层加密；
- 最小 Google Drive 权限 `drive.appdata` 与 `drive.file`；
- CSP、禁止 iframe、`nosniff`、no-referrer 和受限浏览器权限；
- Outlook 导出只含六个展示字段。

任何网页更新都可能改变前端代码，因此 GitHub 是版本真相，部署后仍应核对域名、提交和安全配置。

## 备份、恢复与更换设备

### 同步不是唯一备份

同步的目标是让设备收敛；误删除也可能同步到其他设备。建议同时使用：

- 「设置 → 数据」中的 JSON 导出；
- 「设置 → 同步」中的同步前快照；
- Google Drive 文件版本历史（若该文件类型和账号支持）；
- GitHub 保存源码和部署历史，但 GitHub 不保存个人任务数据。

### 恢复前

1. 暂停其他设备编辑；
2. 先导出当前数据，即使它看起来有问题；
3. 确认要恢复的快照时间；
4. 恢复后执行同步；
5. 抽查任务、项目、设置和周期规则。

### 不再使用时

建议按顺序处理：

1. 导出需要保留的数据；
2. 关闭 Power Automate 定时流；
3. 在各设备取消推送订阅；
4. 在 PWA 断开 Google Drive；
5. 删除不再需要的 Google 第三方授权和 Power Automate Google Drive 连接；
6. 最后再删除 `outlook-calendar.json` 或浏览器本地数据。

## 常见问题

### 为什么任务在另一台设备没有出现

- 确认两台设备都使用 `todo.onthat.top`；
- 确认连接的是同一个个人 Google 账号；
- 检查是否显示“已长期授权”；
- 在原设备和新设备依次点击“立即同步”；
- 查看同步历史和冲突数量。

### 为什么 Google Drive 普通文件列表里找不到任务数据

任务数据位于隐藏的 `appDataFolder`，这是预期行为。普通“我的云端硬盘”中能看到的是 Outlook 导出文件 `outlook-calendar.json`。

### 是否需要经常重新点击 Google 授权

通常不需要。broker 保存加密后的刷新令牌并自动换取短时令牌。如果状态变成需要重新授权，常见原因是 Google 撤销授权、测试用户配置变化或刷新令牌失效。

### Power Automate 已运行，手机为什么没立刻更新

Power Automate 更新的是 Drive 文件。iOS 不允许关闭的 PWA 每 30 分钟任意执行代码；打开 PWA、切回前台或在集成页面刷新后才会读取最新文件。

### 为什么所有 Outlook 会议都叫 Private Appointment

删除旧公开 ICS 来源，只保留 `Outlook (Google Drive)`。公开 ICS 中缺失的标题无法由前端恢复。

### Outlook 能否直接发送给 PWA

学校租户已阻止直接 Graph 授权，而 Power Automate 的普通 HTTP 直发通常涉及额外认证和可能的 Premium 连接器。当前方案让 Power Automate 更新私人 Drive 文件，再由 PWA 读取，权限边界更清晰。

### iPhone 收不到通知

- 必须从 Safari 添加到主屏幕；
- 必须从主屏幕图标打开；
- 每台设备都要在「设置 → 通知」启用推送；
- 检查 iOS 系统通知权限和专注模式；
- 确保任务有开始、截止或回顾时间；
- 修改任务后重新打开并同步一次。

### `pages.dev` 地址里看不到 `todo.onthat.top` 的本地任务

这是浏览器同源隔离，不是任务被删除。回到固定入口 `todo.onthat.top`，并用 Google Drive 同步恢复跨设备数据。

### OneDrive 为什么没有作为正式同步方式

个人 OneDrive 的 `Files.ReadWrite.AppFolder` 实验在真实 Microsoft Graph 请求中返回 `Access denied`。没有创建或覆盖 OneDrive 数据。为了不扩大 Microsoft 权限，生产路径改用已验证的 Google Drive，而不是请求整个 OneDrive 的广泛访问权。

## 从最初问题到当前方案

这一节总结最初需求和后续配置过程中提出的问题。它不是逐字公开私人对话，而是可核对的需求—结果记录。

| 最初的问题或目标 | 当前方案 | 状态与边界 |
| --- | --- | --- |
| TXT 记录很快，但没有结构、日历和提醒 | 快速添加先进入收集箱；之后再补日期、情境、项目和周期 | **部分解决**：录入阻力已降低，但尚未实现保留任意原始长文本的独立 `RawInboxEntry` 模型 |
| 每周、每月或任意周期的 Todo | 使用 Mindwtr 已有周期任务能力，区分固定周期和完成后周期 | **已解决** |
| 手机和电脑都能使用 | 同一 PWA 可在电脑浏览器和 iPhone 主屏幕运行 | **已解决第一阶段**：不是原生 iOS App |
| 多设备同步，且不把活动仓库放 OneDrive | 任务通过 Google Drive `appDataFolder` 同步；源码以 GitHub 为版本真相 | **已解决** |
| 不想支付 Morgen、Amplenote 等持续订阅 | Fork AGPL-3.0 的 Mindwtr，自有域名和 Cloudflare 免费额度部署 | **已解决个人使用路径**：仍需遵守开源许可证和第三方免费额度政策 |
| 从零开发效率太低 | 复用 Mindwtr 的任务、项目、周期、日历、PWA 和同步框架 | **已解决工程底座问题** |
| 脑中很多事项，但此刻不知道做什么 | NOW 只给出一件当前事项和少量今日承诺 | **已实现 Alpha** |
| Mindwtr 的 GTD、Agenda、Frame、Board 等概念并列，使用时需要反复猜系统 | 内容、状态、时间、注意力分层；一级入口收敛为 NOW、Inbox、Plan，其余能力降级到 More | **已完成第二阶段**：Today 与 Inbox 默认流程已去除旧驾驶舱和 GTD 决策树 |
| “开始时间”同时表示以后出现、日历安排和临时推迟 | 拆为 Available、Scheduled、Snoozed；旧 `startTime` 只作兼容读取 | **已解决新写入语义**：旧数据无需手工迁移 |
| Task 可以直属 Area，但 Projects 中没有自然归宿 | 选择具体领域后显示“领域直属任务”入口与列表 | **已解决桌面端归属** |
| 希望有结构，但不想每分钟被安排 | Flexible Frames 只限定时间段适合的任务类别 | **已实现 Alpha** |
| 会议、课程与任务出现在同一时间视图 | Outlook 导出事件进入现有日历，并参与 NOW | **已实现只读合并** |
| Outlook 学校账号授权失败 | 保留 Graph 适配器代码，正式改用 Power Automate → 私人 Google Drive | **已解决读取**：学校策略仍决定 Graph 能否直连 |
| 公开 Outlook ICS 丢失标题和地点 | 停用旧 ICS，导出最小 JSON 字段 | **已解决正式来源** |
| 是否能从 PWA 写回 Outlook | 规划过独立日历投影和有限双向模型 | **尚未实现** |
| PWA 是否必须部署到 VPS | 静态壳部署在 Cloudflare Pages，自有域名提供稳定入口 | **已解决**：不需要 VPS |
| Cloudflare 会不会保存个人数据 | Pages 只托管静态壳；任务和日历文件由浏览器直连 Drive | **已缩小风险**：broker 仍保存加密刷新令牌和最小推送元数据 |
| 更换 `pages.dev` 地址后本地数据为什么像消失 | 固定使用 `todo.onthat.top`，并用 Google Drive 做跨设备同步 | **已解决入口稳定性** |
| OneDrive 能否作为个人同步后端 | 先用最小 AppFolder 权限实验，遇到真实 Graph `Access denied` | **未作为生产方案**：没有用更宽权限绕过，改用 Google Drive |
| Google Drive 是否需要频繁手动授权 | 单账号 broker 加密保存刷新令牌，浏览器自动领取短时令牌 | **已解决长期授权** |
| iPhone PWA 关闭后是否完全没有通知 | Cloudflare Worker + Web Push 保存最小提醒调度信息 | **已实现**：每台设备需启用；iOS 仍限制任意后台执行 |
| Outlook 与 Google Drive 必须使用同一账号吗 | 学校 Outlook 由 Power Automate 读取，个人 Google Drive 保存私有导出 | **不需要同一账号** |
| 源码应放在哪里，是否长期留在本地 | GitHub 是版本和部署真相；只在需要时临时检出并在验证后删除 | **已采用** |
| 没有统一教程，配置和日常使用割裂 | 本手册统一使用、同步、通知、Outlook、隐私和项目演变 | **本次解决** |

### 最初产品思想保留了什么

最初真正要解决的不是“拥有更多 Todo 功能”，而是建立一个低摩擦的外部注意力系统：

- 记忆交给收集箱；
- 周期性交给周期任务；
- 时间感交给日历；
- 当前行动交给 NOW；
- 宽松结构交给 Flexible Frames；
- 多设备一致性交给 Google Drive；
- 固定会议事实交给 Outlook 只读导入。

因此，评估新功能时应继续问：它是否减少了当前选择负担，还是增加了配置和注意力噪音？

## 当前仍未实现的内容

- 把 PWA 任务时间块写入独立 Outlook 日历；
- 从 Outlook 拖动事件后有限地更新任务安排；
- 原生 iOS Widget、Share Sheet、Shortcuts/Siri 和系统级本地通知；
- OneDrive 生产同步；
- 专门保留原始自由文本并提供结构化建议的 `RawInboxEntry`；
- PWA 浏览器存储从当前上游适配器进一步迁移到 IndexedDB/OPFS 的长期加固；
- 二进制附件的 Google Drive 同步。

这些内容不影响当前的收集箱、项目、周期任务、NOW、Flexible Frames、Google Drive 任务同步、Outlook 只读日历和 Web Push 使用。若以后继续开发，应先根据真实使用摩擦决定优先级，避免为了完善系统而停止使用系统。

## 相关文档

- [Attention Planner Alpha：架构、验证和边界](./attention-planner-alpha.md)
- [Outlook 日历经 Google Drive 导入 PWA](./outlook-google-drive-export.md)
- [隐私说明](./PRIVACY.md)
- [线上隐私政策](https://todo.onthat.top/privacy.html)
- [上游 Mindwtr 文档](https://docs.mindwtr.app/zh-Hans/)
