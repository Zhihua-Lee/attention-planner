import { taskPlanner, type Task, type TaskPlanner } from '@mindwtr/core';

/** One saved change made on the task page, as the stored task before and after it. */
export type TaskEdit = { before: Task; after: Task };

const TASK_KEYS = ['title', 'description', 'checklist', 'dueDate', 'availableAt', 'timeEstimate', 'projectId', 'areaId', 'recurrence', 'status'] as const;
const PLANNER_KEYS = ['days', 'blocks', 'checklistRefresh'] as const;
type TaskKey = typeof TASK_KEYS[number];
type PlannerKey = typeof PLANNER_KEYS[number];
export type EditKey = TaskKey | PlannerKey;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Which undoable parts differ between two stored versions of a task. */
export function changedParts(before: Task, after: Task): EditKey[] {
    const planned = (task: Task) => taskPlanner(task);
    return [
        ...TASK_KEYS.filter(key => !same(before[key], after[key])),
        ...PLANNER_KEYS.filter(key => !same(planned(before)[key], planned(after)[key])),
    ];
}

/**
 * The patch that returns `latest` to `edit.before`, part by part. A part that was changed again
 * after this edit (here or on another device) is left alone and reported as a conflict.
 */
export function undoPatch(latest: Task, edit: TaskEdit): { patch: Partial<Task>; conflicts: EditKey[] } {
    const patch: Partial<Task> = {}, conflicts: EditKey[] = [];
    const parts = changedParts(edit.before, edit.after);
    for (const key of TASK_KEYS) {
        if (!parts.includes(key)) continue;
        if (same(latest[key], edit.after[key])) Object.assign(patch, { [key]: edit.before[key] });
        else conflicts.push(key);
    }
    const current = taskPlanner(latest), before = taskPlanner(edit.before), after = taskPlanner(edit.after);
    const planner: TaskPlanner = { ...current };
    let plannerChanged = false;
    for (const key of PLANNER_KEYS) {
        if (!parts.includes(key)) continue;
        if (same(current[key], after[key])) { Object.assign(planner, { [key]: before[key] }); plannerChanged = true; }
        else conflicts.push(key);
    }
    if (plannerChanged) patch.planner = planner;
    return { patch, conflicts };
}

export function editLabel(parts: readonly EditKey[], zh: boolean): string {
    const names: Record<EditKey, [string, string]> = {
        title: ['title', '标题'], description: ['note', '正文'], checklist: ['checklist', '清单'], dueDate: ['due date', '截止'],
        availableAt: ['start date', '可以开始'], timeEstimate: ['estimate', '预计'], projectId: ['belonging', '归属'], areaId: ['belonging', '归属'],
        recurrence: ['repeat', '重复'], status: ['status', '状态'], days: ['day to do', '哪天想做'], blocks: ['time blocks', '时段'], checklistRefresh: ['checklist', '清单'],
    };
    return [...new Set(parts.map(part => names[part][zh ? 1 : 0]))].join(zh ? '、' : ', ');
}
