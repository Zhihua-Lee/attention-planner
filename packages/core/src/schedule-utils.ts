import { isAfter } from 'date-fns';
import { hasTimeComponent, safeParseDate } from './date';
import { stripMarkdown } from './markdown';
import type { NotificationSettings, Project, Task } from './types';
import { getTaskScheduledAt } from './task-time-semantics';

export type ScheduleOptions = {
    includeStartTime?: boolean;
    includeDueDate?: boolean;
    includeReviewAt?: boolean;
};

export type TaskReminderIntentKind = 'start' | 'due' | 'review' | 'due-repeat';

export type TaskReminderIntent = {
    key: string;
    dedupeKey: string;
    taskId: string;
    kind: TaskReminderIntentKind;
    scheduledAt: Date;
    repeatIndex?: number;
};

export type TaskReminderPlan = {
    next: TaskReminderIntent | null;
    repeats: TaskReminderIntent[];
};

export type ProjectReviewReminderIntent = {
    key: string;
    dedupeKey: string;
    projectId: string;
    kind: 'project-review';
    scheduledAt: Date;
};

export const REPEAT_REMINDER_INTERVAL_OPTIONS = [5, 10, 15, 30, 60] as const;
export const REPEAT_REMINDER_MAX_WINDOW_MINUTES = 120;
export const REPEAT_REMINDER_MAX_OCCURRENCES = 8;

const REPEAT_REMINDER_INTERVAL_SET: ReadonlySet<number> = new Set(REPEAT_REMINDER_INTERVAL_OPTIONS);

/**
 * Coerce a stored repeat-reminder interval to an allowed preset, or undefined when off/invalid.
 */
export function normalizeRepeatReminderMinutes(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return REPEAT_REMINDER_INTERVAL_SET.has(value) ? value : undefined;
}

function parseExplicitReminderDate(value: string | undefined | null): Date | null {
    if (!hasTimeComponent(value ?? undefined)) {
        return null;
    }
    return safeParseDate(value ?? undefined);
}

function isInactiveTask(task: Task): boolean {
    return Boolean(
        task.deletedAt
        || task.status === 'done'
        || task.status === 'archived'
        || task.status === 'reference',
    );
}

function getNextTaskReminderIntent(
    task: Task,
    now: Date,
    options: ScheduleOptions,
): TaskReminderIntent | null {
    if (isInactiveTask(task)) return null;

    const includeTaskReminders = task.suppressMindwtrReminders !== true;
    const candidates: TaskReminderIntent[] = [];
    const addCandidate = (
        kind: Exclude<TaskReminderIntentKind, 'due-repeat'>,
        value: string | undefined,
        enabled: boolean,
    ) => {
        if (!enabled) return;
        const scheduledAt = parseExplicitReminderDate(value);
        if (!scheduledAt || !isAfter(scheduledAt, now)) return;
        candidates.push({
            key: `task:${task.id}`,
            dedupeKey: scheduledAt.toISOString(),
            taskId: task.id,
            kind,
            scheduledAt,
        });
    };

    addCandidate(
        'start',
        getTaskScheduledAt(task),
        includeTaskReminders && options.includeStartTime !== false,
    );
    addCandidate(
        'due',
        task.dueDate,
        includeTaskReminders && options.includeDueDate !== false,
    );
    addCandidate('review', task.reviewAt, options.includeReviewAt === true);

    candidates.sort((left, right) =>
        left.scheduledAt.getTime() - right.scheduledAt.getTime(),
    );
    return candidates[0] ?? null;
}

/**
 * Returns the next future scheduled time for a task, based on startTime/dueDate.
 * Used by apps to drive local notification scheduling.
 */
export function getNextScheduledAt(task: Task, now: Date = new Date(), options: ScheduleOptions = {}): Date | null {
    return getNextTaskReminderIntent(task, now, options)?.scheduledAt ?? null;
}

/**
 * Returns the bounded repeat-reminder occurrence times for a task's due time.
 *
 * Repeats anchor on the explicit due *time* only and start at index 1 (`due + N`); the due moment
 * itself stays the task's single due reminder, so callers never double-fire. Returns `[]` when the
 * task is inactive, has no explicit due time, suppresses reminders, has due reminders disabled, or
 * has no valid repeat interval. The occurrence count is bounded by both a window and a hard ceiling:
 * `min(REPEAT_REMINDER_MAX_OCCURRENCES, floor(REPEAT_REMINDER_MAX_WINDOW_MINUTES / interval))`.
 *
 * Pure: callers filter by `now` for delivery.
 */
export function getDueReminderRepeatTimes(task: Task, options: ScheduleOptions = {}): Date[] {
    if (isInactiveTask(task)) return [];
    if (task.suppressMindwtrReminders === true) return [];
    if (options.includeDueDate === false) return [];

    const interval = normalizeRepeatReminderMinutes(task.repeatReminderMinutes);
    if (!interval) return [];

    const due = parseExplicitReminderDate(task.dueDate);
    if (!due) return [];

    const count = Math.min(
        REPEAT_REMINDER_MAX_OCCURRENCES,
        Math.floor(REPEAT_REMINDER_MAX_WINDOW_MINUTES / interval),
    );
    const times: Date[] = [];
    for (let i = 1; i <= count; i += 1) {
        times.push(new Date(due.getTime() + i * interval * 60_000));
    }
    return times;
}

export function getTaskReminderPlan(
    task: Task,
    now: Date = new Date(),
    options: ScheduleOptions = {},
): TaskReminderPlan {
    const repeats = getDueReminderRepeatTimes(task, options).map(
        (scheduledAt, index): TaskReminderIntent => ({
            key: `task:${task.id}:r${index + 1}`,
            dedupeKey: `${task.dueDate}#${index + 1}`,
            taskId: task.id,
            kind: 'due-repeat',
            scheduledAt,
            repeatIndex: index + 1,
        }),
    );
    return {
        next: getNextTaskReminderIntent(task, now, options),
        repeats,
    };
}

export function getProjectReviewReminderIntent(
    project: Project,
    now: Date = new Date(),
): ProjectReviewReminderIntent | null {
    if (project.deletedAt || project.status === 'archived') return null;
    const scheduledAt = parseExplicitReminderDate(project.reviewAt);
    if (!scheduledAt || !isAfter(scheduledAt, now)) return null;
    return {
        key: `project:${project.id}`,
        dedupeKey: scheduledAt.toISOString(),
        projectId: project.id,
        kind: 'project-review',
        scheduledAt,
    };
}

export function getUpcomingSchedules(tasks: Task[], now: Date = new Date(), options: ScheduleOptions = {}) {
    return tasks
        .map((task) => {
            const scheduledAt = getNextScheduledAt(task, now, options);
            return scheduledAt ? { task, scheduledAt } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (a!.scheduledAt.getTime() - b!.scheduledAt.getTime()));
}

export function isDueWithinMinutes(task: Task, minutes: number, now: Date = new Date(), options: ScheduleOptions = {}): boolean {
    const next = getNextScheduledAt(task, now, options);
    if (!next) return false;
    const diffMs = next.getTime() - now.getTime();
    return diffMs >= 0 && diffMs <= minutes * 60 * 1000;
}

export function parseTimeOfDay(value: string | undefined, fallback: { hour: number; minute: number }) {
    if (!value) return fallback;
    const [h, m] = value.split(':');
    const hour = Number.parseInt(h, 10);
    const minute = Number.parseInt(m, 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
    if (hour < 0 || hour > 23) return fallback;
    if (minute < 0 || minute > 59) return fallback;
    return { hour, minute };
}

// --- Reminder gating (shared by desktop's poll loop and mobile's pre-scheduled alarms) ---

/**
 * The master on/off switch. Every other task-reminder gate below is ANDed with this one.
 */
export function areTaskRemindersEnabled(settings: NotificationSettings): boolean {
    return settings.notificationsEnabled !== false;
}

export function areStartDateRemindersEnabled(settings: NotificationSettings): boolean {
    return areTaskRemindersEnabled(settings) && settings.startDateNotificationsEnabled !== false;
}

export function areDueDateRemindersEnabled(settings: NotificationSettings): boolean {
    return areTaskRemindersEnabled(settings) && settings.dueDateNotificationsEnabled !== false;
}

/**
 * Deliberately NOT gated by `areTaskRemindersEnabled`: the weekly review nudge is an
 * independent feature from per-task start/due reminders (a user can want one without the
 * other), matching mobile's existing bail-out semantics.
 */
export function isWeeklyReviewReminderEnabled(settings: NotificationSettings): boolean {
    return settings.weeklyReviewEnabled === true;
}

/**
 * True when at least one alarm-worthy feature is on. Mobile uses this to decide whether a
 * reschedule cycle should bail out early and cancel every pending alarm instead of deriving
 * a schedule.
 */
export function hasActiveMobileNotificationFeature(settings: NotificationSettings): boolean {
    return areTaskRemindersEnabled(settings) || isWeeklyReviewReminderEnabled(settings);
}

// --- Digest scheduling (the three defaults + the weekly-review-day clamp, previously
// duplicated verbatim on both desktop and mobile) ---

export type DigestTimeSlot = { enabled: boolean; hour: number; minute: number };
export type WeeklyReviewSlot = DigestTimeSlot & { day: number };

export type DigestSchedule = {
    morning: DigestTimeSlot;
    evening: DigestTimeSlot;
    weekly: WeeklyReviewSlot;
};

export function getDigestSchedule(settings: NotificationSettings): DigestSchedule {
    const weeklyDay = Number.isFinite(settings.weeklyReviewDay)
        ? Math.max(0, Math.min(6, Math.floor(settings.weeklyReviewDay as number)))
        : 0;
    return {
        morning: {
            enabled: settings.dailyDigestMorningEnabled === true,
            ...parseTimeOfDay(settings.dailyDigestMorningTime, { hour: 9, minute: 0 }),
        },
        evening: {
            enabled: settings.dailyDigestEveningEnabled === true,
            ...parseTimeOfDay(settings.dailyDigestEveningTime, { hour: 20, minute: 0 }),
        },
        weekly: {
            enabled: isWeeklyReviewReminderEnabled(settings),
            day: weeklyDay,
            ...parseTimeOfDay(settings.weeklyReviewTime, { hour: 18, minute: 0 }),
        },
    };
}

function nextDailyTime(hour: number, minute: number, now: Date): Date {
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= now.getTime()) {
        next.setDate(next.getDate() + 1);
    }
    return next;
}

function nextWeeklyTime(dayOfWeekSundayFirst: number, hour: number, minute: number, now: Date): Date {
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);

    const current = next.getDay(); // 0 = Sunday
    let delta = dayOfWeekSundayFirst - current;
    if (delta < 0) {
        delta += 7;
    }
    if (delta === 0 && next.getTime() <= now.getTime()) {
        delta = 7;
    }

    next.setDate(next.getDate() + delta);
    return next;
}

// --- Notification body (moved from desktop so mobile stops showing raw markdown) ---

/**
 * Labels a reminder body with its kind ("Due date reminder", etc.) ahead of the task
 * description, with markdown stripped. Shared so every platform's notification reads the
 * same way instead of each app re-deciding what a reminder body looks like.
 */
export function buildReminderNotificationBody(
    task: Task,
    kind: TaskReminderIntentKind,
    translations: Record<string, string>
): string {
    const reminderLabel = kind === 'start'
        ? (translations['settings.startDateNotifications'] ?? 'Start date reminder')
        : kind === 'due' || kind === 'due-repeat'
            ? (translations['settings.dueDateNotifications'] ?? 'Due date reminder')
            : kind === 'review'
                ? (translations['settings.reviewAtNotifications'] ?? 'Review date reminder')
                : (translations['settings.notifications'] ?? 'Task reminder');
    const description = stripMarkdown(task.description || '').trim();
    return description ? `${reminderLabel}\n${description}` : reminderLabel;
}

// --- Full reminder schedule derivation (the "derive" half of ADR 0013's derive/effect split) ---

export type ReminderScheduleRequest = {
    key: string;
    title: string;
    message: string;
    fireAt: Date;
    repeatInterval?: 'daily' | 'weekly';
    hasSnoozeAction?: boolean;
    hasCompleteAction?: boolean;
    data: Record<string, string>;
};

export type ReminderScheduleDiagnostics = {
    taskRemindersEnabled: boolean;
    includeStartTime: boolean;
    includeDueDate: boolean;
    includeReviewAt: boolean;
    weeklyReviewEnabled: boolean;
    dateOnlyDueDateCount: number;
    futureDueDateReminderCount: number;
    pastDueDateReminderCount: number;
    dateOnlyStartTimeCount: number;
    futureStartTimeReminderCount: number;
    pastStartTimeReminderCount: number;
    futureTaskReviewReminderCount: number;
    pastTaskReviewReminderCount: number;
    suppressedTaskReminderCount: number;
    taskReminderCount: number;
    taskReviewReminderCount: number;
    projectReviewReminderCount: number;
    oneShotReminderCount: number;
};

export type ReminderScheduleInput = {
    settings: NotificationSettings;
    tasks: Task[];
    projects: Project[];
    /** Defaults to `new Date()`. Pass explicitly in tests for deterministic output. */
    now?: Date;
    translations: Record<string, string>;
    /** Platform cap on pending one-shot alarms (e.g. 60 on iOS, 200 on Android). Omit for no cap. */
    maxOneShotReminders?: number;
};

export type ReminderSchedule = {
    /** Recurring digest/weekly-review entries (always included when enabled, never capped),
     * followed by one-shot task/project entries (sorted by fire time, then capped). */
    requests: ReminderScheduleRequest[];
    diagnostics: ReminderScheduleDiagnostics;
};

/**
 * Derives the full set of reminders a platform that pre-schedules alarms (mobile) needs to
 * arm: daily digests, the weekly review, every task's next reminder plus its bounded due-time
 * repeats (via `getTaskReminderPlan` — the seam this function extends, not replaces), and
 * project reviews. Diagnostics are produced by the same task loop that builds the requests, so
 * they cannot silently drift from what actually gets scheduled.
 *
 * Pure: no `Date.now()`, no store access, no i18n lookup beyond `translations`.
 */
export function buildReminderSchedule(input: ReminderScheduleInput): ReminderSchedule {
    const { settings, tasks, projects, translations } = input;
    const now = input.now ?? new Date();
    const nowMs = now.getTime();

    const taskRemindersEnabled = areTaskRemindersEnabled(settings);
    const includeStartTime = areStartDateRemindersEnabled(settings);
    const includeDueDate = areDueDateRemindersEnabled(settings);
    const includeReviewAt = taskRemindersEnabled && settings.reviewAtNotificationsEnabled !== false;
    const digest = getDigestSchedule(settings);

    const requests: ReminderScheduleRequest[] = [];

    if (taskRemindersEnabled && digest.morning.enabled) {
        requests.push({
            key: 'digest:morning',
            title: translations['digest.morningTitle'],
            message: translations['digest.morningBody'],
            fireAt: nextDailyTime(digest.morning.hour, digest.morning.minute, now),
            repeatInterval: 'daily',
            data: { kind: 'daily-digest' },
        });
    }

    if (taskRemindersEnabled && digest.evening.enabled) {
        requests.push({
            key: 'digest:evening',
            title: translations['digest.eveningTitle'],
            message: translations['digest.eveningBody'],
            fireAt: nextDailyTime(digest.evening.hour, digest.evening.minute, now),
            repeatInterval: 'daily',
            data: { kind: 'daily-digest' },
        });
    }

    if (digest.weekly.enabled) {
        requests.push({
            key: 'digest:weekly-review',
            title: translations['digest.weeklyReviewTitle'],
            message: translations['digest.weeklyReviewBody'],
            fireAt: nextWeeklyTime(digest.weekly.day, digest.weekly.hour, digest.weekly.minute, now),
            repeatInterval: 'weekly',
            data: { kind: 'weekly-review' },
        });
    }

    const oneShot: ReminderScheduleRequest[] = [];
    let dateOnlyDueDateCount = 0;
    let futureDueDateReminderCount = 0;
    let pastDueDateReminderCount = 0;
    let dateOnlyStartTimeCount = 0;
    let futureStartTimeReminderCount = 0;
    let pastStartTimeReminderCount = 0;
    let futureTaskReviewReminderCount = 0;
    let pastTaskReviewReminderCount = 0;
    let suppressedTaskReminderCount = 0;
    let taskReminderCount = 0;
    let taskReviewReminderCount = 0;
    let projectReviewReminderCount = 0;

    if (taskRemindersEnabled) {
        for (const task of tasks) {
            // Single pass: the diagnostic classification below and the plan that produces the
            // actual request both read this same task/now/options, in the same iteration, so
            // they cannot disagree with each other the way two separate traversals could.
            const suppressTaskReminders = task.suppressMindwtrReminders === true;
            const scheduledStart = getTaskScheduledAt(task);
            const hasSuppressibleReminder = (includeDueDate && hasTimeComponent(task.dueDate))
                || (includeStartTime && hasTimeComponent(scheduledStart));
            if (suppressTaskReminders && hasSuppressibleReminder) {
                suppressedTaskReminderCount += 1;
            }
            if (!suppressTaskReminders && includeDueDate && task.dueDate) {
                if (hasTimeComponent(task.dueDate)) {
                    const dueAtMs = safeParseDate(task.dueDate)?.getTime() ?? NaN;
                    if (Number.isFinite(dueAtMs) && dueAtMs > nowMs) futureDueDateReminderCount += 1;
                    else if (Number.isFinite(dueAtMs)) pastDueDateReminderCount += 1;
                } else {
                    dateOnlyDueDateCount += 1;
                }
            }
            if (!suppressTaskReminders && includeStartTime && (scheduledStart || task.startTime)) {
                if (hasTimeComponent(scheduledStart)) {
                    const startAtMs = safeParseDate(scheduledStart)?.getTime() ?? NaN;
                    if (Number.isFinite(startAtMs) && startAtMs > nowMs) futureStartTimeReminderCount += 1;
                    else if (Number.isFinite(startAtMs)) pastStartTimeReminderCount += 1;
                } else {
                    dateOnlyStartTimeCount += 1;
                }
            }
            if (includeReviewAt && task.reviewAt && hasTimeComponent(task.reviewAt)) {
                const reviewAtMs = safeParseDate(task.reviewAt)?.getTime() ?? NaN;
                if (Number.isFinite(reviewAtMs) && reviewAtMs > nowMs) futureTaskReviewReminderCount += 1;
                else if (Number.isFinite(reviewAtMs)) pastTaskReviewReminderCount += 1;
            }

            const plan = getTaskReminderPlan(task, now, { includeStartTime, includeDueDate, includeReviewAt });

            // Bounded due-time repeat occurrences (after the due moment). Scheduled independently
            // of the base reminder below: a task whose due time already passed has no future
            // `next`, but its remaining repeat occurrences must still fire.
            for (const repeat of plan.repeats) {
                const repeatFireAtMs = repeat.scheduledAt.getTime();
                if (repeatFireAtMs <= nowMs) continue;
                oneShot.push({
                    key: repeat.key,
                    title: task.title,
                    message: buildReminderNotificationBody(task, 'due-repeat', translations),
                    fireAt: repeat.scheduledAt,
                    hasSnoozeAction: true,
                    hasCompleteAction: true,
                    data: { kind: 'task-reminder', taskId: task.id },
                });
            }

            const next = plan.next;
            const fireAtMs = next?.scheduledAt.getTime() ?? NaN;
            if (!next || fireAtMs <= nowMs) continue;
            const isReview = next.kind === 'review';
            if (isReview) taskReviewReminderCount += 1;
            else taskReminderCount += 1;
            oneShot.push({
                key: next.key,
                title: task.title,
                message: buildReminderNotificationBody(task, next.kind, translations),
                fireAt: next.scheduledAt,
                hasSnoozeAction: true,
                hasCompleteAction: !isReview,
                data: { kind: isReview ? 'task-review' : 'task-reminder', taskId: task.id },
            });
        }
    }

    if (includeReviewAt) {
        const reviewLabel = translations['review.projectsStep'] ?? 'Review project';
        for (const project of projects) {
            const reminder = getProjectReviewReminderIntent(project, now);
            if (!reminder) continue;
            projectReviewReminderCount += 1;
            oneShot.push({
                key: reminder.key,
                title: project.title,
                message: reviewLabel,
                fireAt: reminder.scheduledAt,
                data: { kind: 'project-review', projectId: project.id },
            });
        }
    }

    oneShot.sort((left, right) => left.fireAt.getTime() - right.fireAt.getTime());
    const cap = input.maxOneShotReminders ?? Infinity;
    requests.push(...oneShot.slice(0, cap));

    return {
        requests,
        diagnostics: {
            taskRemindersEnabled,
            includeStartTime,
            includeDueDate,
            includeReviewAt,
            weeklyReviewEnabled: digest.weekly.enabled,
            dateOnlyDueDateCount,
            futureDueDateReminderCount,
            pastDueDateReminderCount,
            dateOnlyStartTimeCount,
            futureStartTimeReminderCount,
            pastStartTimeReminderCount,
            futureTaskReviewReminderCount,
            pastTaskReviewReminderCount,
            suppressedTaskReminderCount,
            taskReminderCount,
            taskReviewReminderCount,
            projectReviewReminderCount,
            oneShotReminderCount: oneShot.length,
        },
    };
}
