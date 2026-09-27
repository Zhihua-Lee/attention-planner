# Checklist refresh / 清单定时刷新

Open a task's existing details, then **Checklist refresh / 清单定时刷新**. Choose the list default or one checklist item. Child lists are the existing independent tasks linked by `parentTaskId`; configure a child in its own details. No new list entity, alternate UI, or task-copying job is introduced.

For a 1560 teaching checklist, choose an independent weekly rule, Tuesday and Thursday, an explicit start date, 06:00, and `America/Chicago`. Time is illustrative and editable. Each item can follow the list, use its own daily/weekly/monthly/yearly calendar rule, or not refresh. The existing recurrence picker is reused in fixed-calendar mode. Whole-task recurrence remains a separate feature.

## End dates and inheritance

The label is **End date / 结束日期**, not a semester-specific field. Cadence and end date inherit independently through parent list → child list → item. Each level can inherit, set its own inclusive local end date, or explicitly choose no end date. A child's explicit end can extend past its parent's date; the parent date is a default, not a hard cap. Changing only the end date does not create a new schedule version or erase completion records. Moving an end date into the past shows the last eligible round; extending it may expose a later calendar round, without rewriting older marks.

**Batch sync end dates / 批量同步结束日期** selects list defaults and/or items within the current subtree. Preview shows both explicit replacements and indirect effects on inheriting children. No write occurs before confirmation. Only selected stored end policies are replaced; their cadence, pause state and history are retained. Independent overrides on unselected children remain intact. Unselected inheritors still follow their updated parent default. Changed destinations, policies, inheritance, or affected scope invalidate the preview and require review again.

## Periods, completion and safety

The current checkbox is keyed by item ID, schedule version and scheduled local date. A Tuesday completion cannot complete Thursday. Checked and unchecked changes are revisioned per period for merging and guarded undo. The PWA task card, NOW checklist and task detail share these semantics. Completing a repeating list's current round does not mark its task permanently done, spawn a task, or rewrite its work blocks. Completed rounds are excluded from NOW suggestions until a new period is due.

Changing cadence, start date, refresh time or timezone starts a new schedule version. Changing end or pause does not. Pausing a list freezes its subtree until resumed; resuming catches up to the current calendar period rather than creating missed tasks. The end date includes the entire local day in the rule's timezone. Afterwards the final period stays visible. To permanently complete a repeating list, first choose **Do not refresh**; this freezes current checkboxes as ordinary checklist values. Explicit deletion/archiving from another surface is respected and never automatically reversed.

Content editing captures the displayed period along with its draft. Unchanged old checkboxes are ignored on text-only saves across a refresh boundary. Explicit checkbox edits cannot be silently applied to a different period or overwrite a conflicting newer same-period mark. Empty saved rows still disappear; retained history never recreates deleted rows or tasks.

The existing planner clock refreshes while the app is open and on focus/visibility resume. No background process or push notification is required; reopening after offline time computes the current period directly. Refresh and reminders are not the same operation. Fixed IANA timezones are independent of the device timezone; a repeated DST time opens one period, and a nonexistent local time uses the first existing minute after the gap. Nonexistent monthly dates are skipped.

## Storage and compatibility

Versioned data lives at `Task.planner.checklistRefresh`, in the already-synced planner JSON. This avoids new SQLite columns and does not add fields that older checklist row codecs would strip. Planner validation and merging explicitly preserve the data. Policies merge independently per list/item; completion records merge per item and occurrence. Display shows the latest eight periods, including derived missed rounds of the current schedule. Stored completion marks from prior schedule versions are retained without truncation; old-rule missed rounds are not exhaustively materialized.

Use updated clients when editing/syncing this feature. Legacy clients that rewrite planner JSON without preserving new fields are not guaranteed safe writers. Native/legacy task UIs are not upgraded here to display period checkboxes; the implementation targets the PWA planner surfaces. Notifications, server scheduling, exhaustive historical analytics, and retroactive task creation are outside this feature.

## Verification

The pure recurrence and draft/planner integration tests cover weekday refresh, inclusive independent ends, selected batch writes and inherited effects, stale previews, offline catch-up, pause, timezones/DST, long intervals, ledger merging, editor conflicts and deletion. Browser regressions cover desktop/mobile, settings persistence, current-round completion, reload, end-date preview/cancel/confirm, and a content draft crossing a boundary. Run the committed tests with the repository's normal Vitest and Playwright setup. Cloud fallback execution uses Node's test runner for the dependency-free test bodies; it is not a substitute for a complete React build or browser run.
