import type { Task } from '@mindwtr/core';

export type PlainCaptureDraft = {
    title: string;
    description: string;
    destination: 'inbox' | 'next';
    scheduledAt: string;
    dueDate: string;
    repeat: '' | 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval: number;
    afterCompletion: boolean;
    container: string;
    plannedDay?: string;
    durationMinutes?: number;
    availableAt?: string;
    checklist?: Task['checklist'];
    recurrence?: Task['recurrence'];
};

export type PlainCaptureError = 'title' | 'schedule' | 'due' | 'availability' | 'interval' | 'duration';
export type PlainCaptureResult =
    | { ok: true; title: string; props: Partial<Task> }
    | { ok: false; error: PlainCaptureError };

// Parse browser date inputs locally. In particular, an all-day deadline must not
// be converted to UTC midnight, and nonexistent dates/DST clock times must fail.
function parseInput(value: string, timed: boolean): Date | null {
    const pattern = timed
        ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
        : /^(\d{4})-(\d{2})-(\d{2})$/;
    const match = pattern.exec(value);
    if (!match) return null;
    const [, y, m, d, h = '0', minute = '0'] = match;
    const date = new Date(0);
    date.setFullYear(Number(y), Number(m) - 1, Number(d));
    date.setHours(Number(h), Number(minute), 0, 0);
    if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1
        || date.getDate() !== Number(d) || date.getHours() !== Number(h)
        || date.getMinutes() !== Number(minute)) return null;
    return date;
}

/** A plain capture never parses the title as commands or creates containers. */
export function preparePlainCapture(draft: PlainCaptureDraft): PlainCaptureResult {
    const title = draft.title.trim();
    if (!title) return { ok: false, error: 'title' };
    const schedule = draft.scheduledAt ? parseInput(draft.scheduledAt, true) : null;
    if (draft.scheduledAt && !schedule) return { ok: false, error: 'schedule' };
    if (draft.dueDate && !parseInput(draft.dueDate, false)) return { ok: false, error: 'due' };
    if (draft.repeat && (!Number.isInteger(draft.interval) || draft.interval < 1 || draft.interval > 999)) {
        return { ok: false, error: 'interval' };
    }
    if (draft.availableAt && !parseInput(draft.availableAt, false)) return { ok: false, error: 'availability' };
    if (schedule && draft.availableAt && schedule < parseInput(draft.availableAt, false)!) return { ok: false, error: 'availability' };
    if (draft.plannedDay && !parseInput(draft.plannedDay, false)) return { ok: false, error: 'schedule' };
    if (schedule && (!Number.isFinite(draft.durationMinutes ?? 30) || (draft.durationMinutes ?? 30) < 1 || (draft.durationMinutes ?? 30) > 1440)) return { ok: false, error: 'duration' };
    const projectId = draft.container.startsWith('project:') ? draft.container.slice(8) : undefined;
    const areaId = draft.container.startsWith('area:') ? draft.container.slice(5) : undefined;
    return {
        ok: true,
        title,
        props: {
            status: schedule || draft.plannedDay ? 'next' : draft.destination,
            ...(draft.availableAt ? { availableAt:draft.availableAt } : {}),
            ...(draft.checklist ? { checklist:draft.checklist.filter(s=>s.title.trim()) } : {}),
            // Whitespace can carry Markdown meaning; only discard an empty note.
            description: draft.description.trim() ? draft.description : undefined,
            ...(schedule ? { scheduledAt: schedule.toISOString() } : {}),
            ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
            ...(projectId ? { projectId } : areaId ? { areaId } : {}),
            ...(draft.repeat ? {
                recurrence: {
                    rule: draft.repeat,
                    strategy: draft.afterCompletion ? 'fluid' : 'strict',
                    rrule: `FREQ=${draft.repeat.toUpperCase()};INTERVAL=${draft.interval}`,
                },
            } : {}),
            ...(draft.recurrence ? { recurrence:draft.recurrence } : {}),
        },
    };
}

export function emptyPlainCapture(): PlainCaptureDraft {
    return { title: '', description: '', destination: 'inbox', scheduledAt: '', dueDate: '',
        repeat: '', interval: 1, afterCompletion: false, container: '' };
}
