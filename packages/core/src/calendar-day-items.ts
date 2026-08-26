/**
 * Day-cell content shared by the desktop and mobile calendars: the merged
 * scheduled/deadline/event list for a date, and the overlap layout for timed
 * blocks.
 */
import { safeParseDate, safeParseDueDate } from './date';
import type { ExternalCalendarEvent } from './ics';
import type { Task } from './types';
import { getTaskScheduledAt } from './task-time-semantics';

export type CalendarDayItem =
    | { id: string; kind: 'scheduled'; start: Date | null; task: Task; title: string }
    | { id: string; kind: 'deadline'; start: Date | null; task: Task; title: string }
    | { event: ExternalCalendarEvent; id: string; kind: 'event'; start: Date | null; title: string };

export type CalendarDayItemsInput = {
    deadlines: readonly Task[];
    events: readonly ExternalCalendarEvent[];
    scheduled: readonly Task[];
};

/**
 * Merges a day's scheduled tasks, deadline-only tasks and external events into
 * one time-ordered list. A task that is both scheduled and due that day appears
 * once, as its scheduled block. Undated items sort last, then by title.
 */
export function buildCalendarDayItems({ deadlines, events, scheduled }: CalendarDayItemsInput): CalendarDayItem[] {
    const scheduledIds = new Set(scheduled.map((task) => task.id));
    return [
        ...scheduled.map((task): CalendarDayItem => ({
            id: `scheduled-${task.id}`,
            kind: 'scheduled',
            start: safeParseDate(getTaskScheduledAt(task)),
            task,
            title: task.title,
        })),
        ...deadlines
            .filter((task) => !scheduledIds.has(task.id))
            .map((task): CalendarDayItem => ({
                id: `deadline-${task.id}`,
                kind: 'deadline',
                start: task.dueDate ? safeParseDueDate(task.dueDate) : null,
                task,
                title: task.title,
            })),
        ...events.map((event): CalendarDayItem => ({
            event,
            id: `event-${event.id}`,
            kind: 'event',
            start: safeParseDate(event.start),
            title: event.title,
        })),
    ].sort((a, b) => {
        const aTime = a.start?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bTime = b.start?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (aTime !== bTime) return aTime - bTime;
        return a.title.localeCompare(b.title);
    });
}

export type CalendarTimedLayoutInput = {
    id: string;
    startMinutes: number;
    endMinutes: number;
};

export type CalendarTimedLayout = {
    columnCount: number;
    columnIndex: number;
    leftPercent: number;
    widthPercent: number;
};

type TimedLayoutItem = CalendarTimedLayoutInput & {
    index: number;
};

type TimedLayoutWorkingItem = TimedLayoutItem & {
    columnIndex: number;
};

/**
 * Side-by-side layout for overlapping timed blocks.
 *
 * The column count is computed per overlap cluster, not per day: two meetings
 * hours apart are separate clusters and each stays full width, while a cluster
 * of three splits into thirds.
 */
export const buildTimedCalendarLayouts = (
    items: readonly CalendarTimedLayoutInput[]
): Map<string, CalendarTimedLayout> => {
    const layouts = new Map<string, CalendarTimedLayout>();
    const normalizedItems = items
        .map<TimedLayoutItem | null>((item, index) => {
            if (!Number.isFinite(item.startMinutes) || !Number.isFinite(item.endMinutes)) return null;
            const startMinutes = Math.min(item.startMinutes, item.endMinutes);
            const endMinutes = Math.max(item.startMinutes, item.endMinutes);
            if (endMinutes <= startMinutes) return null;
            return { ...item, startMinutes, endMinutes, index };
        })
        .filter((item): item is TimedLayoutItem => Boolean(item))
        .sort((a, b) =>
            a.startMinutes - b.startMinutes
            || a.endMinutes - b.endMinutes
            || a.index - b.index
        );

    let activeItems: TimedLayoutWorkingItem[] = [];
    let groupItems: TimedLayoutWorkingItem[] = [];

    const flushGroup = () => {
        if (groupItems.length === 0) return;
        const columnCount = Math.max(1, ...groupItems.map((item) => item.columnIndex + 1));
        const widthPercent = 100 / columnCount;
        for (const item of groupItems) {
            layouts.set(item.id, {
                columnCount,
                columnIndex: item.columnIndex,
                leftPercent: item.columnIndex * widthPercent,
                widthPercent,
            });
        }
        groupItems = [];
    };

    for (const item of normalizedItems) {
        activeItems = activeItems.filter((active) => active.endMinutes > item.startMinutes);
        if (activeItems.length === 0) {
            flushGroup();
        }

        const occupiedColumns = new Set(activeItems.map((active) => active.columnIndex));
        let columnIndex = 0;
        while (occupiedColumns.has(columnIndex)) columnIndex += 1;

        const workingItem = { ...item, columnIndex };
        activeItems.push(workingItem);
        groupItems.push(workingItem);
    }

    flushGroup();

    return layouts;
};
