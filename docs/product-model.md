# Attention Planner 产品模型

本文件是 Attention Planner 的产品概念基线。界面、文案和后续功能应先服从这套模型，再考虑兼容上游 Mindwtr 的实现。

## 一句话原则

**内容说明事情是什么，状态说明现在能不能做，时间说明什么时候发生，注意力说明此刻看什么。四层互不替代。**

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

### 2. 状态层：现在能不能做

| 用户概念 | 含义 | 当前存储值 |
| --- | --- | --- |
| Inbox | 尚未判断 | `inbox` |
| Ready | 现在可以行动 | `next` |
| Waiting | 被别人或条件阻塞 | `waiting` |
| Someday | 主动搁置 | `someday` |
| Done | 已完成 | `completed` |

`Reference` 是资料类型，`Archived` 是保存方式；它们不是行动状态。为了兼容已有数据和同步格式，本次重构只把界面中的 “Next” 改名为 “Ready”，不迁移底层枚举。

### 3. 时间层：什么时候发生

- **Event**：会议、课程等外部硬约束，只读显示。
- **Time Block**：为某个 Task 预留的软安排；当前由任务的开始时间和预计时长表示。
- **Due**：真正的最后期限，不等于想做的时间。
- **Recurrence**：完成或到期后生成下一次任务的规则。

时间属性不会改变任务在 Area—Project—Task 中的位置，也不会自动改变它的行动状态。

### 4. 注意力层：现在看什么

- **Today commitments**：今天主动承诺关注的少量任务；当前复用焦点星标。
- **NOW**：根据正在发生的事件、已安排任务、Today commitments、Frame 和 Ready 任务，给出一个当前建议。
- **Frame**：某段时间适合哪类任务的后台选择规则，不是用户必须把任务放进去的容器。
- Priority、energy、estimate、context、tag 是可选筛选信息，不进入默认工作流。

## 三个一级入口

### NOW

执行面。只回答“现在做什么”：一个当前建议，加上少量 Today commitments。它不显示全量 Ready 列表，不在这里管理 Frame，也不承担日程规划。

### Inbox

捕获面。想到事情先写下来，稍后再决定动作、状态、项目和时间。

### Plan

规划面。包含五个页签：

- **Today**：选择今日承诺、查看已安排与 Ready 任务，并管理 Frame；
- **Calendar**：查看外部事件和带时间的任务；
- **Projects**：管理 Area—Project—Task 内容层；
- **Later**：处理 Waiting 与 Someday；
- **Recurring**：检查周期任务。

Review、Contexts、Board、Reference 等上游能力保留在折叠的 **More** 中，作为高级工具，而不是一级心智入口。

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

- 不修改任务、项目、同步或 Google Drive 文件格式，已有数据无需迁移。
- `agenda` 路由继续存在，但产品名称为 NOW；旧链接仍可打开。
- `next` 状态继续存储，但面向用户显示 Ready。
- Board、Matrix、Contexts、Reference 等功能没有删除，只从默认导航降级。
- Outlook/Google Drive 日历事件仍是只读时间约束；本次重构不改变同步协议。

## 后续设计约束

新增功能前必须回答它属于内容、状态、时间还是注意力层。若一个功能同时要求用户理解多层概念，应拆分到 Plan 的对应位置；除非它直接服务“当前一件事”“快速捕获”或“规划”，否则不新增一级入口。
