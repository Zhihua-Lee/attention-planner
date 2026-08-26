import { timeEstimateToMinutes } from './calendar-scheduling';
import { safeParseDate, safeParseDueDate } from './date';
import type { ExternalCalendarEvent } from './ics';
import type { Task, TaskPriority } from './types';
import { getTaskScheduledAt, isTaskAttentionEligible, isTaskReadyForNow } from './task-time-semantics';

export type AttentionFrameDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface AttentionFrame {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    days: AttentionFrameDay[];
    matchTokens?: string[];
    color?: string;
    enabled?: boolean;
}

export type NowSelection =
    | { kind: 'event'; event: ExternalCalendarEvent; reason: 'calendar-event' }
    | { kind: 'task'; task: Task; frame?: AttentionFrame; reason: 'scheduled' | 'focused' | 'frame' | 'next-action' };

type SelectNowOptions = {
    events?: readonly ExternalCalendarEvent[];
    excludedTaskIds?: ReadonlySet<string>;
    frames?: readonly AttentionFrame[];
    now?: Date;
    tasks: readonly Task[];
    timeEstimatesEnabled?: boolean;
};

const VALID_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const VALID_COLOR = /^#[0-9a-f]{6}$/i;
const PRIORITY_RANK: Record<TaskPriority, number> = {
    low: 1,
    medium: 2,
    high: 3,
    urgent: 4,
};

const normalizeToken = (value: string): string => value.trim().toLocaleLowerCase();

const minuteOfDay = (value: string): number | null => {
    if (!VALID_TIME.test(value)) return null;
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
};

const normalizeDays = (value: unknown): AttentionFrameDay[] => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((day): day is AttentionFrameDay => (
        Number.isInteger(day) && day >= 0 && day <= 6
    )))).sort((a, b) => a - b);
};

export function normalizeAttentionFrames(value: unknown): AttentionFrame[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    const frames: AttentionFrame[] = [];
    for (const candidate of value) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const raw = candidate as Record<string, unknown>;
        const id = typeof raw.id === 'string' ? raw.id.trim() : '';
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        const startTime = typeof raw.startTime === 'string' ? raw.startTime.trim() : '';
        const endTime = typeof raw.endTime === 'string' ? raw.endTime.trim() : '';
        const days = normalizeDays(raw.days);
        if (!id || ids.has(id) || !name || !VALID_TIME.test(startTime) || !VALID_TIME.test(endTime) || days.length === 0) continue;
        ids.add(id);
        const matchTokens = Array.isArray(raw.matchTokens)
            ? Array.from(new Set(raw.matchTokens.filter((token): token is string => typeof token === 'string')
                .map(normalizeToken)
                .filter(Boolean)))
            : [];
        const color = typeof raw.color === 'string' && VALID_COLOR.test(raw.color.trim())
            ? raw.color.trim().toLowerCase()
            : undefined;
        frames.push({
            id,
            name,
            startTime,
            endTime,
            days,
            ...(matchTokens.length > 0 ? { matchTokens } : {}),
            ...(color ? { color } : {}),
            ...(raw.enabled === false ? { enabled: false } : {}),
        });
    }
    return frames;
}

export function resolveActiveAttentionFrame(
    frames: readonly AttentionFrame[] | undefined,
    now: Date = new Date(),
): AttentionFrame | null {
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    const currentDay = now.getDay() as AttentionFrameDay;
    const previousDay = ((currentDay + 6) % 7) as AttentionFrameDay;
    for (const frame of normalizeAttentionFrames(frames)) {
        if (frame.enabled === false) continue;
        const start = minuteOfDay(frame.startTime);
        const end = minuteOfDay(frame.endTime);
        if (start === null || end === null || start === end) continue;
        const active = start < end
            ? frame.days.includes(currentDay) && currentMinute >= start && currentMinute < end
            : (frame.days.includes(currentDay) && currentMinute >= start)
                || (frame.days.includes(previousDay) && currentMinute < end);
        if (active) return frame;
    }
    return null;
}

function taskTokenMatchesFrame(task: Task, frame: AttentionFrame): boolean {
    const required = frame.matchTokens ?? [];
    if (required.length === 0) return true;
    const taskTokens = new Set([...(task.contexts ?? []), ...(task.tags ?? [])].map(normalizeToken));
    return required.some((token) => taskTokens.has(normalizeToken(token)));
}

function taskSortKey(task: Task): [number, number, number, number, number, string] {
    const focusOrder = Number.isFinite(task.focusOrder) ? Number(task.focusOrder) : Number.MAX_SAFE_INTEGER;
    const priority = -(PRIORITY_RANK[task.priority ?? 'low'] ?? 0);
    const due = safeParseDueDate(task.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const created = safeParseDate(task.createdAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return [task.isFocusedToday ? 0 : 1, focusOrder, priority, due, created, task.id];
}

function compareTasks(left: Task, right: Task): number {
    const a = taskSortKey(left);
    const b = taskSortKey(right);
    for (let index = 0; index < a.length; index += 1) {
        if (a[index] === b[index]) continue;
        return a[index] < b[index] ? -1 : 1;
    }
    return 0;
}

function isCurrentScheduledTask(task: Task, now: Date, timeEstimatesEnabled: boolean): boolean {
    const start = safeParseDate(getTaskScheduledAt(task));
    if (!start || start.getTime() > now.getTime()) return false;
    const durationMs = timeEstimateToMinutes(task.timeEstimate, { enabled: timeEstimatesEnabled }) * 60_000;
    return now.getTime() < start.getTime() + durationMs;
}

function getFrameRemainingMinutes(frame: AttentionFrame, now: Date): number {
    const end = minuteOfDay(frame.endTime);
    if (end === null) return Number.MAX_SAFE_INTEGER;
    const current = now.getHours() * 60 + now.getMinutes();
    const remaining = end > current ? end - current : (24 * 60) - current + end;
    return Math.max(0, remaining);
}

export function selectNow(options: SelectNowOptions): NowSelection | null {
    const now = options.now ?? new Date();
    const nowMs = now.getTime();
    const currentEvent = (options.events ?? [])
        .filter((event) => {
            if (event.allDay) return false;
            const start = Date.parse(event.start);
            const end = Date.parse(event.end);
            return Number.isFinite(start) && Number.isFinite(end) && start <= nowMs && nowMs < end;
        })
        .sort((left, right) => Date.parse(left.start) - Date.parse(right.start))[0];
    if (currentEvent) return { kind: 'event', event: currentEvent, reason: 'calendar-event' };

    const excluded = options.excludedTaskIds ?? new Set<string>();
    const actionable = options.tasks.filter((task) => (
        !task.deletedAt
        && !excluded.has(task.id)
        && isTaskAttentionEligible(task, now)
    ));
    if (actionable.length === 0) return null;

    const timeEstimatesEnabled = options.timeEstimatesEnabled !== false;
    const scheduled = actionable
        .filter((task) => isTaskReadyForNow(task, now))
        .filter((task) => isCurrentScheduledTask(task, now, timeEstimatesEnabled))
        .sort((left, right) => {
            const startDiff = (safeParseDate(getTaskScheduledAt(left))?.getTime() ?? 0) - (safeParseDate(getTaskScheduledAt(right))?.getTime() ?? 0);
            return startDiff || compareTasks(left, right);
        })[0];
    if (scheduled) return { kind: 'task', task: scheduled, reason: 'scheduled' };

    const visible = actionable.filter((task) => isTaskReadyForNow(task, now));

    const frame = resolveActiveAttentionFrame(options.frames, now);
    if (frame) {
        const remainingMinutes = getFrameRemainingMinutes(frame, now);
        const frameTask = visible
            .filter((task) => taskTokenMatchesFrame(task, frame))
            .sort((left, right) => {
                const leftFits = timeEstimateToMinutes(left.timeEstimate, { enabled: timeEstimatesEnabled }) <= remainingMinutes;
                const rightFits = timeEstimateToMinutes(right.timeEstimate, { enabled: timeEstimatesEnabled }) <= remainingMinutes;
                if (leftFits !== rightFits) return leftFits ? -1 : 1;
                return compareTasks(left, right);
            })[0];
        if (frameTask) return { kind: 'task', task: frameTask, frame, reason: 'frame' };
    }

    const focused = visible.filter((task) => task.isFocusedToday).sort(compareTasks)[0];
    if (focused) return { kind: 'task', task: focused, reason: 'focused' };

    const next = visible.sort(compareTasks)[0];
    return next ? { kind: 'task', task: next, reason: 'next-action' } : null;
}
