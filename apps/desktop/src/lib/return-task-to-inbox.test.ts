import { beforeEach, expect, it, vi } from 'vitest';
import type { Task } from '@mindwtr/core';
import { returnTaskToInbox } from './return-task-to-inbox';
const mocks = vi.hoisted(() => ({ task: {} as Task, toast: vi.fn(), patches: [] as Partial<Task>[], undo: undefined as undefined | (() => void) }));
vi.mock('./lifecycle-actions', () => ({ editTask: async (_id: string, build: (task: Task) => Partial<Task>) => {
    const patch = build(mocks.task); mocks.patches.push(patch); mocks.task = { ...mocks.task, ...patch };
} }));
vi.mock('./undo-registry', () => ({ registerUndoableAction: (action: () => void) => { mocks.undo = action; return action; } }));
vi.mock('../store/ui-store', () => ({ useUiStore: { getState: () => ({ showToast: mocks.toast }) } }));
beforeEach(() => {
    mocks.task = { id: 'task', status: 'waiting', description: 'body', parentTaskId: 'parent', dueDate: '2040-01-01', scheduledAt: '2040-01-01T10:00:00Z', checklist: [{ id: 'step', title: 'step', isCompleted: false }] } as Task;
    mocks.patches.length = 0; mocks.toast.mockClear(); mocks.undo = undefined;
});
it('only changes workflow, preserving dates, hierarchy and content; undo restores the prior state', async () => {
    const before = { ...mocks.task };
    await returnTaskToInbox('task', false);
    expect(mocks.patches).toEqual([{ status: 'inbox' }]);
    expect(mocks.task).toEqual({ ...before, status: 'inbox' });
    mocks.undo!(); await Promise.resolve();
    expect(mocks.task).toEqual(before);
});
it('does not overwrite a newer workflow decision on undo', async () => {
    await returnTaskToInbox('task', true);
    mocks.task.status = 'someday';
    mocks.undo!(); await Promise.resolve();
    expect(mocks.task.status).toBe('someday');
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.stringContaining('较新的修改'), 'error');
});
it('does not reopen a completed task through this action', async () => {
    mocks.task.status = 'done';
    await expect(returnTaskToInbox('task', false)).rejects.toThrow('Reopen');
    expect(mocks.patches).toHaveLength(0);
});
