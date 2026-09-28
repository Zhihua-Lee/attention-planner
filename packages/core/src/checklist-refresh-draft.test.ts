import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import type { Task } from './types';
import { checklistContentDraftPatch } from './checklist-refresh-draft';
import { mergeTaskPlanners, readTaskPlanner, taskPlanner } from './planner';
import { changeChecklistCompletion, checklistDraftState, checklistEndImpact, checklistEndPreview, checklistEndUpdates,
    checklistItemState, projectChecklist, resolveChecklistRefresh, type ChecklistRefreshPolicy } from './checklist-refresh';

const tue = new Date('2026-09-29T12:00:00Z'), thu = new Date('2026-10-01T12:00:00Z');
const policy: ChecklistRefreshPolicy = { mode: 'custom', schedule: { id: '1560-v1', frequency: 'weekly', interval: 1,
    weekdays: [2, 4], startDate: '2026-09-28', time: '06:00', timeZone: 'America/Chicago' }, end: { mode: 'never' },
    revision: 1, updatedAt: '2026-09-28T12:00:00Z', deviceId: 'a' };
function task(): Task {
    return { id: '1560', title: '1560', description: 'notes', status: 'next', tags: [], contexts: [],
        createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z',
        checklist: [{ id: 'prepare', title: 'Prepare', isCompleted: false }],
        planner: { version: 1, blocks: [], days: [], checklistRefresh: { version: 1, defaults: structuredClone(policy), items: {}, marks: {} } } };
}
function mark(t: Task, now = tue, completed = true) {
    const state = checklistItemState(t, t.checklist![0], [t], now);
    const changed = changeChecklistCompletion(t, [t], [{ itemId: 'prepare', completed, cycleId: state.cycle?.id }], now, 'b');
    return { ...t, checklist: changed.checklist, planner: { ...taskPlanner(t), checklistRefresh: changed.refresh } };
}
function draftOf(t: Task) { return { ...structuredClone(t), checklist: projectChecklist(t, [t], tue) }; }

describe('checklist content drafts and planner persistence', () => {
    it('saves text across a period boundary without carrying an unchanged checked box forward', () => {
        const base = mark(task()), draft = { ...draftOf(base), description: 'new notes' };
        const patch = checklistContentDraftPatch(base, draft, base, [base], checklistDraftState(base, [base], tue), thu, 'a');
        assert.deepEqual(patch, { description: 'new notes' });
        assert.equal(checklistItemState({ ...base, ...patch }, base.checklist![0], [base], thu).completed, false);
    });
    it('rejects an explicitly changed checkbox when its period changes during editing', () => {
        const base = task(), draft = draftOf(base); draft.checklist![0].isCompleted = true;
        assert.throws(() => checklistContentDraftPatch(base, draft, base, [base], checklistDraftState(base, [base], tue), thu, 'a'), /period changed while editing/);
        assert.equal(base.checklist![0].isCompleted, false);
    });
    it('writes a same-period checkbox to the ledger, not to the permanent legacy flag', () => {
        const base = task(), draft = draftOf(base); draft.checklist![0].isCompleted = true;
        const patch = checklistContentDraftPatch(base, draft, base, [base], checklistDraftState(base, [base], tue), tue, 'a');
        assert.equal(patch.checklist, undefined);
        assert.equal(patch.planner!.checklistRefresh!.marks.prepare['1560-v1/2026-09-29'].completed, true);
        assert.equal(base.checklist![0].isCompleted, false);
    });
    it('keeps renamed item identity and old raw flags alongside current completion', () => {
        const base = mark(task()), draft = draftOf(base); draft.checklist![0].title = 'Prepare slides';
        const patch = checklistContentDraftPatch(base, draft, base, [base], checklistDraftState(base, [base], tue), tue, 'a');
        assert.deepEqual(patch.checklist, [{ id: 'prepare', title: 'Prepare slides', isCompleted: false }]);
        assert.equal(checklistItemState({ ...base, ...patch }, patch.checklist![0], [base], tue).completed, true);
    });
    it('guards a concurrent same-period checkbox reversal but permits unrelated text saves', () => {
        const base = task(), draft = draftOf(base), remote = mark(mark(base), tue, false);
        draft.checklist![0].isCompleted = true;
        assert.throws(() => checklistContentDraftPatch(base, draft, remote, [remote], checklistDraftState(base, [base], tue), tue, 'a'), /another device/);
        draft.checklist![0].isCompleted = false; draft.description = 'keep text';
        assert.deepEqual(checklistContentDraftPatch(base, draft, remote, [remote], checklistDraftState(base, [base], tue), tue, 'a'), { description: 'keep text' });
    });
    it('removes a blank saved item without restoring it from history', () => {
        const base = mark(task()), draft = draftOf(base); draft.checklist![0].title = '  ';
        const patch = checklistContentDraftPatch(base, draft, base, [base], checklistDraftState(base, [base], tue), tue, 'a');
        assert.ok(Object.prototype.hasOwnProperty.call(patch, 'checklist')); assert.equal(patch.checklist, undefined);
        assert.equal(projectChecklist({ ...base, ...patch }, [base], thu), undefined);
    });
    it('records a newly added checked item in the current inherited period', () => {
        const base = task(), draft = draftOf(base); draft.checklist!.push({ id: 'new', title: 'Grade', isCompleted: true });
        const patch = checklistContentDraftPatch(base, draft, base, [base], checklistDraftState(base, [base], tue), tue, 'a');
        assert.equal(patch.planner!.checklistRefresh!.marks.new['1560-v1/2026-09-29'].completed, true);
        assert.equal(patch.checklist!.find(item => item.id === 'new')!.isCompleted, false);
    });
    it('round-trips refresh metadata through planner JSON validation', () => {
        const t = mark(task()); assert.deepEqual(readTaskPlanner(JSON.parse(JSON.stringify(t.planner))), t.planner);
        const malformed = structuredClone(t.planner!); malformed.checklistRefresh!.version = 2 as 1;
        assert.throws(() => readTaskPlanner(malformed), /Unsupported checklist/);
    });
    it('merges per-period records without losing allocations or dated intentions', () => {
        const a = mark(task()), b = mark(task(), thu);
        a.planner!.days = [{ date: '2026-09-29', selected: true, revision: 1, manualRevision: 1, updatedAt: tue.toISOString(), deviceId: 'a' }];
        const merged = mergeTaskPlanners(a.planner, b.planner)!;
        assert.equal(merged.days.length, 1); assert.equal(Object.keys(merged.checklistRefresh!.marks.prepare).length, 2);
        assert.deepEqual(merged, mergeTaskPlanners(b.planner, a.planner));
    });
    it('does not mutate plain or legacy planner payloads on read', () => {
        const plain = { ...task(), planner: undefined }; const before = JSON.stringify(plain);
        assert.equal(taskPlanner(plain).checklistRefresh, undefined); assert.equal(JSON.stringify(plain), before);
    });
    it('freezes a permanently closed task rather than reopening or advancing it', () => {
        const t = { ...mark(task()), status: 'done' as const, completedAt: tue.toISOString() };
        const view = checklistItemState(t, t.checklist![0], [t], thu);
        assert.equal(view.cycle?.day, '2026-09-29'); assert.equal(view.completed, true); assert.equal(view.next, undefined); assert.equal(t.status, 'done');
    });
    it('displays the actual parent rule when an own custom/off override is being replaced by inherit', () => {
        const p = task(), child = { ...task(), id: 'child', parentTaskId: p.id };
        child.planner!.checklistRefresh!.defaults!.mode = 'off';
        assert.equal(resolveChecklistRefresh(child, undefined, [p, child]).schedule, undefined);
        assert.equal(resolveChecklistRefresh(child, undefined, [p, child], true).schedule?.id, '1560-v1');
    });
    it('previews indirectly affected children but does not write their independent settings', () => {
        const p = task(), child = { ...task(), id: 'child', parentTaskId: p.id };
        child.planner!.checklistRefresh!.defaults = undefined;
        const tasks = [p, child], preview = checklistEndPreview(tasks, [{ taskId: p.id }]);
        const impact = checklistEndImpact(tasks, preview, { mode: 'date', date: '2026-12-10' });
        assert.ok(impact.some(t => t.taskId === child.id && t.itemId === 'prepare' && t.after === '2026-12-10'));
        const changes = checklistEndUpdates(tasks, preview, { mode: 'date', date: '2026-12-10' }, tue, 'a');
        assert.equal(changes.has(child.id), false);
    });
    it('rejects empty bulk selections and a changed unselected inherited parent', () => {
        assert.throws(() => checklistEndUpdates([task()], [], { mode: 'never' }, tue, 'a'), /Select at least/);
        const p = task(), child = { ...task(), id: 'child', parentTaskId: p.id }; child.planner!.checklistRefresh!.defaults = undefined;
        const preview = checklistEndPreview([p, child], [{ taskId: child.id }]);
        const changedParent = structuredClone(p); changedParent.planner!.checklistRefresh!.defaults!.end = { mode: 'date', date: '2026-12-10' };
        assert.throws(() => checklistEndUpdates([changedParent, child], preview, { mode: 'never' }, tue, 'a'), /changed after the preview/);
    });
});
