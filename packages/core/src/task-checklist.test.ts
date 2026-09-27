import { describe, expect, it } from 'vitest';
import { checklistForSave } from './task-checklist';
import { contentDraftPatch } from './planner';
import { prepareCaptureTask } from './capture';
import type { Task } from './types';

const item = (id: string, title: string, isCompleted = false) => ({ id, title, isCompleted });
const task = (checklist?: Task['checklist']): Task => ({
    id: 'task', title: 'Keep this task', status: 'inbox', contexts: [], tags: [],
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', checklist,
});

describe('checklist save boundary', () => {
    it('normalizes shared capture after surface overrides without mutating the input', async () => {
        const checklist = [item('blank', ' ')];
        const result = await prepareCaptureTask({
            parsed: { title: 'Capture', props: {} }, rawInput: 'Capture', projects: [],
        }, { addProject: async () => null }, { transformProps: props => ({ ...props, checklist }) });
        expect(result.success).toBe(true);
        if (result.success) expect(result.props.checklist).toBeUndefined();
        expect(checklist).toHaveLength(1);
    });
    it('removes empty, whitespace-only and completed blank rows', () => {
        expect(checklistForSave(undefined)).toBeUndefined();
        expect(checklistForSave([])).toBeUndefined();
        expect(checklistForSave([item('a', ''), item('b', ' \t\n', true)])).toBeUndefined();
    });
    it('keeps meaningful content, item identities and completion without mutating the draft', () => {
        const meaningful = item('keep', '  **Marked** step  ', true);
        const draft = [item('empty', ' '), meaningful];
        expect(checklistForSave(draft)).toEqual([meaningful]);
        expect(checklistForSave(draft)?.[0]).toBe(meaningful);
        expect(draft).toHaveLength(2);
    });
    it('clears the last step on Save without deleting its parent task', () => {
        const base = task([item('a', 'Milk')]);
        const patch = contentDraftPatch(base, { ...base, checklist: [item('a', '  ')] }, base);
        expect(patch).toEqual({ checklist: undefined });
        expect(Object.hasOwn(patch, 'checklist')).toBe(true);
        expect({ ...base, ...patch }).toMatchObject({ id: 'task', title: 'Keep this task', status: 'inbox' });
    });
    it('cleans legacy empty data even when an editor is saved without other changes', () => {
        for (const checklist of [[], [item('empty', '')]]) {
            const base = task(checklist);
            expect(contentDraftPatch(base, base, base)).toEqual({ checklist: undefined });
        }
    });
    it('removes blank rows alongside real rows and preserves checked steps', () => {
        const base = task([item('a', 'Milk', true), item('b', ' ')]);
        expect(contentDraftPatch(base, base, base)).toEqual({ checklist: [item('a', 'Milk', true)] });
    });
    it('does not erase a newer remote checklist when the local edit has no meaningful change', () => {
        const base = task([item('empty', '')]);
        const latest = task([item('remote', 'New step')]);
        expect(contentDraftPatch(base, { ...base, description: 'Local note' }, latest)).toEqual({ description: 'Local note' });
    });
    it('rejects clearing content that another device changed', () => {
        const base = task([item('a', 'Milk')]);
        expect(() => contentDraftPatch(base, { ...base, checklist: [] }, task([item('a', 'Eggs')]))).toThrow(/changed on another device/);
    });
});
