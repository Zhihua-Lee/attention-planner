import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTaskStore, type Task } from '@mindwtr/core';
import { useUiStore } from '../store/ui-store';
import { commitTaskText, FieldConflict, insertChecklistItem, moveChecklistItem, removeChecklistItem, renameChecklistItem } from './task-field-edits';
import { clearUndoableAction, takeUndoableAction } from './undo-registry';
import { requestSave, SAVE_EVENT, type SaveRequest } from './save-shortcut';

const initialState = useTaskStore.getState();
const base: Task = {
    id: 't', title: 'Plan', description: 'Old note', status: 'next', tags: [], contexts: [], createdAt: '2026-09-28T00:00:00Z', updatedAt: '2026-09-28T00:00:00Z',
    checklist: [{ id: 'a', title: 'One', isCompleted: false }, { id: 'b', title: 'Two', isCompleted: true }],
};
const latest = () => useTaskStore.getState()._allTasks[0];

describe('in-place task edits', () => {
    beforeEach(() => {
        localStorage.setItem('attention-planner:pre-planner-v1', '{}');
        useTaskStore.setState(initialState, true);
        useTaskStore.setState({ tasks: [base], _allTasks: [base], _allProjects: [], projects: [], settings: {} });
        clearUndoableAction();
    });
    afterEach(() => { useUiStore.getState().toasts.forEach(toast => useUiStore.getState().dismissToast(toast.id)); localStorage.removeItem('attention-planner:pre-planner-v1'); });

    it('commits a text field only over the value it started from', async () => {
        await commitTaskText('t', 'title', 'Plan', '  Plan the week  ');
        expect(latest().title).toBe('Plan the week');
        await expect(commitTaskText('t', 'title', 'Plan', 'Something else')).rejects.toBeInstanceOf(FieldConflict);
        expect(latest().title).toBe('Plan the week');
        await commitTaskText('t', 'title', 'Plan', 'Mine wins', true);
        expect(latest().title).toBe('Mine wins');
        await expect(commitTaskText('t', 'title', 'Mine wins', '   ')).rejects.toThrow(/needs a name/);
        await commitTaskText('t', 'description', 'Old note', '  ');
        expect(latest().description).toBeUndefined();
    });
    it('edits checklist items by id against the latest list', async () => {
        await renameChecklistItem('t', 'a', 'One', 'One\nwith a second line');
        expect(latest().checklist![0].title).toBe('One\nwith a second line');
        await expect(renameChecklistItem('t', 'a', 'One', 'Stale')).rejects.toBeInstanceOf(FieldConflict);
        await insertChecklistItem('t', 'a', { id: 'c', title: 'Between' });
        await insertChecklistItem('t', null, { id: 'd', title: 'First' });
        expect(latest().checklist!.map(item => item.id)).toEqual(['d', 'a', 'c', 'b']);
        await moveChecklistItem('t', 'b', 0);
        expect(latest().checklist!.map(item => item.id)).toEqual(['b', 'd', 'a', 'c']);
        expect(latest().checklist!.find(item => item.id === 'b')!.isCompleted).toBe(true);
    });
    it('deletes a step with an undo that restores it in place', async () => {
        await removeChecklistItem('t', 'a', false);
        expect(latest().checklist!.map(item => item.id)).toEqual(['b']);
        takeUndoableAction()?.();
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(latest().checklist!.map(item => item.id)).toEqual(['a', 'b']);
    });
});

describe('save shortcut requests', () => {
    it('waits for every registered commit and reports failures and own feedback', async () => {
        const order: string[] = [];
        const listener = (event: Event) => {
            const request = (event as CustomEvent<SaveRequest>).detail;
            request.pending.push(new Promise(resolve => setTimeout(() => { order.push('committed'); resolve(null); }, 10)));
            request.pending.push(Promise.reject(new Error('conflict')));
            request.announced = true;
        };
        window.addEventListener(SAVE_EVENT, listener);
        try {
            const outcome = await requestSave();
            order.push('done');
            expect(outcome).toEqual({ ok: false, announced: true });
            expect(order).toEqual(['committed', 'done']);
        } finally { window.removeEventListener(SAVE_EVENT, listener); }
    });
});
