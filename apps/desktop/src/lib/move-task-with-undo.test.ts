import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { useTaskStore, type Task } from '@mindwtr/core';
import { useUiStore } from '../store/ui-store';
import { moveTaskWithUndo } from './move-task-with-undo';
import { clearUndoableAction, takeUndoableAction } from './undo-registry';
const initialState = useTaskStore.getState();
const task = (id: string): Task => ({ id, title: id, status: 'inbox', tags: [], contexts: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
describe('hierarchy move recovery', () => {
    beforeEach(() => {
        useTaskStore.setState(initialState, true);
        const tasks = ['child', 'a', 'b'].map(task);
        useTaskStore.setState({ tasks, _allTasks: tasks, projects: [], _allProjects: [], settings: {} });
        localStorage.setItem('attention-planner:pre-planner-v1', 'verified-test-backup');
        clearUndoableAction();
    });
    afterEach(() => {
        useUiStore.getState().toasts.forEach(toast => useUiStore.getState().dismissToast(toast.id));
        vi.restoreAllMocks();
    });
    it('undo preserves text edited after the move', async () => {
        await moveTaskWithUndo('child', 'a', false);
        await useTaskStore.getState().updateTask('child', { description: 'A later edit' });
        takeUndoableAction()?.();
        await waitFor(() => expect(useTaskStore.getState().tasks.find(item => item.id === 'child')).toMatchObject({ description: 'A later edit', parentTaskId: undefined }));
    });
    it('a stale toast cannot undo a newer placement', async () => {
        await moveTaskWithUndo('child', 'a', false);
        const earlier = useUiStore.getState().toasts.slice(-1)[0]!.action!;
        await moveTaskWithUndo('child', 'b', false);
        earlier.onClick();
        await waitFor(() => expect(useUiStore.getState().toasts.slice(-1)[0]?.tone).toBe('error'));
        expect(useTaskStore.getState().tasks.find(item => item.id === 'child')?.parentTaskId).toBe('b');
    });
    it('an invalid or failed move registers no success or undo', async () => {
        await expect(moveTaskWithUndo('child', 'child', false)).rejects.toThrow();
        expect(takeUndoableAction()).toBeNull();
        expect(useTaskStore.getState().tasks.find(item => item.id === 'child')?.parentTaskId).toBeUndefined();
    });
});
