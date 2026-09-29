import { describe, expect, it } from 'vitest';
import type { Task } from '@mindwtr/core';
import { changedParts, editLabel, undoPatch } from './task-edit-history';

const task = (patch: Partial<Task> = {}): Task => ({ id: 't', title: 'Plan', status: 'next', tags: [], contexts: [], createdAt: '2026-09-29T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z', ...patch });
const day = { date: '2026-09-29', selected: true, revision: 1, manualRevision: 1, updatedAt: '2026-09-29T00:00:00Z', deviceId: 'a' };

describe('task page undo', () => {
    it('reverts exactly the parts an edit changed', () => {
        const before = task(), after = task({ title: 'Plan week', dueDate: '2026-10-01' });
        expect(changedParts(before, after)).toEqual(['title', 'dueDate']);
        expect(undoPatch(after, { before, after })).toEqual({ patch: { title: 'Plan', dueDate: undefined }, conflicts: [] });
    });
    it('keeps a part that changed again and still reverts the rest', () => {
        const before = task(), after = task({ title: 'Plan week', description: 'Draft' });
        const latest = task({ title: 'Renamed on phone', description: 'Draft' });
        expect(undoPatch(latest, { before, after })).toEqual({ patch: { description: undefined }, conflicts: ['title'] });
    });
    it('reverts planner parts without touching unrelated planner data', () => {
        const skippedAt = '2026-09-20T00:00:00Z';
        const before = task({ planner: { version: 1, blocks: [], days: [], skippedAt } }), after = task({ planner: { version: 1, blocks: [], days: [day], skippedAt } });
        expect(changedParts(before, after)).toEqual(['days']);
        const { patch } = undoPatch(after, { before, after });
        expect(patch.planner).toMatchObject({ days: [], blocks: [], skippedAt });
    });
    it('names what will be undone', () => {
        expect(editLabel(['projectId', 'areaId'], true)).toBe('归属');
        expect(editLabel(['title', 'checklist'], false)).toBe('title, checklist');
    });
});
