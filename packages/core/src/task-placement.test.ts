import { describe, expect, it } from 'vitest';
import { taskPlacementUpdates, taskTreeRows, type TaskDropPosition } from './task-hierarchy';
import type { Task } from './types';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: id, status: 'inbox', contexts: [], tags: [],
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...extra,
});
function place(tasks: Task[], source: string, target: string | undefined, position: TaskDropPosition) {
    const changes = taskPlacementUpdates(tasks, source, target, position);
    return tasks.map(task => ({ ...task, ...changes.find(change => change.id === task.id)?.updates }));
}
const ids = (tasks: Task[]) => taskTreeRows(tasks).map(row => row.task.id);

describe('task placement', () => {
    it('inserts before and after instead of swapping or nesting', () => {
        const tasks = [task('a'), task('b'), task('c')];
        const before = place(tasks, 'c', 'a', 'before');
        expect(ids(before)).toEqual(['c', 'a', 'b']);
        expect(ids(place(before, 'c', 'b', 'after'))).toEqual(['a', 'b', 'c']);
        expect(before.every(task => !task.parentTaskId)).toBe(true);
    });
    it('keeps persisted order after transport reloads tasks in a different array order', () => {
        const next = place([task('a'), task('b'), task('c')], 'c', 'a', 'before');
        expect(ids(JSON.parse(JSON.stringify(next)).reverse())).toEqual(['c', 'a', 'b']);
    });
    it('nests in the centre and appends after existing children', () => {
        const tasks = [task('parent'), task('old', { parentTaskId: 'parent' }), task('new')];
        const next = place(tasks, 'new', 'parent', 'inside');
        expect(next.find(task => task.id === 'new')?.parentTaskId).toBe('parent');
        expect(ids(next)).toEqual(['parent', 'old', 'new']);
    });
    it('reorders siblings without changing their parent', () => {
        const tasks = [task('parent'), task('a', { parentTaskId: 'parent' }), task('b', { parentTaskId: 'parent' })];
        const next = place(tasks, 'b', 'a', 'before');
        expect(ids(next)).toEqual(['parent', 'b', 'a']);
        expect(next.find(task => task.id === 'b')?.parentTaskId).toBe('parent');
    });
    it('moves a whole subtree to a root edge without flattening its descendants', () => {
        const tasks = [task('parent'), task('child', { parentTaskId: 'parent' }), task('grandchild', { parentTaskId: 'child' })];
        const next = place(tasks, 'child', 'parent', 'before');
        expect(ids(next)).toEqual(['child', 'grandchild', 'parent']);
        expect(next.find(task => task.id === 'child')?.parentTaskId).toBeUndefined();
        expect(next.find(task => task.id === 'grandchild')?.parentTaskId).toBe('child');
    });
    it('preserves hidden siblings and content, status, planning and deadlines', () => {
        const tasks = [task('a'), task('hidden', { status: 'waiting' }), task('b', {
            dueDate: '2040-01-01', description: 'Keep me', planner: { version: 1, blocks: [], days: [] },
        })];
        const next = place(tasks, 'b', 'a', 'before');
        expect(ids(next)).toEqual(['b', 'a', 'hidden']);
        for (const before of tasks) {
            const { order: _order, orderNum: _alias, ...after } = next.find(task => task.id === before.id)!;
            expect(after).toEqual(before);
        }
    });
    it('rejects self, descendants and missing or deleted destinations', () => {
        const tasks = [task('parent'), task('child', { parentTaskId: 'parent' }), task('gone', { deletedAt: '2026-09-02T00:00:00Z' })];
        expect(() => place(tasks, 'parent', 'parent', 'inside')).toThrow();
        expect(() => place(tasks, 'parent', 'child', 'inside')).toThrow();
        expect(() => place(tasks, 'parent', 'child', 'before')).toThrow();
        expect(() => place(tasks, 'parent', 'gone', 'before')).toThrow();
        expect(() => place(tasks, 'missing', 'parent', 'inside')).toThrow();
        expect(() => place(tasks, 'parent', undefined, 'after')).toThrow();
    });
    it('supports moving out and treats an unchanged parent as a no-op', () => {
        const tasks = [task('parent'), task('child', { parentTaskId: 'parent' })];
        expect(taskPlacementUpdates(tasks, 'child', 'parent', 'inside')).toEqual([]);
        expect(place(tasks, 'child', undefined, 'inside').find(task => task.id === 'child')?.parentTaskId).toBeUndefined();
    });
    it('supports the legacy order alias and stable ties without rewriting data on render', () => {
        const tasks = [task('a', { orderNum: 2 }), task('b', { order: 1 }), task('c', { order: 1 })];
        const snapshot = structuredClone(tasks);
        expect(ids(tasks)).toEqual(['b', 'c', 'a']);
        expect(tasks).toEqual(snapshot);
    });
});
