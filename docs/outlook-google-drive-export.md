# Outlook 日历经 Google Drive 导入 PWA

> 日常使用、同步、通知和项目设计的统一入口见 [Attention Planner 中文使用手册](./attention-planner-user-guide-zh.md)。

本文记录已经在线跑通的正式方案：学校 Outlook 日历由 Power Automate 定期导出到个人 Google Drive 的私有文件，再由 Attention Planner PWA 只读加载。

## 数据路径

```text
学校 Microsoft 365 Outlook
        │
        │ Power Automate（每 30 分钟）
        ▼
个人 Google Drive / outlook-calendar.json（私有）
        │
        │ 浏览器直接调用 Google Drive API
        ▼
Attention Planner PWA / Calendar
```

- Outlook 和 Google Drive 可以使用不同账号；本方案正是为“学校 Outlook + 个人 Google Drive”设计。
- Cloudflare Pages 只托管静态 PWA 外壳。
- Cloudflare OAuth broker 只负责长期 Google 授权和短时令牌刷新，不接收任务或日历 JSON。
- 日历是只读导入：PWA 不会修改学校 Outlook 日历，也不会把 PWA 任务写回 Outlook。

## 一、在 PWA 准备导出文件

1. 打开 [Attention Planner](https://todo.onthat.top)。
2. 进入「设置 → 同步」，选择 Google Drive 并连接个人 Google 账号。
3. 确认页面显示“已长期授权”；首次使用可点击“立即同步”。
4. 进入「设置 → 集成 → Outlook → Google Drive」。
5. 点击“准备私有导出文件”。
6. 确认页面显示文件 `outlook-calendar.json` 已准备好。

这一步会在普通“我的云端硬盘”中创建一个默认不共享的文件，并加上应用识别标记。Power Automate 必须更新这一个现有文件，不能在每次运行时创建新文件。

PWA 的 Google 授权包含两个最小用途范围：

- `drive.appdata`：读写隐藏的任务同步数据。
- `drive.file`：访问由 Attention Planner 创建或由用户明确打开的文件，包括这一个日历导出文件；不能浏览整个云端硬盘。

## 二、创建 Power Automate 定时流

在 [Power Automate](https://make.powerautomate.com) 创建“计划的云端流”，连接学校 Outlook 账号和个人 Google Drive 账号。该流程使用标准连接器，不需要 Premium。

### 1. Recurrence

- Frequency：`Minute`
- Interval：`30`

每 30 分钟是当前验证配置。可以降低频率，但过于频繁会增加连接器调用量，并不能让 iOS 在后台实时刷新 PWA。

### 2. Get calendar view of events (V3)：第一页

选择 Office 365 Outlook 的 `Get calendar view of events (V3)`：

- Calendar id：`Calendar`
- Start time：`addDays(utcNow(), -30)`
- End time：`addDays(utcNow(), 365)`
- Max Count：`256`
- Skip Count：`0`

这个连接器单次最多返回 256 条。只使用一个动作时，流程仍会显示“成功”，但 JSON 会在第 256 条处静默截断；事件较密集时，后面的日期或同一天较晚的事件可能消失。因此正式流程必须继续分页。

### 3. Initialize variable：保存第一页

添加 Array 变量 `AllEventsPaged`，初始值为：

```text
body('获取事件的日历视图(V3)')?['value']
```

如果设计器使用英文或生成了不同的动作内部名称，请从动态表达式面板选择第一个日历动作的 `value`，不要手工猜测名称。

### 4. Apply to each：继续读取后续页

添加 `Apply to each`，输入：

```text
range(1,32)
```

循环内按顺序放置三个动作：

1. 第二个 `Get calendar view of events (V3)`：Calendar、Start time 和 End time 与第一页相同；Max Count 为 `256`；Skip Count 为 `mul(item(),256)`。
2. Data Operations 的 `Compose`（中文旧设计器可能显示为“编辑”），输入：

   ```text
   union(variables('AllEventsPaged'), body('获取事件的日历视图(V3)_2')?['value'])
   ```

3. `Set variable`：名称选择 `AllEventsPaged`，值为 `outputs('编辑')`。如果 Compose 的内部名称不是“编辑”，从动态内容中选择它的输出。

保持 Apply to each 的默认顺序执行，不要开启并发；否则多个迭代会同时覆盖同一个数组变量。这个配置读取第一页加 32 个后续页，容量为 8,448 条事件。当前 13 个月窗口约 4,800 条，仍留有余量；若将来达到上限，应增加页数或缩短时间窗口。

### 5. Select

添加 Data Operations 的 `Select`。From 使用 `variables('AllEventsPaged')`，然后只映射以下字段：

| 输出键 | Power Automate 表达式 |
| --- | --- |
| `id` | `item()?['id']` |
| `title` | `item()?['subject']` |
| `start` | `item()?['startWithTimeZone']` |
| `end` | `item()?['endWithTimeZone']` |
| `location` | `item()?['location']` |
| `allDay` | `item()?['isAllDay']` |

不要额外导出正文、参会者、会议链接或组织者。PWA 解析的是 `Select` 产生的 JSON 数组，不需要再套一层对象。

### 6. Update file

添加 Google Drive 的 `Update file`：

- File：选择 PWA 已创建的 `outlook-calendar.json`。
- File content：选择 `Select` 的完整输出。

不要改用 `Create file`。重复创建同名文件会产生副本，新文件也可能没有 PWA 用来定位正式导出文件的应用标记。

保存流程并打开它。使用 Power Automate 的 Flow checker 确认没有错误，然后执行一次手动测试。

## 三、在 PWA 验证

1. 回到 PWA 的「设置 → 集成 → Outlook → Google Drive」。
2. 刷新文件状态，确认“最近更新时间”对应刚才的测试。
3. 打开 Calendar，确认出现来源 `Outlook (Google Drive)`。
4. 抽查标题、时间、地点和全天事件。
5. 确认没有旧来源错误，也没有所有事件都变成 `Private Appointment`。

正式环境已验证：定时流启用，手动测试成功，PWA 能从同一个私有文件加载 Outlook 标题、时间和地点。2026-08-24 的分页修复验收中，流程在 1 分 08 秒内成功完成，PWA 当日视图从 2 项恢复到 6 项，并显示 13:00、13:30、15:00 和 22:30 的事件。

## 安全与隐私边界

- `outlook-calendar.json` 是普通 My Drive 文件，但默认私有；不要创建公开链接或修改共享权限。
- PWA 的 `drive.file` 不能浏览整个 Drive。
- Power Automate 的 Google Drive 连接由 Microsoft 管理，权限通常比 PWA 的 `drive.file` 更宽。这是本方案主要的额外信任边界，因此应只连接受信任的个人 Google 账号，并定期在 Google 账号的第三方访问页面检查该连接。
- 文件只保留日历展示所需的六个字段，降低副本泄露时的影响。
- 传输经过 HTTPS。Cloudflare 不读取日历文件内容。
- 若不再使用本方案，可先关闭 Power Automate 流，再删除其 Google Drive 连接和 `outlook-calendar.json`；删除文件会使 PWA 导入停止。

## 常见问题

### PWA 提示尚未连接 Google Drive

回到「设置 → 同步」检查长期授权状态，必要时点击“立即同步”，再返回集成页刷新文件状态。短时访问令牌会由 broker 自动刷新，正常使用不需要每小时手动重新授权。

### 文件更新时间不变

检查 Power Automate 流是否为 On、最近一次运行是否成功，以及 `Update file` 是否选中了由 PWA 准备的现有文件。不要凭文件名重新创建一个副本。

### 日历中出现 `Private Appointment`

这通常来自旧的公开 ICS 或受租户隐私策略限制的来源，不是本 JSON 导出格式的压缩结果。删除旧 ICS 来源并停用旧的 Microsoft Graph 直连，只保留 `Outlook (Google Drive)`。

### 出现 `Failed to load UIowa Outlook`

这是旧 ICS 地址失效。删除该外部日历来源；正式流程不依赖它。

### 手机是否会每 30 分钟自动刷新界面

Power Automate 会在云端更新 Drive 文件，但 iOS 不允许 PWA 持续执行任意后台任务。打开 PWA、将它切回前台或在应用内刷新时，PWA 会读取最新文件。通知是另一条 Web Push 通道，不由这个日历导出流生成。

### 同一天只有上午事件，下午和晚间事件缺失

先检查 Power Automate 的第一个日历动作是否正好输出 256 条。若是，这不是 PWA 的日期筛选问题，而是 Outlook 连接器的单页上限。确认正式流包含 `AllEventsPaged`、`range(1,32)`、第二个带 Skip Count 的日历动作，以及循环后的 `Select`；不要把 Select 继续连在第一页的 `value` 上。

修复后手动测试流程，并在 PWA 选择一个原本缺失的日期按“日”查看。验收应同时包含同一天较晚事件和课程类重复事件，而不只是检查流程状态为成功。

## 迁移完成后的旧组件

正式来源切换后应保持：

- 旧 `UIowa Outlook` ICS 来源已删除。
- 旧 Microsoft Graph Outlook 直连已停用；学校租户管理员日后批准时仍可重新配置。
- 旧的日历代理 Worker 若仍存在，可在核对准确名称和用途后单独删除；不要误删 PWA 的 OAuth broker、通知 Worker 或 Cloudflare Pages 项目。

