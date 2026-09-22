import { activeWorkBlocks, blockEnd, buildTimedCalendarLayouts, type ExternalCalendarEvent, type Task, type WorkBlock } from '@mindwtr/core';

export const PLANNER_HOUR_HEIGHT = 80;
export const PLANNER_DAY_HEIGHT = 24 * PLANNER_HOUR_HEIGHT;
const MIN_ITEM_HEIGHT = 44;
type CalendarEntry = { id: string; title: string; start: string; end: string } & (
    { kind: 'event'; event: ExternalCalendarEvent } | { kind: 'task'; task: Task; block: WorkBlock }
);

/** One layout pool for appointments AND reservations, using their rendered bounds.
 * Short items need touch targets too, so their visual (not only real) overlaps
 * participate in the existing shared column allocator. Never alter stored time.
 */
export function buildPlannerCalendarDay(date: string, tasks: readonly Task[], events: readonly ExternalCalendarEvent[]) {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const overlaps = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && b > a && a < end.getTime() && b > start.getTime();
    const dayEvents = events.filter(e => overlaps(Date.parse(e.start), Date.parse(e.end)));
    const entries: CalendarEntry[] = [
        ...dayEvents.filter(e => !e.allDay).map(event => ({ id: `event:${event.id}`, kind: 'event' as const, title: event.title, start: event.start, end: event.end, event })),
        ...tasks.flatMap(task => activeWorkBlocks(task).filter(b => overlaps(Date.parse(b.startAt), blockEnd(b))).map(block => ({ id: `task:${task.id}:${block.id}`, kind: 'task' as const, title: task.title, start: block.startAt, end: new Date(blockEnd(block)).toISOString(), task, block }))),
    ];
    const minute = (value: number) => {
        const d = new Date(value);
        return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    };
    const positioned = entries.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id)).map(entry => {
        const a = Math.max(start.getTime(), Date.parse(entry.start));
        const b = Math.min(end.getTime(), Date.parse(entry.end));
        const from = a === start.getTime() ? 0 : minute(a);
        const to = b === end.getTime() ? 1440 : minute(b);
        const top = Math.min(from * PLANNER_HOUR_HEIGHT / 60, PLANNER_DAY_HEIGHT - MIN_ITEM_HEIGHT);
        const height = Math.min(PLANNER_DAY_HEIGHT - top, Math.max(MIN_ITEM_HEIGHT, ((to > from ? to - from : (b - a) / 60000) * PLANNER_HOUR_HEIGHT / 60)));
        return { ...entry, top, height };
    });
    const layouts = buildTimedCalendarLayouts(positioned.map(item => ({ id: item.id, startMinutes: item.top * 60 / PLANNER_HOUR_HEIGHT, endMinutes: (item.top + item.height) * 60 / PLANNER_HOUR_HEIGHT })));
    const timed = positioned.map(item => ({ ...item, ...layouts.get(item.id)! }));
    return { allDay: dayEvents.filter(e => e.allDay), timed, columns: Math.max(1, ...timed.map(item => item.columnCount)) };
}
