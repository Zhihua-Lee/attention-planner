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

在 [Power Automate](https://make.powerautomate.com) 用学校账号新建“计划的云端流”。用到两个连接：Office 365
Outlook（学校账号）和 Google Drive（你的个人账号）。只用标准连接器，不需要 Premium。

整个流的结构（从上到下）：

```text
重复：每 30 分钟
获取事件的日历视图 (V3)            ← 第一页
初始化变量 AllEventsPaged = 第一页的 value
应用到每一个 range(1,32)            ← 顺序执行
├─ 条件：已读条数 >= 当前轮 × 256
│  ├─ 是：获取事件的日历视图 (V3)   ← 下一页
│  └─ 否：（空）
├─ 撰写：合并已读的和本轮的
└─ 设置变量 AllEventsPaged = 撰写的输出
选择：只留 6 个字段
更新文件：outlook-calendar.json
```

下面的表达式都在“fx / 插入表达式”里填，不加引号，也不套 `@{...}`。表达式里的动作名（如 `获取事件的日历视图(V3)_1`）以你
流里的实际名称为准：英文界面或删改过动作时名字会不同，可以从“动态内容”里点选代替手写。

### 1. 重复（Recurrence）

频率“分钟”，间隔 `30`。触发器的“并发控制”保持默认（关）：设成 1 时，上一次还没结束，新的运行会被直接跳过。

### 2. 获取事件的日历视图 (V3)：第一页

Office 365 Outlook 的“获取事件的日历视图 (V3)”：

- 日历 id：`Calendar`
- 开始时间：`addDays(utcNow(), -30)`
- 结束时间：`addDays(utcNow(), 365)`
- 最大计数：`256`
- 跳过计数：`0`

它一次最多返回 256 条，超出的部分会被悄悄截掉（流程照样显示成功），所以要接着分页。

### 3. 初始化变量

名称 `AllEventsPaged`，类型“数组”，值：

```text
body('获取事件的日历视图(V3)')?['value']
```

### 4. 应用到每一个：按需读后面的页

输入 `range(1,32)`，保持默认的顺序执行（不要开并发，否则几轮会同时改同一个变量）。循环里依次放：

1. **条件**。左边填 `greaterOrEquals(length(variables('AllEventsPaged')),mul(item(),256))`，运算符“等于”，右边填表达式
   `true`。意思是：前面每一页都读满了，才去读下一页。
2. 在条件的**“是”**分支里放第二个“获取事件的日历视图 (V3)”：日历、开始、结束时间和第一页相同；最大计数 `256`；跳过计数
   `mul(item(),256)`。“否”分支留空。
3. 在条件**之后**（分支外、循环内）放数据操作的“撰写”（旧版中文界面叫“编辑”）：

   ```text
   union(variables('AllEventsPaged'), coalesce(body('获取事件的日历视图(V3)_1')?['value'], json('[]')))
   ```

   这轮没去读时，`coalesce` 把空结果当成空列表。

4. “设置变量”：`AllEventsPaged`，值选上一步“撰写”的输出。

最多读第一页加 32 页，共 8,448 条；13 个月的日程通常远少于这个数。如果最后一页仍是满的 256 条，说明还没读完，增加页数或缩短
时间范围。

### 5. 选择（Select）

数据操作的“选择”，从 `variables('AllEventsPaged')`，只映射这 6 项：

| 输出键     | 表达式                         |
| ---------- | ------------------------------ |
| `id`       | `item()?['id']`                |
| `title`    | `item()?['subject']`           |
| `start`    | `item()?['startWithTimeZone']` |
| `end`      | `item()?['endWithTimeZone']`   |
| `location` | `item()?['location']`          |
| `allDay`   | `item()?['isAllDay']`          |

它放在循环**之后**。不要导出正文、参会人、会议链接或组织者。

### 6. 更新文件（Update file）

Google Drive 的“更新文件”：文件选第一部分准备好的 `outlook-calendar.json`，文件内容选“选择”的输出。

不要用“创建文件”：每次都会多出一个同名副本，新文件也没有应用认得的标记，应用读不到。

保存，运行“流检查器”确认没有错误，再点“测试”手动跑一次。正常一两分钟内整体成功。

## 三、回到应用核对

1. Power Automate 里这次运行整体成功，最后的“更新文件”是绿色的。
2. 应用：设置 → 日历 → Outlook 日历 → 刷新，“Power Automate 最近写入”变成刚才的时间。
3. NOW 的日程里抽查几天，包括下午和晚上的日程。
4. 过半小时再看一次“最近写入”，确认定时运行也在写。

“同步与数据”里的“已同步”是任务的同步时间，和 Outlook 无关；Outlook 看“最近写入”。

应用每次同步后会读一次这个文件，最多 10 分钟一次。手机上的应用回到前台或打开时会读到最新的。

## 安全与隐私

- `outlook-calendar.json` 是“我的云端硬盘”里的普通文件，默认私有。不要给它开公开链接或改共享。
- 应用的 `drive.file` 权限只能读写它自己建的文件，不能浏览整个 Drive。
- Power Automate 的 Google Drive 连接由 Microsoft 管理，权限比应用的宽。只连接你信任的个人 Google 账号，并定期在 Google 账号
  的“第三方访问”里检查它。
- 文件里只有日程展示需要的 6 项。
- 不再使用时：关掉流，删除它的 Google Drive 连接和 `outlook-calendar.json`。下次点开“怎么设置 Outlook”时，应用会重新建一个
  空文件。

## 不更新了怎么办

应用里“最近写入”超过 2 小时会标红。按顺序查：

1. **流是否开着**，运行历史里最近几次是成功、失败，还是一直“正在运行”。
2. **一直“正在运行”**（正常一两分钟就完）：先关掉流，在运行历史里取消这些运行（“取消所有流运行”），等列表刷新确认都已取消。
   取消运行不会动 Outlook 日程，也不要删 Drive 里的文件。
3. 点开一次卡住或失败的运行，看停在哪一步：
   - 停在循环里读下一页：检查第 4 步的条件、分支和“撰写”里引用的动作名；
   - 连接报错：在“连接”里重新登录 Office 365 Outlook 或 Google Drive；
   - 提示“检测到触发器并发限制”：把触发器的并发控制改回默认（关）。
4. 打开流，手动测试**一次**，按第三部分核对。还不行就记下停在哪一步、报了什么错，不要反复点测试，会排起更多运行。

**同一天只有上午的日程**：第一页正好 256 条却没有接着读。检查第 4 步。

**手机会不会每 30 分钟自动刷新**：Power Automate 在云端更新文件，但手机不允许网页应用在后台一直运行。打开应用或切回前台时会
读到最新的。
