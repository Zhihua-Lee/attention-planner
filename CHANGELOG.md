# 更新记录 / Changelog

Attention Planner 的变化，按合并的 PR 记录，最新的在前。线上版本即 `main` 最新部署到 [todo.onthat.top](https://todo.onthat.top) 的提交。Mindwtr 上游的历史发布说明保留在 [`docs/release-notes/`](./docs/release-notes/README.md)，不代表本项目的版本。

## 2026-09-29

- **Notion 式任务页面**（[#13](https://github.com/Zhihua-Lee/attention-planner/pull/13)）：
  - 去掉全局编辑模式，标题、正文、步骤和属性都在原处编辑并自动保存。
  - 新增顶部“撤销”（也可以在输入框外按 Ctrl/Cmd+Z），以及全局的 Ctrl/Cmd+S 保存。
  - 清单步骤支持 Shift+Enter 换行。

## 2026-09-28

- **用任务关联替代独立子任务**（[#12](https://github.com/Zhihua-Lee/attention-planner/pull/12)）：
  - 关联只是一个指针，平铺列表里两个任务排在一起，不再有嵌套的子任务。
  - 清单刷新不再跨任务继承。
  - 点击文字即可编辑，只有复选框会勾选步骤。
- **清单完成后相隔一段时间再刷新**（[#11](https://github.com/Zhihua-Lee/attention-planner/pull/11)）：
  - 新增按小时、天、周或月间隔刷新。
  - 同时修复：停止刷新时冻结当前勾选状态；混合清单里完成本轮不影响一次性步骤；未知时区不再让数据读不出来。

## 2026-09-27

- **NOW 显示今天剩余安排**（[#10](https://github.com/Zhihua-Lee/attention-planner/pull/10)）：
  - NOW 页面列出今天剩余的日程、工作时段、全天事件和“今天想做”。
  - 选了日期的新任务不再被强制加入待办。
- **清单逐项定时刷新**（[#9](https://github.com/Zhihua-Lee/attention-planner/pull/9)）：
  - 按日历周期刷新，每轮单独记录完成情况，支持结束日期和批量同步。
  - 顺序项目和已结束清单的完成逻辑也一并修正。
- **清除空清单、按拖拽落点换序**（[#8](https://github.com/Zhihua-Lee/attention-planner/pull/8)），并优化了 PWA 界面。

## 2026-09-26

- **远程 MCP**（[#6](https://github.com/Zhihua-Lee/attention-planner/pull/6)、[#7](https://github.com/Zhihua-Lee/attention-planner/pull/7)）：
  - ChatGPT 和 Codex 可以读取任务、新建收集箱草稿；修改已有数据要账号所有者确认。
  - 默认关闭。
  - OAuth 和确认页面不进入离线缓存。
- **任务卡片更清晰**（[#5](https://github.com/Zhihua-Lee/attention-planner/pull/5)），并恢复了“移回收集箱”的往返操作。

## 2026-09-22

- **Windows 和手机上的 PWA 交互打磨**（[#4](https://github.com/Zhihua-Lee/attention-planner/pull/4)）：这一版引入的独立子任务，已在 #12 中改为任务关联。
- **修复日历重叠和手机界面溢出**（[#3](https://github.com/Zhihua-Lee/attention-planner/pull/3)）。

## 2026-09-20

- **任务生命周期、多时段计划和安全顺延**（[#2](https://github.com/Zhihua-Lee/attention-planner/pull/2)）。

## 2026-08-26

- **以 NOW、收集箱、计划为中心重构**（[#1](https://github.com/Zhihua-Lee/attention-planner/pull/1)）：从 Mindwtr v1.1.5 分出 Attention Planner。
