import { hasTimeComponent, safeParseDate } from './date';
import type { Task } from './types';

type TaskTimeFields = Pick<Task, 'availableAt' | 'scheduledAt' | 'snoozedUntil' | 'startTime'>;
type TaskAttentionFields = TaskTimeFields & Pick<Task, 'status'>;
type TaskUnschedulePatch = Pick<Partial<Task>, 'scheduledAt' | 'startTime' | 'relativeStartOffset'>;
type TaskAvailabilityPatch = Pick<Partial<Task>, 'availableAt' | 'startTime' | 'relativeStartOffset'>;

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

/**
 * Write a semantic availability value and retire a legacy date-only fallback
 * when one exists. Callers do not need to remember how startTime was encoded.
 */
export function getTaskAvailabilityPatch(
    task: Pick<Task, 'startTime'>,
    availableAt: string | undefined,
): TaskAvailabilityPatch {
    if (task.startTime && !hasTimeComponent(task.startTime)) {
        return {
            availableAt,
            startTime: undefined,
            relativeStartOffset: undefined,
        };
    }
    return { availableAt };
}

/**
 * Write a semantic time block and retire a legacy timed fallback when one
 * exists. This is the shared desktop/mobile calendar write seam.
 */
export function getTaskSchedulePatch(
    task: Pick<Task, 'startTime'>,
    scheduledAt: string | undefined,
): TaskUnschedulePatch {
    if (task.startTime && hasTimeComponent(task.startTime)) {
        return {
            scheduledAt,
            startTime: undefined,
            relativeStartOffset: undefined,
        };
    }
    return { scheduledAt };
}

/**
 * Remove an exact time block without deleting a legacy date-only availability
 * value. A timed legacy start is itself a schedule fallback and must be cleared
 * with scheduledAt, otherwise it immediately resurrects the calendar block.
 */
export function getTaskUnschedulePatch(task: Pick<Task, 'startTime'>): TaskUnschedulePatch {
    return getTaskSchedulePatch(task, undefined);
}

export function isTaskAvailable(task: TaskTimeFields, now: Date = new Date()): boolean {
    const available = safeParseDate(getTaskAvailableAt(task));
    return !available || available.getTime() <= now.getTime();
}

export function isTaskSnoozed(task: TaskTimeFields, now: Date = new Date()): boolean {
    const snoozed = safeParseDate(task.snoozedUntil);
    return Boolean(snoozed && snoozed.getTime() > now.getTime());
}

export function isTaskScheduledInFuture(task: TaskTimeFields, now: Date = new Date()): boolean {
    const scheduled = safeParseDate(getTaskScheduledAt(task));
    return Boolean(scheduled && scheduled.getTime() > now.getTime());
}

/** Shared qualification for Today commitments, time blocks, Ready, and NOW. */
export function isTaskAttentionEligible(task: TaskAttentionFields, now: Date = new Date()): boolean {
    return task.status === 'next' && isTaskAvailable(task, now);
}

/** Snooze is intentionally a NOW-only suppression, not a change to Today eligibility. */
export function isTaskReadyForNow(task: TaskAttentionFields, now: Date = new Date()): boolean {
    return isTaskAttentionEligible(task, now)
        && !isTaskSnoozed(task, now)
        && !isTaskScheduledInFuture(task, now);
}
