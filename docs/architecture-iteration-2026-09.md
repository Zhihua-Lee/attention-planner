# September 2026 architecture iteration

## Stage 0: observed baseline

Read-only audit: remote and clean local HEAD `b9cdb39d281445ca57e90d2454565b8215843190`.
No repository `AGENTS.md` was found. Preserve existing content ownership rules,
the shared core / desktop / mobile boundaries, locked dependencies and data.
Canonical product semantics live in `product-model.md`; this document tracks
migration decisions and evidence, not a second product specification.

Source: the user's September 7 ChatGPT attachment, **Attention Planner: 四层架构重构与规划执行闭环实施计划**.

Confirmed gaps:

- R1: `schedule-utils.ts` still reads `startTime` for start notifications.
- R2: desktop `TaskItemFieldRenderer` edits `startTime`; TaskDraft serializes
  untouched time values, including stale compatibility projections.
- R3/U1: mobile NOW omits project checks; both Today implementations use execution
  availability to hide future planning candidates and blocked existing plans.
- R4: documentation checks precede core unit tests; E2E uses old navigation.
- A1: retain `task-container-rules.ts`.
- A2/A3/A5: static workflow, lifecycle and execution rules need one domain boundary;
  generic update still promotes Inbox on time/star edits and removes planning intent.
- A4/U2: no independently identified blocks, dated commitments or safe rollover.

## Ordered implementation and release gates

1. Shared planning/execution queries, regressions, semantic reminder/editor fixes.
2. Independent blocks and dated commitments, versioned dry-run migration, durable
   serialization, two-device merge, restart and backup/restore contracts.
3. Real block editor/calendar and explicit business commands on both clients.
4. Per-block notifications and pure, idempotent rollover with history/undo.
5. CI, integration/E2E, deployment only after the relevant release gates pass.

Do not enable a partly migrated format on production data. Existing Task IDs remain
the recurrence instance identity. Proposed minimum storage is independently merged
block and dated-choice records, not a second Task store. Legacy timed schedules map
to deterministic IDs derived from task identity; explicit cancellation requires a
tombstone, never an empty-field fallback. Legacy stars require one shared migration
anchor recorded in the snapshot, not each device's installation date. Archived
history retains its original completion metadata without guessing user intent.

Before format activation: verify a restorable backup, reject incompatible writers
on both local and remote sync boundaries, and prove unknown records survive all
enabled backends. CloudKit remains unsupported for the new format until its actual
production schema and adapters are verified. Old unversioned clients cannot be made
safe merely by adding fields: rollout needs a separately versioned sync document or
another enforced writer gate. Do not overwrite the live legacy snapshot to test it.

Rollover defaults from the attachment: only remaining explicitly allocated work;
preserve Due and external events; require configured working windows and trustworthy
calendar constraints; search seven local days, otherwise keep visible pending work.
Foreground/resume/post-sync reconciliation only, no claim of closed-PWA execution.

## Verification

Stage-one implementation (no new persistence format enabled):

| Requirement | Evidence / remaining work |
| --- | --- |
| R1 | Single-reservation reminder generation and diagnostics use the semantic time adapter. Move/cancel/suppression regressions pass. Multiple-block effect scheduling awaits stage 4. |
| R2 | Desktop exposes Available and Time block separately; shared drafts omit untouched dates and retain explicit clears. Mobile narrowing preserves clears. Real renderer and adapter tests pass. Import/API legacy writers still need the versioned command migration. |
| R3 | NOW checks strict active projects and ordered predecessors; Today/Plan keep blocked intent, and Calendar candidates no longer confuse stars or availability with reservations. Native device delivery is untested. |
| R4 | Documentation/store checks are a separate CI job; README parity restored. All six existing Web E2E scenarios pass through current navigation (Trash is under Archive, not More). Core translation coverage remains red. |
| A1 | Existing task-container rules retained. |
| A2 | Ready is static workflow; planning and execution have different shared queries. |
| A3 | Domain adapter separates legacy type/lifecycle/workflow for new queries; historical archive write behavior is not yet migrated. |
| A4 | Not implemented: independent TimeBlock records and separated duration/estimate. |
| A5 | Shared read rules landed. Legacy generic Inbox promotion remains explicitly identified as compatibility work; full commands and dated commitments are not complete. |
| D1/D2 | Current clean HEAD audited before edits; baseline findings verified, no reset, data conversion or live account writes. |
| U1 | Future planning and blocked-record retention landed for the transitional single-block model. Full target-date DayPlan and all scheduling-entry availability enforcement remain stage 2/3 work. |
| U2 | Not implemented: automatic rollover, progress/history/undo and multi-device operation convergence. |

Actual local checks:

- `packages/core`: `vitest run --maxWorkers=4` — 1,968 passed, 13 failed,
  4 skipped (1,985 total). All failures are locale override coverage floors
  (vi/es/hi/ar/de/ru/ja/pt/pl/cs/ko/it/tr). No thresholds were lowered.
- `apps/desktop`: TaskItemFieldRenderer + TodayPlanView — 90/90 passed.
- `apps/mobile`: task-edit suite + calendar-task-items — 126/126 passed.
- `playwright test --workers=1` — 6/6 passed, including browser contrast,
  NOW startup, Plan navigation, Inbox create/delete, Trash restore and search.
- `desktop:web:build` — passed (existing chunk-size/import warnings).
- `docs:check-readme`, `schema:check`, desktop TypeScript and changed-file
  desktop ESLint — passed. Native iOS/Android installation, notification delivery,
  real-account sync and complete multi-block E2E have not been verified.

Acceptance coverage: T01/T02/T12/T22/T23 have transitional query/component
regressions; T13/T15/T16 have single-reservation reminder/editor contracts;
T24 has separated CI jobs and actual navigation E2E. None of these substitutes
for the unimplemented multi-block, dated-plan, rollover and migration scenarios
T03–T11/T14/T17–T21. Existing recurrence behavior was not replaced.

Release: this iteration is a reviewable source branch, not an activation of the
complete architecture plan. No Cloudflare deployment or production-data migration
is performed from this partial milestone.
