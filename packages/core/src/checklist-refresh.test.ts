import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import type { Task } from './types';
import { changeChecklistCompletion, checklistDescendants, checklistDraftState, checklistFreezeUpdates, checklistRefreshScope, checklistEndPreview, checklistEndUpdates, checklistHistory, checklistItemState,
    checklistLocalDay, checklistRefreshData, hasActiveChecklistRound, hasRecurringChecklist, makeChecklistPolicy, mergeChecklistRefresh, projectChecklist,
    updateChecklistPolicy, validateChecklistRefresh, validateChecklistSchedule, type ChecklistRefreshPolicy, type ChecklistRefreshSchedule } from './checklist-refresh';

const now = new Date('2026-09-29T12:00:00Z'); // Tuesday 07:00 in Chicago.
const schedule = (patch: Partial<ChecklistRefreshSchedule> = {}): ChecklistRefreshSchedule => ({
    id: 'series-a', frequency: 'weekly', interval: 1, weekdays: [2, 4], startDate: '2026-09-28', time: '06:00', timeZone: 'America/Chicago', ...patch,
});
const policy = (patch: Partial<ChecklistRefreshPolicy> = {}): ChecklistRefreshPolicy => ({
    mode: 'custom', schedule: schedule(), end: { mode: 'never' }, revision: 1, updatedAt: '2026-09-28T12:00:00Z', deviceId: 'a', ...patch,
});
const task = (id = '1560', parentTaskId?: string): Task => ({
    id, title: id, parentTaskId, status: 'next', tags: [], contexts: [], createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z',
    checklist: [{ id: 'prepare', title: 'Prepare class', isCompleted: false }, { id: 'grade', title: 'Grade assignments', isCompleted: false }],
    planner: { version: 1, blocks: [], days: [] },
});
const configured = (p = policy()) => { const t = task(); t.planner!.checklistRefresh = { version: 1, defaults: p, items: {}, marks: {} }; return t; };
const view = (t: Task, time = now, tasks: Task[] = [t], item = 'prepare') => checklistItemState(t, t.checklist!.find(x => x.id === item)!, tasks, time);
const complete = (t: Task, time = now, tasks: Task[] = [t], value = true) => {
    const changed = changeChecklistCompletion(t, tasks, [{ itemId: 'prepare', completed: value, cycleId: view(t, time, tasks).cycle?.id }], time, 'a');
    return { ...t, checklist: changed.checklist, planner: { ...t.planner!, checklistRefresh: changed.refresh } };
};

describe('checklist recurrence projection', () => {
    it('Tuesday and Thursday advance independently of the completion time', () => {
        const t = complete(configured());
        assert.equal(view(t).cycle?.day, '2026-09-29'); assert.equal(view(t).completed, true);
        assert.equal(view(t, new Date('2026-10-01T10:59:59Z')).completed, true);
        assert.equal(view(t, new Date('2026-10-01T11:00:00Z')).completed, false);
        assert.equal(view(t, new Date('2026-10-01T11:00:00Z')).cycle?.day, '2026-10-01');
        assert.equal(t.checklist![0].isCompleted, false); // Legacy boolean is not the repeating completion ledger.
    });
    it('does not create tasks or missed instances when opened after a long offline gap', () => {
        const t = complete(configured()), before = JSON.stringify(t);
        assert.equal(view(t, new Date('2040-01-03T16:00:00Z')).cycle?.day, '2040-01-03');
        assert.equal(JSON.stringify(t), before);
    });
    it('the end date is inclusive in the configured timezone and the last round remains visible', () => {
        const t = configured(policy({ end: { mode: 'date', date: '2026-10-01' } }));
        assert.equal(view(t, new Date('2026-10-01T11:00:00Z')).cycle?.day, '2026-10-01');
        assert.equal(view(t, new Date('2026-10-02T04:59:00Z')).ended, false);
        assert.equal(view(t, new Date('2026-10-02T05:00:00Z')).ended, true);
        assert.equal(view(t, new Date('2026-10-06T11:00:00Z')).cycle?.day, '2026-10-01');
        assert.equal(view(t, new Date('2026-10-06T11:00:00Z')).next, undefined);
    });
    it('keeps unchecked future starts unavailable for completion', () => {
        const t = configured(); const state = view(t, new Date('2026-09-28T12:00:00Z'));
        assert.equal(state.cycle, undefined); assert.equal(state.next?.day, '2026-09-29');
        assert.throws(() => changeChecklistCompletion(t, [t], [{ itemId: 'prepare', completed: true }], new Date('2026-09-28T12:00:00Z'), 'a'), /period changed/);
    });
    it('does not let an inherited end before the start invent a round', () => {
        const p = configured(policy({ end: { mode: 'date', date: '2026-09-28' } })), child = task('child', p.id);
        assert.equal(view(child, now, [p, child]).cycle, undefined);
    });
    it('retains history for completed and missed rounds without creating backlog tasks', () => {
        const t = complete(configured());
        const history = checklistHistory(t, t.checklist![0], [t], new Date('2026-10-06T12:00:00Z'));
        assert.deepEqual(history.map(x => [x.day, x.completed, x.current]), [['2026-10-06', false, true], ['2026-10-01', false, false], ['2026-09-29', true, false]]);
    });
    it('preserves normal one-time items and supports explicitly disabling recurrence per item', () => {
        const t = configured(); t.planner!.checklistRefresh!.items.grade = policy({ mode: 'off', schedule: undefined, end: { mode: 'inherit' } });
        const changed = changeChecklistCompletion(t, [t], [{ itemId: 'grade', completed: true }], now, 'a');
        assert.equal(changed.checklist[1].isCompleted, true); assert.deepEqual(changed.refresh.marks, {});
        assert.equal(view(t, now, [t], 'grade').recurring, false);
    });
    it('freezes during pause and catches up only to the current round after resume', () => {
        const t = complete(configured()); t.planner!.checklistRefresh!.defaults!.pausedAt = now.toISOString();
        assert.equal(view(t, new Date('2026-10-06T12:00:00Z')).completed, true);
        assert.equal(view(t, new Date('2026-10-06T12:00:00Z')).next, undefined);
        delete t.planner!.checklistRefresh!.defaults!.pausedAt;
        assert.equal(view(t, new Date('2026-10-06T12:00:00Z')).cycle?.day, '2026-10-06');
    });
    it('uses a new version for a changed cadence, without recycling previous marks', () => {
        const t = complete(configured()); t.planner!.checklistRefresh!.defaults!.schedule!.id = 'series-b';
        assert.equal(view(t).completed, false); assert.equal(checklistHistory(t, t.checklist![0], [t], now).filter(x => x.completed).length, 1);
    });
    it('has an active round only between the first period and the end date', () => {
        const t = configured(policy({ end: { mode: 'date', date: '2026-10-01' } }));
        assert.equal(hasActiveChecklistRound(t, [t], new Date('2026-09-28T12:00:00Z')), false);
        assert.equal(hasActiveChecklistRound(t, [t], now), true);
        assert.equal(hasActiveChecklistRound(t, [t], new Date('2026-10-06T12:00:00Z')), false);
        assert.equal(hasRecurringChecklist(t, [t], new Date('2026-10-06T12:00:00Z')), true);
        assert.equal(hasActiveChecklistRound({ ...t, status: 'done', completedAt: now.toISOString() }, [t], now), false);
    });
    it('freezes current checkboxes whenever an item stops refreshing, not only for "off"', () => {
        const t = configured(); t.checklist![1].isCompleted = true; // Stale raw flag from before refreshing was enabled.
        const inherited = { ...t, planner: { ...t.planner!, checklistRefresh: { ...t.planner!.checklistRefresh!, defaults: policy({ mode: 'inherit', schedule: undefined }) } } };
        const frozen = checklistFreezeUpdates([t], [inherited], [t.id], now).get(t.id)!;
        assert.deepEqual(frozen.map(item => item.isCompleted), [false, false]);
        assert.equal(checklistFreezeUpdates([t], [t], [t.id], now).size, 0);
    });
    it('scopes a task to itself and its live ancestors', () => {
        const p = configured(), child = task('child', p.id), other = task('other');
        assert.deepEqual(checklistRefreshScope([p, child, other], child.id).map(x => x.id), ['child', p.id]);
        const a = task('a', 'b'), b = task('b', 'a');
        assert.deepEqual(checklistRefreshScope([a, b], 'a').map(x => x.id), ['a', 'b']);
    });
    it('keeps synced data with an unknown timezone readable, but rejects it as new input', () => {
        const odd = policy({ schedule: schedule({ timeZone: 'Mars/Olympus_Mons' }) });
        validateChecklistRefresh({ version: 1, defaults: odd, items: {}, marks: {} });
        const t = configured(odd);
        assert.equal(view(t).recurring, true);
        assert.throws(() => makeChecklistPolicy(undefined, { mode: 'custom', schedule: odd.schedule, end: { mode: 'never' }, paused: false }, now, 'a'), /Unknown time zone/);
        assert.equal(makeChecklistPolicy(odd, { mode: 'custom', schedule: odd.schedule, end: { mode: 'date', date: '2026-12-01' }, paused: false }, now, 'a').end.date, '2026-12-01');
    });
    it('marks a round, not the permanent lifecycle of a live recurring checklist', () => {
        const t = complete(configured()); assert.equal(t.status, 'next'); assert.equal(hasRecurringChecklist(t, [t], now), true);
        assert.equal(checklistDraftState(t, [t], now).prepare.completed, true);
        assert.equal(projectChecklist(t, [t], now)![0].isCompleted, true);
    });
});

describe('calendar edges and fixed timezones', () => {
    it('refreshes once across the repeated fall-back hour', () => {
        const t = configured(policy({ schedule: schedule({ frequency: 'daily', startDate: '2026-10-31', time: '01:30' }) }));
        const first = new Date('2026-11-01T06:30:00Z'), folded = new Date('2026-11-01T07:15:00Z');
        const done = complete(t, first); assert.equal(view(done, folded).cycle?.dueAt, first.toISOString());
        assert.equal(view(done, folded).completed, true); assert.equal(view(done, new Date('2026-11-01T07:30:00Z')).completed, true);
    });
    it('moves a missing spring-forward refresh to the first existing minute', () => {
        const t = configured(policy({ schedule: schedule({ frequency: 'daily', startDate: '2026-03-07', time: '02:30' }) }));
        assert.equal(view(t, new Date('2026-03-08T07:59:00Z')).cycle?.day, '2026-03-07');
        assert.equal(view(t, new Date('2026-03-08T08:00:00Z')).cycle?.dueAt, '2026-03-08T08:00:00.000Z');
    });
    it('does not depend on the device timezone', () => {
        const t = configured(policy({ schedule: schedule({ timeZone: 'Asia/Shanghai' }) }));
        assert.equal(view(t, new Date('2026-09-28T22:00:00Z')).cycle?.day, '2026-09-29');
        assert.equal(checklistLocalDay(new Date('2026-09-28T22:00:00Z'), 'Asia/Shanghai'), '2026-09-29');
    });
    it('anchors interval weeks to Monday and skips inactive weeks', () => {
        const t = configured(policy({ schedule: schedule({ interval: 2 }) }));
        assert.equal(view(t, new Date('2026-10-06T12:00:00Z')).cycle?.day, '2026-10-01');
        assert.equal(view(t, new Date('2026-10-06T12:00:00Z')).next?.day, '2026-10-13');
    });
    it('handles monthly last day and invalid month dates', () => {
        const t = configured(policy({ schedule: schedule({ frequency: 'monthly', startDate: '2026-01-01', monthDays: [-1] }) }));
        assert.equal(view(t, new Date('2026-03-01T12:00:00Z')).cycle?.day, '2026-02-28');
        t.planner!.checklistRefresh!.defaults!.schedule!.monthDays = [31];
        assert.equal(view(t, new Date('2026-03-01T12:00:00Z')).cycle?.day, '2026-01-31');
    });
    it('jumps large intervals without scanning every missed day', () => {
        const t = configured(policy({ schedule: schedule({ frequency: 'yearly', interval: 999, startDate: '2000-02-29' }) }));
        assert.equal(view(t, new Date('2040-01-01T12:00:00Z')).cycle?.day, '2000-02-29');
        assert.equal(view(t, new Date('2040-01-01T12:00:00Z')).next?.day, '5996-02-29');
    });
    it('validates dates, interval, weekday selection, and timezone', () => {
        for (const invalid of [{ startDate: '2026-02-30' }, { interval: 0 }, { weekdays: [] }, { time: '24:00' }, { timeZone: 'Not/AZone' }]) {
            assert.throws(() => validateChecklistSchedule(schedule(invalid)));
        }
        assert.throws(() => makeChecklistPolicy(undefined, { mode: 'custom', schedule: schedule(), end: { mode: 'date', date: '2020-01-01' }, paused: false }, now, 'a'));
    });
});

describe('parent, child, item and bulk end policies', () => {
    it('inherits cadence and end independently, allowing explicit child extensions', () => {
        const parent = configured(policy({ end: { mode: 'date', date: '2026-10-01' } })), child = task('child', parent.id);
        assert.equal(view(child, now, [parent, child]).endDate, '2026-10-01');
        child.planner!.checklistRefresh = { version: 1, defaults: policy({ mode: 'inherit', schedule: undefined, end: { mode: 'date', date: '2026-12-01' } }), items: {}, marks: {} };
        assert.equal(view(child, now, [parent, child]).endDate, '2026-12-01');
        assert.equal(view(child, now, [parent, child]).schedule?.id, 'series-a');
        child.planner!.checklistRefresh!.items.prepare = policy({ mode: 'inherit', schedule: undefined, end: { mode: 'never' } });
        assert.equal(view(child, now, [parent, child]).endDate, undefined);
    });
    it('supports independent item weekdays while inheriting its end date', () => {
        const t = configured(policy({ end: { mode: 'date', date: '2026-12-01' } }));
        t.planner!.checklistRefresh!.items.prepare = policy({ end: { mode: 'inherit' }, schedule: schedule({ id: 'own', weekdays: [2] }) });
        assert.equal(view(t, new Date('2026-10-01T12:00:00Z')).cycle?.day, '2026-09-29');
        assert.equal(view(t).endDate, '2026-12-01');
    });
    it('stops inheritance at missing/deleted parents and never revives deleted items', () => {
        const p = configured(), child = task('child', p.id); p.deletedAt = now.toISOString();
        assert.equal(view(child, now, [p, child]).recurring, false);
        assert.throws(() => changeChecklistCompletion(child, [child], [{ itemId: 'gone', completed: true }], now, 'a'));
        assert.throws(() => updateChecklistPolicy(child, 'gone', policy()));
        assert.equal(projectChecklist({ ...child, checklist: [] }, [child], now)?.length, 0);
    });
    it('handles malformed parent cycles without recursive overflow', () => {
        const a = task('a', 'b'), b = task('b', 'a');
        assert.deepEqual(checklistDescendants([a, b], 'a').map(t => t.id), ['b']);
        assert.equal(view(a, now, [a, b]).completed, false);
    });
    it('bulk sync updates only selected ends, not cadence, pause, unrelated overrides or completion', () => {
        const p = complete(configured()), child = task('child', p.id);
        const preview = checklistEndPreview([p, child], [{ taskId: p.id, itemId: 'grade' }, { taskId: child.id }]);
        const result = checklistEndUpdates([p, child], preview, { mode: 'date', date: '2026-12-10' }, now, 'b');
        assert.equal(result.get(p.id)!.defaults!.schedule!.id, 'series-a');
        assert.equal(result.get(p.id)!.items.grade.end.date, '2026-12-10');
        assert.deepEqual(result.get(p.id)!.marks, checklistRefreshData(p).marks);
        assert.equal(result.get(child.id)!.defaults!.mode, 'inherit');
        assert.equal(p.planner!.checklistRefresh!.items.grade, undefined);
    });
    it('rejects stale previews atomically before writing any target', () => {
        const p = configured(), child = task('child', p.id);
        const preview = checklistEndPreview([p, child], [{ taskId: p.id }, { taskId: child.id }]);
        child.parentTaskId = undefined;
        assert.throws(() => checklistEndUpdates([p, child], preview, { mode: 'never' }, now, 'b'), /changed after the preview/);
    });
    it('treats clearing a date as explicit no-end, not accidental re-inheritance', () => {
        const p = configured(policy({ end: { mode: 'date', date: '2026-12-01' } })), child = task('child', p.id);
        const result = checklistEndUpdates([p, child], checklistEndPreview([p, child], [{ taskId: child.id }]), { mode: 'never' }, now, 'a');
        child.planner!.checklistRefresh = result.get(child.id);
        assert.equal(view(child, now, [p, child]).endDate, undefined);
    });
});

describe('multi-device ledger and undo guards', () => {
    it('unions different periods and items; an old Tuesday mark cannot check Thursday', () => {
        const t = configured(), a = complete(t), b = complete(t, new Date('2026-10-01T12:00:00Z'));
        const merged = mergeChecklistRefresh(checklistRefreshData(a), checklistRefreshData(b))!;
        assert.equal(Object.keys(merged.marks.prepare).length, 2);
        assert.deepEqual(merged, mergeChecklistRefresh(checklistRefreshData(b), checklistRefreshData(a)));
        assert.equal(view(a, new Date('2026-10-01T12:00:00Z')).completed, false);
    });
    it('undo is a newer false mark rather than deletion of historical evidence', () => {
        const done = complete(configured()), undone = complete(done, now, [done], false);
        const merged = mergeChecklistRefresh(checklistRefreshData(done), checklistRefreshData(undone))!;
        assert.equal(merged.marks.prepare['series-a/2026-09-29'].completed, false);
        assert.equal(merged.marks.prepare['series-a/2026-09-29'].revision, 2);
    });
    it('rejects a stale period instead of silently checking the new round', () => {
        const t = configured();
        assert.throws(() => changeChecklistCompletion(t, [t], [{ itemId: 'prepare', completed: true, cycleId: view(t).cycle!.id }], new Date('2026-10-01T12:00:00Z'), 'a'), /period changed/);
    });
    it('preserves independently edited item policies across merge', () => {
        const a = configured(), b = configured();
        a.planner!.checklistRefresh!.items.prepare = policy({ mode: 'off' });
        b.planner!.checklistRefresh!.items.grade = policy({ end: { mode: 'date', date: '2026-12-01' } });
        const merged = mergeChecklistRefresh(checklistRefreshData(a), checklistRefreshData(b))!;
        assert.equal(merged.items.prepare.mode, 'off'); assert.equal(merged.items.grade.end.date, '2026-12-01');
        assert.deepEqual(mergeChecklistRefresh(merged, merged), merged);
    });
    it('rejects malformed records instead of stripping history', () => {
        assert.throws(() => validateChecklistRefresh({ version: 2, items: {}, marks: {} }));
        assert.throws(() => validateChecklistRefresh({ version: 1, items: {}, marks: { a: { bad: { completed: true } } } }));
        assert.throws(() => validateChecklistRefresh(JSON.parse('{"version":1,"items":{"__proto__":{}},"marks":{}}')));
    });
    it('pause time is not advanced by editing only the end date', () => {
        const old = policy({ pausedAt: now.toISOString() });
        const changed = makeChecklistPolicy(old, { mode: old.mode, schedule: old.schedule, end: { mode: 'date', date: '2026-12-10' }, paused: true }, new Date('2026-10-20T12:00:00Z'), 'a');
        assert.equal(changed.pausedAt, old.pausedAt); assert.equal(changed.schedule?.id, old.schedule?.id);
    });
});
