import type { Task } from '../../../packages/core/src/types';
import { taskPlanner, type PlanStamp, type TaskPlanner } from '../../../packages/core/src/planner';
import { getTaskAvailableAt } from '../../../packages/core/src/task-time-semantics';

const stamp = (value: PlanStamp): PlanStamp => ({ revision: value.revision, manualRevision: value.manualRevision,
    updatedAt: value.updatedAt, deviceId: value.deviceId, manualAt: value.manualAt, manualBy: value.manualBy });
/** Display projection only. Never use this to replace a stored task or discard future fields. */
export function projectPlanner(task: Task): TaskPlanner {
    const value = taskPlanner(task);
    return { version: 1, contentStamp: value.contentStamp && stamp(value.contentStamp),
        blocks: value.blocks.map(b => ({ ...stamp(b), id: b.id, startAt: b.startAt, timeZone: b.timeZone,
            allocatedMinutes: b.allocatedMinutes, completedMinutes: b.completedMinutes, durationMinutes: b.durationMinutes,
            state: b.state, origin: b.origin, reason: b.reason,
            history: b.history.map(h => ({ startAt: h.startAt, durationMinutes: h.durationMinutes, at: h.at, reason: h.reason })) })),
        days: value.days.map(d => ({ ...stamp(d), date: d.date, selected: d.selected })),
        legacyFocus: value.legacyFocus, skippedAt: value.skippedAt, legacySchedule: value.legacySchedule };
}
export function projectRecurrence(value: Task['recurrence']): Task['recurrence'] {
    if (!value) return undefined;
    if (typeof value === 'string') return value;
    return { rule: value.rule, seriesId: value.seriesId, strategy: value.strategy,
        byDay: value.byDay?.map(day => day), byMonthDay: value.byMonthDay?.map(day => day),
        weekStart: value.weekStart, count: value.count, until: value.until,
        completedOccurrences: value.completedOccurrences, anchorDay: value.anchorDay,
        startAnchorDay: value.startAnchorDay, dueAnchorDay: value.dueAnchorDay, reviewAnchorDay: value.reviewAnchorDay, rrule: value.rrule };
}
export function projectTask(task: Task) {
    return { id: task.id, title: task.title, status: task.status, description: task.description,
        parentTaskId: task.parentTaskId, projectId: task.projectId, areaId: task.areaId,
        checklist: task.checklist?.map(item => ({ id: item.id, title: item.title, isCompleted: item.isCompleted })),
        availableAt: getTaskAvailableAt(task), dueDate: task.dueDate, planner: projectPlanner(task),
        recurrence: projectRecurrence(task.recurrence), completedAt: task.completedAt, deletedAt: task.deletedAt };
}
