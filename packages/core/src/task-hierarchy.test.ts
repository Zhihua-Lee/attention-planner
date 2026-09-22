import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskParentError, taskTreeRows } from './task-hierarchy';
import { createNextRecurringTask } from './recurrence';
import { activeWorkBlocks, scheduleWork } from './planner';
import { mergeAppData } from './sync';
import { normalizeTaskForContentComparison } from './sync-signatures';
import { taskFromSqliteRow, taskToSqliteRow, TASK_SQLITE_COLUMNS } from './task-sync-schema';
import { assertPlannerSyncDestination } from './sync-backend-io';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Task } from './types';
const task = (id: string, patch: Partial<Task> = {}): Task => ({ id, title: id, status: 'inbox', tags: [], contexts: [], createdAt: '2026-09-22T09:00:00Z', updatedAt: '2026-09-22T09:00:00Z', ...patch });
const data = (tasks: Task[]): AppData => ({ tasks, projects: [], areas: [], sections: [], settings: {} });

describe('independent task hierarchy', () => {
    it('rejects self, descendants, missing and deleted destinations', () => {
        const tasks = [task('a'), task('b', { parentTaskId: 'a' }), task('c', { parentTaskId: 'b' }), task('deleted', { deletedAt: '2026-09-22' })];
        for (const parent of ['a', 'b', 'c', 'missing', 'deleted', '', null]) expect(taskParentError(tasks, 'a', parent)).toBeTruthy();
        expect(taskParentError(tasks, 'c', 'a')).toBeUndefined();
        expect(taskParentError(tasks, 'b', undefined)).toBeUndefined();
    });
    it('renders each task once, keeps orphans visible, and resolves concurrent cycles only in the view', () => {
        const tasks = [task('b', { parentTaskId: 'a' }), task('a', { parentTaskId: 'b' }), task('c', { parentTaskId: 'b' }), task('orphan', { parentTaskId: 'absent' })];
        const snapshot = structuredClone(tasks);
        expect(taskTreeRows(tasks).map(row => [row.task.id, row.depth])).toEqual([['a', 0], ['b', 1], ['c', 2], ['orphan', 0]]);
        expect(tasks).toEqual(snapshot);
        expect(taskTreeRows([tasks[2]])[0].depth).toBe(0);
        const deep = Array.from({ length: 10000 }, (_, i) => task(String(i), { parentTaskId: i ? String(i - 1) : undefined }));
        expect(taskTreeRows(deep).at(-1)?.depth).toBe(9999);
    });
    it('round-trips parent links and explicit detach through SQLite and JSON merge', () => {
        const child = task('child', { parentTaskId: 'parent', rev: 1 });
        const row = Object.fromEntries(TASK_SQLITE_COLUMNS.map((key, index) => [key, taskToSqliteRow(child)[index]]));
        expect(taskFromSqliteRow(row).parentTaskId).toBe('parent');
        const newer = { ...child, parentTaskId: undefined, rev: 2, updatedAt: '2026-09-22T12:00:00Z' };
        expect(normalizeTaskForContentComparison(child)).not.toEqual(normalizeTaskForContentComparison(newer));
        expect(mergeAppData(data([child]), data(JSON.parse(JSON.stringify([child])))).tasks[0].parentTaskId).toBe('parent');
        expect(mergeAppData(data([child]), data(JSON.parse(JSON.stringify([newer])))).tasks[0].parentTaskId).toBeUndefined();
    });
    it('keeps recurring successors under their parent without copying sibling tasks', () => {
        const recurring = task('child', { parentTaskId: 'parent', status: 'next', availableAt: '2026-09-22', recurrence: { rule: 'daily' } });
        expect(createNextRecurringTask(recurring, '2026-09-22T12:00:00Z', 'next')?.parentTaskId).toBe('parent');
    });
    it('refuses unsupported CloudKit before dropping a hierarchy-only field', () => {
        expect(() => assertPlannerSyncDestination({ backend: 'cloudkit', cloudProvider: 'selfhosted', dropboxRev: null }, data([task('child', { parentTaskId: 'parent' })]))).toThrow('independent subtasks');
    });
});

describe('hierarchy store mutations', () => {
    beforeEach(() => {
        resetForTests();
        setStorageAdapter({ getData: vi.fn().mockResolvedValue(data([])), saveData: vi.fn().mockResolvedValue(undefined) });
        useTaskStore.setState({ tasks: [], _allTasks: [], projects: [], _allProjects: [], sections: [], _allSections: [], areas: [], _allAreas: [], settings: {}, error: null, isLoading: false });
    });
    afterEach(async () => { await flushPendingSave(); resetForTests(); });
    it('moves only the relationship, preserves child scheduling and does not cascade completion/deletion', async () => {
        const store = useTaskStore.getState();
        const parent = (await store.addTask('Parent')).id!;
        const child = (await store.addTask('Child', { description: 'Body', status: 'next', availableAt: '2026-09-23', dueDate: '2026-09-25', repeatReminderMinutes: 15, recurrence: { rule: 'daily' }, attachments: [{ id: 'link', kind: 'link', title: 'Link', uri: 'https://example.com', createdAt: '2026-09-22', updatedAt: '2026-09-22' }] })).id!;
        const unscheduled = useTaskStore.getState()._tasksById.get(child)!;
        await store.updateTask(child, scheduleWork(unscheduled, { id: 'allocation', startAt: '2026-09-24T10:00:00Z', durationMinutes: 30, timeZone: 'UTC' }, { now: new Date('2026-09-22T10:00:00Z'), deviceId: 'test' }));
        const before = structuredClone(useTaskStore.getState()._tasksById.get(child)!);
        expect((await store.updateTask(child, { parentTaskId: parent })).success).toBe(true);
        const moved = useTaskStore.getState()._tasksById.get(child)!;
        expect(activeWorkBlocks(moved)).toEqual(activeWorkBlocks(before));
        expect(moved.planner!.contentStamp!.manualRevision).toBeGreaterThan(before.planner!.contentStamp?.manualRevision ?? 0);
        expect(mergeAppData(data([before]), data([moved])).tasks[0].parentTaskId).toBe(parent);
        for (const key of ['description', 'status', 'availableAt', 'dueDate', 'repeatReminderMinutes', 'recurrence', 'attachments'] as const) expect(moved[key]).toEqual(before[key]);
        expect((await store.updateTask(parent, { parentTaskId: child })).success).toBe(false);
        await store.updateTask(parent, { status: 'done' });
        await store.deleteTask(parent);
        expect(useTaskStore.getState()._tasksById.get(child)).toMatchObject({ status: 'next', parentTaskId: parent });
        expect(useTaskStore.getState().tasks.some(item => item.id === child)).toBe(true);
        expect((await store.updateTask(child, { parentTaskId: undefined })).success).toBe(true);
        expect(useTaskStore.getState()._tasksById.get(child)?.parentTaskId).toBeUndefined();
        expect(mergeAppData(data([moved]), data([useTaskStore.getState()._tasksById.get(child)!])).tasks[0].parentTaskId).toBeUndefined();
    });
    it('validates batch cycles atomically and new tasks with stale parents', async () => {
        const store = useTaskStore.getState();
        const a = (await store.addTask('A')).id!, b = (await store.addTask('B')).id!;
        expect((await store.batchUpdateTasks([{ id: a, updates: { parentTaskId: b } }, { id: b, updates: { parentTaskId: a } }])).success).toBe(false);
        expect(useTaskStore.getState().tasks.every(item => !item.parentTaskId)).toBe(true);
        expect((await store.addTask('Lost', { parentTaskId: 'absent' })).success).toBe(false);
        expect(useTaskStore.getState().tasks).toHaveLength(2);
    });
});
