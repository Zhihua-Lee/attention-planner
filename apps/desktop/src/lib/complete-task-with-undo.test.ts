import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { useTaskStore, type Task } from '@mindwtr/core';
import { useUiStore } from '../store/ui-store';
import { completeTaskWithUndo } from './complete-task-with-undo';
import { clearUndoableAction, takeUndoableAction } from './undo-registry';

const initialState = useTaskStore.getState();
const t = (key: string) => key;
const task: Task = {
    id: 'recovery-task', title: 'Prepare report', status: 'next', isFocusedToday: true,
    description: 'Keep this content', scheduledAt: '2026-09-14T16:00:00Z',
    contexts: [], tags: [], createdAt: '2026-09-14T10:00:00Z', updatedAt: '2026-09-14T10:00:00Z',
};

describe('completeTaskWithUndo', () => {
    beforeEach(() => {
        useTaskStore.setState(initialState, true);
        useTaskStore.setState({ tasks: [task], _allTasks: [task], _allProjects: [], projects: [], settings: {} });
        clearUndoableAction();
    });
    afterEach(() => {
        useUiStore.getState().toasts.forEach(toast => useUiStore.getState().dismissToast(toast.id));
        vi.restoreAllMocks();
    });

    it('restores status and Today without losing schedule or edits made after completion', async () => {
        expect(await completeTaskWithUndo(task.id, t)).toBe(true);
        expect(useTaskStore.getState().tasks[0].status).toBe('done');
        await useTaskStore.getState().updateTask(task.id, { description: 'A newer edit' });
        const toast = useUiStore.getState().toasts.slice(-1)[0]!;
        expect(toast.message).toContain(task.title);
        toast.action!.onClick();
        await waitFor(() => expect(useTaskStore.getState().tasks[0]).toMatchObject({
            status: 'next', isFocusedToday: true, description: 'A newer edit', scheduledAt: task.scheduledAt,
        }));
        expect(useTaskStore.getState().tasks[0].completedAt).toBeUndefined();
    });

    it('keeps keyboard recovery available when undo notifications are disabled', async () => {
        useTaskStore.setState({ settings: { undoNotificationsEnabled: false } });
        await completeTaskWithUndo(task.id, t);
        expect(useUiStore.getState().toasts).toHaveLength(0);
        takeUndoableAction()?.();
        await waitFor(() => expect(useTaskStore.getState().tasks[0].status).toBe('next'));
    });

    it('does not replace the undo action when an already completed task is clicked again', async () => {
        await completeTaskWithUndo(task.id, t);
        expect(await completeTaskWithUndo(task.id, t)).toBe(false);
        expect(useUiStore.getState().toasts).toHaveLength(1);
        takeUndoableAction()?.();
        await waitFor(() => expect(useTaskStore.getState().tasks[0].status).toBe('next'));
    });

    it('reports failed completion without registering a false success or undo', async () => {
        vi.spyOn(useTaskStore.getState(), 'updateTask').mockResolvedValue({ success: false, error: 'Storage unavailable' });
        expect(await completeTaskWithUndo(task.id, t)).toBe(false);
        expect(takeUndoableAction()).toBeNull();
        expect(useUiStore.getState().toasts.slice(-1)[0]?.tone).toBe('error');
        expect(useTaskStore.getState().tasks[0].status).toBe('next');
    });
});
