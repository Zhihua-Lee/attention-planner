import { describe, expect, it, vi } from 'vitest';
import { checklistRuleDraftDirty, checklistRuleDraftKey, createChecklistRuleDraftStore, type ChecklistRuleDraft } from './checklist-rule-drafts';

const list = { taskId: '1560' }, item = { taskId: '1560', itemId: 'prepare' }, child = { taskId: '1560 child', itemId: 'prepare' };
const schedule = { id: '1560-v1', frequency: 'weekly' as const, interval: 1, weekdays: [2, 4], startDate: '2026-09-28', time: '06:00', timeZone: 'America/Chicago' };
function draft(): ChecklistRuleDraft {
    return { base: { mode: 'custom', schedule, end: { mode: 'never' }, revision: 1, updatedAt: '2026-09-29T12:00:00Z', deviceId: 'test' },
        initial: schedule, mode: 'custom', schedule: { ...schedule, time: '07:15' }, end: { mode: 'date', date: '2026-12-17' }, paused: false };
}
function storage() {
    const values = new Map<string, string>();
    return { values, getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
        removeItem: vi.fn((key: string) => { values.delete(key); }) };
}

describe('private checklist rule drafts', () => {
    it('isolates task defaults, items and equal item IDs in different tasks', () => {
        const disk = storage(), store = createChecklistRuleDraftStore(() => disk);
        store.save(list, draft());
        store.save(item, { ...draft(), mode: 'off' });
        store.save(child, { ...draft(), end: { mode: 'never' } });
        expect(store.load(list).draft?.schedule.time).toBe('07:15');
        expect(store.load(item).draft?.mode).toBe('off');
        expect(store.load(child).draft?.end.mode).toBe('never');
        expect(new Set([checklistRuleDraftKey(list), checklistRuleDraftKey(item), checklistRuleDraftKey(child)]).size).toBe(3);
    });
    it('round-trips the entire draft through a fresh store after reload', () => {
        const disk = storage();
        createChecklistRuleDraftStore(() => disk).save(list, draft());
        expect(createChecklistRuleDraftStore(() => disk).load(list)).toEqual({ draft: draft() });
    });
    it('round-trips an after-completion draft', () => {
        const disk = storage(), { weekdays: _weekdays, ...rest } = schedule;
        const value: ChecklistRuleDraft = { ...draft(), schedule: { ...rest, anchor: 'completion', frequency: 'hourly', interval: 3 } };
        createChecklistRuleDraftStore(() => disk).save(list, value);
        expect(createChecklistRuleDraftStore(() => disk).load(list)).toEqual({ draft: value });
    });
    it('keeps the original base revision rather than silently rebasing restored edits', () => {
        const disk = storage(), original = draft();
        createChecklistRuleDraftStore(() => disk).save(list, original);
        original.base!.revision = 9;
        expect(createChecklistRuleDraftStore(() => disk).load(list).draft?.base?.revision).toBe(1);
    });
    it('keeps unfinished form values so failed validation does not lose typing', () => {
        const disk = storage(), value = draft();
        value.schedule = { ...value.schedule, time: '', timeZone: 'Not/a/timezone', weekdays: [] };
        value.end = { mode: 'date', date: '' };
        createChecklistRuleDraftStore(() => disk).save(list, value);
        expect(createChecklistRuleDraftStore(() => disk).load(list).draft).toEqual(value);
    });
    it('clears only the explicitly saved/discarded target and does not restore it later', () => {
        const disk = storage(), store = createChecklistRuleDraftStore(() => disk);
        store.save(list, draft()); store.save(item, draft());
        expect(store.clear(item)).toBe(true);
        expect(store.load(item).draft).toBeUndefined();
        expect(store.hasDrafts([list, item])).toBe(true);
        expect(createChecklistRuleDraftStore(() => disk).load(item).draft).toBeUndefined();
        expect(store.load(list).draft).toEqual(draft());
    });
    it('removes a draft when all edits are reverted', () => {
        const disk = storage(), store = createChecklistRuleDraftStore(() => disk), value = draft();
        store.save(list, value);
        const reverted = { ...value, schedule: value.initial!, end: value.base!.end };
        expect(checklistRuleDraftDirty(reverted)).toBe(false);
        store.save(list, reverted);
        expect(disk.values.size).toBe(0);
        expect(store.hasDrafts([list])).toBe(false);
    });
    it('recognizes independent mode, end, pause and cadence edits', () => {
        const value = draft(), clean = { ...value, schedule: value.initial!, end: value.base!.end };
        expect(checklistRuleDraftDirty(clean)).toBe(false);
        for (const patch of [{ mode: 'off' as const }, { end: { mode: 'inherit' as const } }, { paused: true }, { schedule: { ...schedule, frequency: 'daily' as const } }]) {
            expect(checklistRuleDraftDirty({ ...clean, ...patch })).toBe(true);
        }
    });
    it('does not let callers mutate the memory copy or its stale-write snapshot', () => {
        const disk = storage(), store = createChecklistRuleDraftStore(() => disk), value = draft();
        store.save(list, value);
        value.schedule.time = '09:00';
        const read = store.load(list).draft!; read.base!.revision = 10;
        expect(store.load(list).draft?.schedule.time).toBe('07:15');
        expect(store.load(list).draft?.base?.revision).toBe(1);
    });
    it('retains edits in memory and warns about reload when storage access fails', () => {
        const notify = vi.fn(), store = createChecklistRuleDraftStore(() => { throw new Error('denied'); }, notify);
        expect(store.save(list, draft())).toBe(false);
        expect(store.load(list)).toEqual({ draft: draft(), error: 'storage' });
        expect(store.load(item).draft).toBeUndefined();
        expect(store.load(list).draft).toEqual(draft());
        expect(notify).toHaveBeenLastCalledWith(true);
        store.clear(list);
        expect(notify).toHaveBeenLastCalledWith(false);
        expect(store.load(list).draft).toBeUndefined();
    });
    it('tracks all unbacked targets until each one is saved or discarded', () => {
        const disk = storage(), notify = vi.fn(), store = createChecklistRuleDraftStore(() => disk, notify);
        disk.setItem.mockImplementation(() => { throw new Error('quota'); });
        store.save(list, draft()); store.save(item, draft());
        store.clear(list);
        expect(notify).toHaveBeenLastCalledWith(true);
        disk.setItem.mockImplementation((key, value) => { disk.values.set(key, value); });
        store.save(item, draft());
        expect(notify).toHaveBeenLastCalledWith(false);
        expect(store.load(item).error).toBeUndefined();
    });
    it('does not resurrect a cleared draft in this session if removal fails', () => {
        const disk = storage(), store = createChecklistRuleDraftStore(() => disk);
        store.save(list, draft());
        disk.removeItem.mockImplementation(() => { throw new Error('denied'); });
        expect(store.clear(list)).toBe(false);
        expect(disk.values.has(checklistRuleDraftKey(list))).toBe(true);
        expect(store.load(list).draft).toBeUndefined();
    });
    it('ignores malformed backups without deleting or overwriting their bytes', () => {
        for (const raw of ['{bad', '{}', JSON.stringify({ version: 1, taskId: '1560', itemId: null, draft: { ...draft(), schedule: null } })]) {
            const disk = storage(); disk.values.set(checklistRuleDraftKey(list), raw);
            expect(createChecklistRuleDraftStore(() => disk).load(list)).toEqual({ error: 'invalid' });
            expect(disk.values.get(checklistRuleDraftKey(list))).toBe(raw);
        }
    });
    it('rejects backups with the wrong target or schema version', () => {
        const disk = storage();
        for (const patch of [{ taskId: 'other' }, { itemId: 'prepare' }, { version: 2 }]) {
            disk.values.set(checklistRuleDraftKey(list), JSON.stringify({ version: 1, taskId: '1560', itemId: null, draft: draft(), ...patch }));
            expect(createChecklistRuleDraftStore(() => disk).load(list)).toEqual({ error: 'invalid' });
        }
    });
    it('does not confuse separator-like identifiers or the default with an item', () => {
        expect(checklistRuleDraftKey({ taskId: 'a:b', itemId: 'c' })).not.toBe(checklistRuleDraftKey({ taskId: 'a', itemId: 'b:c' }));
        expect(checklistRuleDraftKey(list)).not.toBe(checklistRuleDraftKey({ taskId: '1560', itemId: '' }));
    });
});
