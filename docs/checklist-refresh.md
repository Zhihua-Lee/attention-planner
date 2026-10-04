# Repeat / 重复

A task's **Repeat / 重复** property has one menu with three modes:

- **None / 不重复.**
- **Reopen / 原地重开.** The same task and checklist start a new round; each round keeps its own checkmarks and history. Stored as `Task.planner.checklistRefresh` (below).
- **New copy / 新建一份.** Completing the task creates the next one. Stored as the existing `Task.recurrence`.

Both modes share one form, each setting once: **Frequency / 频率** (daily, weekly, monthly, yearly; hourly only for Reopen counted from completion), **Every / 每隔**, **Count from completion / 从完成后计时**, weekdays or day of month for calendar rules, and **Ends / 何时停止** (never, on a date, or — New copy only — after a number of times). Reopen keeps start date, refresh time, time zone and pause under **More / 更多**. A new rule repeats daily from today at 00:00 in the device zone. Explanations live in (i) tips, not in the labels. The capture sheet offers the same menu.

Each checklist step has a ↻ button: **Follow task / 跟随任务** (default), **Own rule / 单独**, or **None / 不重复**. A step with its own rule shows a chip and its own round line. Rules never cross tasks: a task link (`parentTaskId`) is only a visual pointer and passes nothing on.

Switching away from "Reopen" freezes the current round's checkmarks as ordinary checklist values. While the menu stays open, cadence edits share one schedule version, and returning to the cadence it opened with keeps the current round's marks.

For a 1560 teaching checklist: Reopen, weekly on Tuesday and Thursday, ends on 2026-12-10; under More, a start date, 06:00 and `America/Chicago`.

## End dates

The end date is inclusive in the rule's time zone. A step following the task follows its end date; a step with its own rule has its own end. Changing only the end date does not create a new schedule version or erase completion records. Moving an end date into the past shows the last eligible round; extending it may expose a later round, without rewriting older marks. The former bulk end-date sync dialog was removed.

## The task's own round

A task that reopens in place has its own round, marked with **Complete current round / 完成本轮** (also on cards and in NOW). It is complete when every step on the same cycle is checked; a task without steps keeps its own mark under the reserved item ID `@task`. The repeat row shows "this round · next" and, after the first round, a completion history.

## Periods, completion and safety

The current checkbox is keyed by item ID, schedule version and scheduled local date. A Tuesday completion cannot complete Thursday. Checked and unchecked changes are revisioned per period for merging and guarded undo. The PWA task card, NOW checklist and task detail share these semantics. Completing a repeating list's current round does not mark its task permanently done, spawn a task, or rewrite its work blocks. Completed rounds are excluded from NOW suggestions until a new period is due.

Changing cadence, start date, refresh time or timezone starts a new schedule version. Changing end or pause does not. Pausing a list freezes all of its items until resumed; resuming catches up to the current calendar period rather than creating missed tasks. The end date includes the entire local day in the rule's timezone. Afterwards the final period stays visible. To permanently complete a repeating list, first set Repeat to **None**; this freezes current checkboxes as ordinary checklist values. Explicit deletion/archiving from another surface is respected and never automatically reversed.

Content editing captures the displayed period along with its draft. Unchanged old checkboxes are ignored on text-only saves across a refresh boundary. Explicit checkbox edits cannot be silently applied to a different period or overwrite a conflicting newer same-period mark. Empty saved rows still disappear; retained history never recreates deleted rows or tasks.

The existing planner clock refreshes while the app is open and on focus/visibility resume. No background process or push notification is required; reopening after offline time computes the current period directly. Refresh and reminders are not the same operation. Fixed IANA timezones are independent of the device timezone; a repeated DST time opens one period, and a nonexistent local time uses the first existing minute after the gap. Nonexistent monthly dates are skipped.

## Count from completion / 从完成后计时

Check **Count from completion / 从完成后计时**, then set an amount in hours, days, weeks or months. The first round starts at the chosen start date and time. A round counts as complete once every item that follows this rule is checked. The next round starts that long after the last of those checks. Until then, the completed round stays visible, labelled with its next refresh time.

- **No missed rounds.** A list left unfinished keeps its current round indefinitely; it never piles up missed rounds.
- **Daylight saving.** Days and longer are counted on the rule timezone's wall clock, so 10:15 plus one day stays 10:15 across a DST change. A month is clamped to the end of a shorter month: Jan 31 plus one month is Feb 28/29. Hours are exact elapsed time.
- **Items.** An item with its own after-completion rule forms its own round and does not wait for the rest of the list.
- **Round IDs.** Rounds are numbered (`<schedule>/r1`, `r2`, …) rather than dated, so an undo followed by a re-check never orphans marks.
- **Pause, end date, history.** Pause and end date behave as in calendar mode. History shows the rounds actually reached.

Older clients that do not know `anchor: "completion"` or `frequency: "hourly"` reject that planner record, so update every client before using this mode.

## Storage and compatibility

Versioned data lives at `Task.planner.checklistRefresh`, in the already-synced planner JSON. This avoids new SQLite columns and does not add fields that older checklist row codecs would strip. Planner validation and merging explicitly preserve the data. Policies merge independently per list/item; completion records merge per item and occurrence. Display shows the latest eight periods, including derived missed rounds of the current schedule. Stored completion marks from prior schedule versions are retained without truncation; old-rule missed rounds are not exhaustively materialized.

Use updated clients when editing/syncing this feature. Legacy clients that rewrite planner JSON without preserving new fields are not guaranteed safe writers. Native/legacy task UIs are not upgraded here to display period checkboxes; the implementation targets the PWA planner surfaces. Notifications, server scheduling, exhaustive historical analytics, and retroactive task creation are outside this feature.

## Verification

The pure recurrence and draft/planner integration tests cover weekday rounds, inclusive independent ends, the task's own round, offline catch-up, pause, timezones/DST, long intervals, ledger merging, editor conflicts and deletion. Browser regressions cover desktop/mobile, the repeat menu for tasks, steps and capture, current-round completion, reload, and a content draft crossing a boundary. Run the committed tests with the repository's normal Vitest and Playwright setup. Cloud fallback execution uses Node's test runner for the dependency-free test bodies; it is not a substitute for a complete React build or browser run.
