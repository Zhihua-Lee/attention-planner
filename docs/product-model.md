# Attention Planner 产品模型

本文件是 Attention Planner 的产品概念基线。界面、文案和后续功能应先服从这套模型，再考虑兼容上游 Mindwtr 的实现。

## 一句话原则

**内容说明事情是什么，状态说明工作流阶段，时间说明执行约束与安排，注意力说明此刻看什么。可以提前规划，不代表现在就该执行。**

## 四层模型

### 1. 内容层：事情是什么

```text
Area（长期领域）
└─ Project（有明确终点的成果）
   └─ Task（可以直接执行的动作）
      └─ Checklist（任务内部步骤）
```

- 一次性任务可以直接属于 Area，不必为它创建 Project。
- Inbox 只是尚未整理的入口，不是内容层级。
- Tag、Context 是可选检索信息，默认不参与主导航。

#### Task 内部：标题、正文与可选步骤

- `title` 是一句任务名称；收起的任务行、NOW 和日历不拼入正文。
- `description` 是独立正文，编辑时固定在标题下方，支持 Markdown、链接和缩进列表；旧描述原样保留，不迁移或拆分既有长标题。
- `checklist` 是可选的一层步骤，编辑器默认折叠；只有勾选状态，没有独立排程、提醒或 NOW 资格。勾完步骤不等于完成任务。
- PWA 中步骤旁的“提升为独立任务（移到收件箱）”会将该步骤从原清单移出，并在同一存储快照创建 Inbox 任务。保留原领域／项目／分区，不复制父任务的日期、周期、提醒或今日承诺；新任务需要再整理。已完成或空白步骤不能提升。
- 创建和编辑共用内容层布局。添加弹窗和列表的“正文与步骤”入口允许创建前填写正文和清单；创建草稿不会调用任务更新或提升动作，点击保存后才一次创建完整任务，取消不留下任务。只填标题的回车快速添加保留。
- 编辑既有任务时，标题和正文通过保存按钮提交；Checklist 沿用即时保存。步骤提升是即时操作，不受编辑器取消按钮撤销。新建草稿不使用此即时保存语义。
- 暂不引入父子任务树或无限递归。正文中的多层列表只是内容，不产生新的任务记录。原生手机编辑器仍沿用既有界面，此处新增交互面向桌面及手机浏览器 PWA。

### 2. 状态层：工作流阶段

| 用户概念 | 含义 | 当前存储值 |
| --- | --- | --- |
| Inbox | 尚未判断 | `inbox` |
| Ready | 已澄清、没有已知工作流阻塞；允许未来才可用 | `next` |
| Waiting | 被别人或条件阻塞 | `waiting` |
| Someday | 主动搁置 | `someday` |
| Done | 已完成 | `done` |

`Reference` 是资料类型，`Archived` 是保存方式；它们不是用户需要在默认流程中判断的行动状态。兼容层仍保留 `reference` 与 `archived` 两个历史存储值，高级视图也仍能读取它们；“Ready”继续使用已有的 `next` 存储值。

### 3. 时间层：什么时候发生

- **Event**：会议、课程等外部硬约束，只读显示。
- **Available**：最早执行时间，存储为 `availableAt`。Ready 任务在此之前也可以查看、加入计划和安排未来时间，但 NOW 不推荐执行。
- **Time Block / Scheduled**：为某个 Task 预留的工作安排。过渡版本仍只有一个 `scheduledAt`，时长仍由预计时长表示；独立多块、总工时与单块时长分离属于下一阶段，尚未启用。
- **Snoozed**：只在一小段时间内从 NOW 隐藏；存储为 `snoozedUntil`，不移动时间块。
- **Due**：真正的最后期限，不等于想做的时间。
- **Recurrence**：完成或到期后生成下一次任务的规则。

时间属性不会改变任务在 Area—Project—Task 中的位置。默认 Inbox 整理中的 Later 会把任务澄清为 Ready 并填写 `availableAt`；Calendar 和 Plan → Today 的 Schedule 只写 `scheduledAt`；NOW 的 Later 只写 `snoozedUntil`。只设置 Available 的周期任务也会生成下一次可用日期预览，但不会因此在 Calendar 中伪造时间块。

旧任务的 `startTime` 继续兼容读取：仅日期解释为 Available，带钟点解释为 Scheduled；上述默认流程不再写入它。取消安排时同时清除 `scheduledAt` 和带钟点的旧 `startTime`，避免旧值把时间块重新带回来；仅日期的旧 `startTime` 会保留，因为它仍表示 Available。高级编辑器和上游导入路径仍保留旧字段，等待后续兼容迁移。

### 4. 注意力层：现在看什么

- **Today commitments**：今天主动承诺关注的少量任务；当前复用焦点星标。
- **NOW**：按“正在发生的事件 → 已安排任务 → 当前 Frame → Today commitments → Ready”给出一个当前建议。Frame 先于 Today，是为了让时间段规则真正能够生效。
- **Frame**：某段时间适合哪类任务的后台选择规则，不是用户必须把任务放进去的容器。
- Priority、energy、estimate、context、tag 是可选筛选信息，不进入默认工作流。

规划与执行不再共用结果集合。共享领域规则区分可见记录、新增规划候选与当前执行资格：未来 Available 的 Ready 任务可以提前规划；Waiting、Someday 或暂停项目的已有承诺／时间块保留，并显示阻塞原因。改变 Available 或转为 Waiting 不自动取消规划意图。新增候选要求活动项目；NOW 还检查顺序步骤、Available、Snooze 和未来时间块，不能靠加星越过这些约束。只有关闭／删除任务才从活动规划中移除。

### 本轮迁移状态与目标契约

本轮已拆开规划／执行查询，并修复语义开始提醒和桌面时间控件；没有升级用户数据格式。完整迁移决策与验收证据见 [阶段记录](./architecture-iteration-2026-09.md)。下面是目标，不代表已部署功能：

- 一个 Task 可有多个独立 ID 的 TimeBlock，任务总预计工时与每次分配量分离；完成本次块不等于完成任务。
- Today 承诺具有本地日期，不再永久复用布尔星标；旧星标的日期只能用跨端一致的迁移标记锚定，不能猜测原始日期。
- 过期块只续排其未完成分配量，保留历史和 Due，不移动会议、不复制 Task、不触发下一周期；无合法时段时保持可见的待续排。
- 自动续排先限定前台／恢复／同步后的幂等补算，不宣称关闭 PWA 后仍自动重排。
- 启用新格式前，必须完成可验证备份、版本化 dry-run 迁移、跨端合并和旧客户端写入隔离。现阶段的单块与布尔星标兼容格式不能冒充目标模型。

## 三个一级入口

### NOW

执行面。只回答“现在做什么”：一个当前建议，加上少量 Today commitments。它不显示全量 Ready 列表，不在这里管理 Frame，也不承担日程规划。

### Inbox

捕获面。想到事情先写下来。默认整理只要求四选一：Ready、Later、Someday、Trash；标题与说明可以顺手澄清。项目、领域、委派、Reference、两分钟规则、标签、情境、优先级、精力和时长只放在“更多”的高级整理流程中。

### Plan

规划面。包含五个页签：

- **Today**：只处理今日承诺、时间块与 Ready 任务，不承载筛选器、保存视图、Top 3、Pomodoro、Review 或 Frame 编辑器；Ready 默认先显示 12 项，并提供明确的“查看全部／收起”出口；
- **Calendar**：查看外部事件和带时间的任务；
- **Projects**：管理 Area—Project—Task 内容层；
- **Later**：处理 Waiting 与 Someday；
- **Recurring**：检查周期任务。

Review、Contexts、Board、Reference 等上游能力保留在折叠的 **More** 中，作为高级工具，而不是一级心智入口。

桌面/PWA 与原生手机端遵守同一入口结构。手机底栏显示 NOW、Inbox、居中的 Capture 动作、Plan 和 More；旧 Focus 驾驶舱仍可从 More 打开，用于兼容筛选、Review 与 Pomodoro，但不再是冷启动主页或默认 Today。

## 日常最短路径

```text
想到事情 → Inbox 捕获
          ↓
       Plan 整理和承诺
          ↓
       NOW 执行一件事
          ↓
       完成后回到 NOW
```

每周回顾仍可使用 More → Review 检查项目、Waiting、Someday、周期任务和未来日历。

## 兼容与迁移边界

- Google Drive/JSON 与 SQLite 同步格式新增 `availableAt`、`scheduledAt`、`snoozedUntil` 三个可选字段；已有数据无需手工迁移，旧 `startTime` 由兼容读取规则解释。共享 TaskTime 适配层负责语义读取、写入和取消安排，TaskDraft 与手机 Calendar 不再各自解释旧字段。Apple CloudKit 生产 schema 本次不扩展，避免把未经 Dashboard 发布的字段伪装成已部署。
- `agenda` 路由继续存在，但产品名称为 NOW；旧链接仍可打开。
- `next` 状态继续存储，但面向用户显示 Ready。
- `reference` 与 `archived` 继续作为兼容存储值存在，但不进入默认 Inbox 决策。
- Frame 编辑移动到「Settings → GTD」，日常使用时只在 NOW 后台参与选择。
- Board、Matrix、Contexts、Reference 等功能没有删除，只从默认导航降级。
- Outlook/Google Drive 日历事件仍是只读时间约束；本次重构不改变同步协议。

## 后续设计约束

新增功能前必须回答它属于内容、状态、时间还是注意力层。若一个功能同时要求用户理解多层概念，应拆分到 Plan 的对应位置；除非它直接服务“当前一件事”“快速捕获”或“规划”，否则不新增一级入口。
