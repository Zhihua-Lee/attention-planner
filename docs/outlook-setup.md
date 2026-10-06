# Outlook 日历：经 Google Drive 导入

学校的 Outlook 往往不允许把日历发布成订阅链接（.ics），所以换一条路：Power Automate 定时把 Outlook 日程写进你 Google
Drive 里的一个私有文件，Attention Planner 连上同步后读这个文件。只读：应用不会改动你的 Outlook。

```text
学校 Microsoft 365 Outlook
        │  Power Automate（每 30 分钟）
        ▼
你的 Google Drive / outlook-calendar.json（私有）
        │  应用用同步时的 Google 授权读取
        ▼
Attention Planner：NOW 的日程、找时间、AI 的 agenda
```

Outlook 和 Google Drive 可以是不同的账号，这正是为“学校 Outlook + 个人 Google Drive”设计的。

## 一、在应用里准备文件

1. 设置 → 同步与数据 → 同步 → 连接，登录 Google。
2. 设置 → 日历 → Outlook 日历 → 点开“怎么设置 Outlook”。

打开时应用会检查你的 Google Drive：还没有 `outlook-calendar.json` 就新建一个（在“我的云端硬盘”里，不共享），并给它打上
应用认得的标记；已经有了就什么都不做。

为什么要由应用来建：应用的 Google 权限很窄，只能读写它自己建的文件（`drive.file`），看不到你 Drive 里的其他东西。
Power Automate 自己建的文件，应用读不到。所以先由应用建好，再让 Power Automate 每次“更新”这同一个文件。

## 二、在 Power Automate 里建定时流

在 [Power Automate](https://make.powerautomate.com) 用学校账号新建“计划的云端流”，连接学校 Outlook 和你的个人 Google
Drive。只用标准连接器，不需要 Premium。

### 1. 重复（Recurrence）

- 频率：分钟（Minute）
- 间隔：`30`

### 2. 获取事件的日历视图 (V3)：第一页

Office 365 Outlook 的“获取事件的日历视图 (V3)”（Get calendar view of events (V3)）：

- 日历 id：`Calendar`
- 开始时间：`addDays(utcNow(), -30)`
- 结束时间：`addDays(utcNow(), 365)`
- 最大计数（Max Count）：`256`
- 跳过计数（Skip Count）：`0`

它一次最多返回 256 条。只用这一个动作时，流程也会显示“成功”，但超过 256 条的部分会被悄悄截掉，比如某天下午和晚上的日程
不见了。所以要继续分页。

### 3. 初始化变量：存第一页

加一个数组（Array）变量 `AllEventsPaged`，初始值：

```text
body('获取事件的日历视图(V3)')?['value']
```

英文界面或动作名称不同时，从动态内容里选第一个日历动作的 `value`，不要手写名称。

### 4. 应用到每一个（Apply to each）：读后面的页

输入：

```text
range(1,32)
```

循环里依次放三个动作：

1. 第二个“获取事件的日历视图 (V3)”：日历、开始、结束时间和第一页一样；最大计数 `256`；跳过计数 `mul(item(),256)`。
2. 数据操作的“撰写”（Compose，旧版中文设计器可能叫“编辑”）：

   ```text
   union(variables('AllEventsPaged'), body('获取事件的日历视图(V3)_2')?['value'])
   ```

3. “设置变量”：选 `AllEventsPaged`，值为上一步的输出（`outputs('编辑')`，或从动态内容里选）。

保持循环默认的按顺序执行，不要开并发，否则几轮会同时改同一个变量。这样最多读第一页加 32 页，共 8,448 条；13 个月的日程
通常远少于这个数。不够时加页数或缩短时间范围。

### 5. 选择（Select）

数据操作的“选择”。从（From）填 `variables('AllEventsPaged')`，只映射这 6 项：

| 输出键     | 表达式                         |
| ---------- | ------------------------------ |
| `id`       | `item()?['id']`                |
| `title`    | `item()?['subject']`           |
| `start`    | `item()?['startWithTimeZone']` |
| `end`      | `item()?['endWithTimeZone']`   |
| `location` | `item()?['location']`          |
| `allDay`   | `item()?['isAllDay']`          |

不要导出正文、参会人、会议链接或组织者。输出就是一个数组，不用再套一层。

### 6. 更新文件（Update file）

Google Drive 的“更新文件”：

- 文件：选第一部分准备好的 `outlook-calendar.json`。
- 文件内容：“选择”的输出。

不要用“创建文件”：每次都会多出一个同名副本，新文件也没有应用认得的标记，应用读不到。

保存并打开流程，用“流检查器”确认没有错误，再点“测试”手动跑一次。

## 三、回到应用核对

1. 设置 → 日历 → Outlook 日历 → 刷新，应显示“更新于 …”。
2. 打开 NOW 的日程，抽查标题、时间、地点和全天日程。
3. 如果某天只有上午的日程，多半是分页没接好：看第一个日历动作是不是正好输出了 256 条，再按上面第 3、4 步检查。

应用每次同步后会读一次这个文件，最多 10 分钟一次。手机上的应用在后台不会自己刷新，回到前台或打开时会读到最新的。

## 安全与隐私

- `outlook-calendar.json` 是“我的云端硬盘”里的普通文件，默认私有。不要给它开公开链接或改共享。
- 应用的 `drive.file` 权限只能读写它自己建的文件，不能浏览整个 Drive。
- Power Automate 的 Google Drive 连接由 Microsoft 管理，权限通常比应用的更宽。这是这条路额外要信任的一环：只连接你信任的
  个人 Google 账号，并定期在 Google 账号的“第三方访问”里检查它。
- 文件里只有日程展示需要的 6 项，万一副本泄露，影响也小。
- 不再使用时：先关掉 Power Automate 流，再删除它的 Google Drive 连接和 `outlook-calendar.json`。下次点开“怎么设置
  Outlook”时，应用会重新建一个空文件。

## 常见问题

**文件的更新时间不变**：看 Power Automate 流是否开着、最近一次是否成功，以及“更新文件”是否选的是应用准备的那个文件。

**同一天只有上午的日程**：见上面“回到应用核对”的第 3 条。

**手机会不会每 30 分钟自动刷新**：Power Automate 在云端更新文件，但手机不允许网页应用在后台一直运行。打开应用或切回前台
时会读到最新的。
