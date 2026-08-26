import { hasTimeComponent, safeParseDate } from './date';
import type { Task } from './types';

type TaskTimeFields = Pick<Task, 'availableAt' | 'scheduledAt' | 'snoozedUntil' | 'startTime'>;

/**
 * Compatibility rule for tasks created before time semantics were split:
 * a date-only startTime meant "available from", while a value with a clock
 * meant a calendar time block. New writes should not use startTime.
 */
export function getTaskAvailableAt(task: TaskTimeFields): string | undefined {
    if (task.availableAt) return task.availableAt;
    if (task.startTime && !hasTimeComponent(task.startTime)) return task.startTime;
    return undefined;
}

export function getTaskScheduledAt(task: TaskTimeFields): string | undefined {
    if (task.scheduledAt) return task.scheduledAt;
    if (task.startTime && hasTimeComponent(task.startTime)) return task.startTime;
    return undefined;
}

export function isTaskAvailable(task: TaskTimeFields, now: Date = new Date()): boolean {
    const available = safeParseDate(getTaskAvailableAt(task));
    return !available || available.getTime() <= now.getTime();
}

export function isTaskSnoozed(task: TaskTimeFields, now: Date = new Date()): boolean {
    const snoozed = safeParseDate(task.snoozedUntil);
    return Boolean(snoozed && snoozed.getTime() > now.getTime());
}

export function isTaskReadyForNow(task: TaskTimeFields, now: Date = new Date()): boolean {
    return isTaskAvailable(task, now) && !isTaskSnoozed(task, now);
}
