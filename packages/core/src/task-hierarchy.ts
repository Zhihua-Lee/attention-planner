import type { Task } from './types';

/** Validate against the latest snapshot, including all patches in a batch. */
export function taskParentError(tasks: readonly Task[], taskId: string, parentTaskId: unknown): string | undefined {
    if (parentTaskId === undefined) return undefined;
    if (typeof parentTaskId !== 'string' || !parentTaskId.trim()) return 'Choose a valid parent task.';
    const byId = new Map(tasks.map(task => [task.id, task]));
    const parent = byId.get(parentTaskId);
    if (!parent || parent.deletedAt || parent.purgedAt) return 'The parent task is no longer available.';
    const seen = new Set([taskId]);
    let current: string | undefined = parentTaskId;
    while (current) {
        if (seen.has(current)) return 'A task cannot be moved into itself or its descendants.';
        seen.add(current);
        current = byId.get(current)?.parentTaskId;
    }
    return undefined;
}

export type TaskTreeRow = { task: Task; depth: number };

/**
 * A projection, never a data rewrite. Filtered/missing/deleted parents leave children
 * at the root. Concurrent offline moves can form a cycle: cut its smallest ID in
 * this view, deterministically, so every task remains visible and can be moved out.
 * Iterative traversal also handles imported deeply nested lists without stack overflow.
 */
export function taskTreeRows(tasks: readonly Task[]): TaskTreeRow[] {
    const byId = new Map(tasks.filter(task => !task.deletedAt && !task.purgedAt).map(task => [task.id, task]));
    const parents = new Map<string, string>();
    for (const task of byId.values()) {
        if (task.parentTaskId && byId.has(task.parentTaskId)) parents.set(task.id, task.parentTaskId);
    }
    const visited = new Set<string>();
    for (const id of byId.keys()) {
        const path: string[] = [], positions = new Map<string, number>();
        let cursor: string | undefined = id;
        while (cursor && !visited.has(cursor)) {
            const cycleStart = positions.get(cursor);
            if (cycleStart !== undefined) {
                parents.delete(path.slice(cycleStart).sort()[0]);
                break;
            }
            positions.set(cursor, path.length);
            path.push(cursor);
            cursor = parents.get(cursor);
        }
        for (const item of path) visited.add(item);
    }
    const children = new Map<string | undefined, Task[]>();
    for (const task of byId.values()) {
        const parent = parents.get(task.id);
        const siblings = children.get(parent) ?? [];
        siblings.push(task);
        children.set(parent, siblings);
    }
    const pending = (children.get(undefined) ?? []).map(task => ({ task, depth: 0 })).reverse();
    const result: TaskTreeRow[] = [];
    while (pending.length) {
        const row = pending.pop()!;
        result.push(row);
        const nested = children.get(row.task.id) ?? [];
        for (let i = nested.length - 1; i >= 0; i--) pending.push({ task: nested[i], depth: row.depth + 1 });
    }
    return result;
}
