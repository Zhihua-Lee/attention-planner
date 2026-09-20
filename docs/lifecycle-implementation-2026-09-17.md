# Task lifecycle implementation — 2026-09-17

This document supersedes the old “single scheduledAt / three navigation entries only” implementation notes. The implementation is in the lifecycle UX feature branch, not a claim that main or any production installation has been upgraded.

## Interaction contract

Normal PWA/desktop capture, sidebar capture, project-context capture and the global shortcut route to the same plain-text draft. The advanced syntax/audio capture remains explicitly available. A task name alone can be saved; date intention, reservation, deadline, earliest availability, repeat rule, notes, steps and optional belonging are guided controls, not required syntax. Browser drafts are backed up locally, including unfinished task edits; failed writes retain the draft. A captured-but-unflushed task is retried using its identity instead of creating a second task.

Task titles in the primary Inbox, NOW, day calendar and global search open a single read-first task detail surface. Top-level Back, Close, Escape and browser history share the dirty-draft guard. Explicit content editing submits title/body/step edits together and checks edited fields against the current task. Read-mode checkboxes are separate immediate actions with feedback. Step promotion is an explicit independent action, not a cancellable field edit.

Calendar is a first-class destination, with day/week time overview, appointments and adjacent unscheduled tasks. Empty time slots prefill capture. Clicking a block opens its task and work history; move/resize targets a block, not the task's total estimate. NOW preserves an explicitly chosen current task until it is completed, paused, ineligible or replaced; fixed appointments retain precedence.

## Four responsibilities

Content owns task identity, text, steps, attachments and optional Area/Project belonging. Workflow owns Inbox/Ready/Waiting/Someday/Done; Ready is a clarified task, not a promise of immediate availability. Time owns separate deadlines, availability and identified work allocations. Attention owns dated day intentions and snooze/current-work preferences. Existing planning policy remains the shared eligibility boundary: future/blocked plans stay visible, while NOW applies current execution constraints. Frame preference can use Area/Project selections without command syntax.

Task `planner.version=1` contains independently versioned work blocks and dated intentions. Total estimated task effort is never overwritten by the block's duration. Completing an allocation and completing the task are different commands. Completed/archived/deleted tasks stop contributing active work. Project archive preserves incomplete facts instead of recording false completion. Recurrence creates a successor on completion or explicit skip; stopping recurrence keeps the current task. Skips have no completedAt. Cancelling a block does not cancel its task or recurring series.

## Automatic continuation

Only expired or explicitly interrupted unfinished allocations are candidates. No elapsed clock time is counted as work. Explicitly recorded progress reduces only that allocation. A pure calculation searches the next seven local days for a continuous gap inside user-saved allowed hours, avoids known appointments and other active work, and preserves the block's identity and history. No configured hours, failed calendar reads, workflow/project blocks or no gap produce visible pending reasons. Deadlines are not moved. Undoing an automatic move holds it for manual rescheduling rather than immediately repeating the move.

The runtime runs in the foreground, on resume and after local/sync state changes. **Closed PWA apps do not run a background scheduler.** Cross-device per-block/per-day conflict resolution is deterministic; newer manual revisions outrank stale automatic moves. Manual content versions are separate so automatic schedule revisions cannot resurrect a completed task. The current-work pin and unfinished editing drafts are device-local, not claimed to be cross-device session handoff.

## Upgrade, backup and sync

The first planner mutation verifies a pre-planner backup. Migration is lazy and deterministic: an old timed start becomes `legacy:<task-id>`, exactly once per task. An old undated star is evidence requiring explicit day selection, not a fabricated choice for today. A cancelled migrated block never falls back to a legacy start. Conflicting old schedule values remain evidence in metadata.

SQLite schema is version 12 with the optional JSON `planner` column, carried through shared native serialization, desktop Rust reads/writes, JSON snapshots, normalization, merge and export. PWA uses `attention-planner-data-v2`, copies valid `mindwtr-data` once, and leaves the old browser key untouched. Once v2 exists, old data is not read again. Use exported JSON and the app's import/restore workflow for recovery; do not edit database files live.

All devices sharing upgraded data must run the upgraded client. Dropbox/OneDrive/Google Drive JSON locations use `attention-planner-v2.json`. For WebDAV or file sync, choose an isolated `attention-planner-v2` folder/file on every upgraded device. For self-hosted sync, deploy the upgraded server separately and explicitly configure `/v2/data`; it uses a separate file from `/v1/data` with the same authentication and locking boundary. This change **does not deploy the server or rewrite account settings automatically**. Export a backup before changing locations. The existing v1 task REST/MCP endpoints are not a new planner command API.

CloudKit does not yet carry the planner schema, so upgraded planner uploads are rejected before writing, rather than silently dropping work blocks. Native mobile shares storage, merge and reminder logic, but the new complete interaction surface is the PWA/desktop UI. Do not downgrade a native client against the same upgraded local database. The isolated sync generation protects shared remote data, not arbitrary manual copying of native databases to old applications.

## Verification boundary

### PR #2 review follow-up

- A created-but-unflushed capture is intentionally locked until persistence succeeds. Retry keeps the original task identity; missing/deleted pending tasks keep their draft and require explicit clearing before replacement. Content can be edited from task details after a successful save.
- Discarding content edits removes the persisted browser draft before leaving edit mode, so reload cannot revive discarded content.
- External appointment tiles show location when provided and open read-only full title, time, location and description. Feed descriptions render as text, not executable HTML; this does not grant calendar write access.
- Regression coverage includes failed-write retry after remount, missing pending identity recovery, discard followed by reload, and event details at phone/desktop viewport sizes. Physical iPhone validation remains separate.

Pure planner tests cover multiple blocks, separate progress/completion, future planning, dated commitments, collision checks, safe rollover, manual-over-automatic conflicts, merge symmetry, time semantics, recurrence and non-completion archive. Storage/sync tests cover generation isolation and rejection before unsupported uploads. Browser tests cover phone/desktop capture, common detail/history, atomic edit/cancel, repeated tasks and the whole multi-block journey.

The final PR records exact executed commands and outcomes. Presence of this document/tests is not a claim of passing CI. Real iPhone keyboard/Safari gestures and native OS notification delivery require device verification. No main merge, production deployment, external calendar writes or real user-data migration is performed by development.
