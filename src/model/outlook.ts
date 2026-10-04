import { addDays, dayOf, nowMinutes, timeOf } from './dates';
import type { CalendarEvent, Day } from './types';

/**
 * Events from the Outlook export that Power Automate writes to Google Drive (`outlook-calendar.json`).
 * Accepts the shapes the flow produces: an array, `{ events: [...] }` or Graph's `{ value: [...] }`; each event may use
 * `start`/`startWithTimeZone`/`Start` (a string or Graph's `{ dateTime }`) and `title`/`subject`.
 * All-day events go to the all-day strip; an event that crosses midnight is split into one piece per day.
 */
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const first = (r: Rec, keys: string[]) => keys.map((k) => r[k]).find((v) => v !== undefined && v !== null && v !== '');

function when(v: unknown): Date | null {
  const raw = typeof v === 'string' ? v : typeof rec(v)?.dateTime === 'string' ? (rec(v)!.dateTime as string) : '';
  if (!raw.trim()) return null;
  const t = Date.parse(raw.trim());
  return Number.isFinite(t) ? new Date(t) : null;
}

export function outlookEvents(payload: unknown, from: Day, to: Day): CalendarEvent[] {
  const list = Array.isArray(payload)
    ? payload
    : ((rec(payload)?.events ?? rec(payload)?.value) as unknown[] | undefined);
  if (!Array.isArray(list)) return [];
  const out: CalendarEvent[] = [];
  list.forEach((raw, i) => {
    const e = rec(raw);
    if (!e) return;
    const start = when(first(e, ['startWithTimeZone', 'start', 'Start']));
    const end = when(first(e, ['endWithTimeZone', 'end', 'End']));
    if (!start || !end || end <= start) return;
    const title = String(first(e, ['title', 'subject', 'Subject']) ?? '').trim() || '(无标题)';
    const id = String(first(e, ['id', 'Id', 'eventId']) ?? `${i}:${start.toISOString()}`);
    const loc = first(e, ['location', 'Location']);
    const location =
      (typeof loc === 'string'
        ? loc
        : typeof rec(loc)?.displayName === 'string'
          ? String(rec(loc)!.displayName)
          : ''
      ).trim() || undefined;
    const allDay = first(e, ['allDay', 'isAllDay', 'IsAllDay']);
    if (allDay === true || allDay === 'true') {
      // All-day events end at midnight of the following day.
      const last = dayOf(new Date(end.getTime() - 1));
      for (let day = dayOf(start), n = 0; n < 31 && day <= last; n++, day = addDays(day, 1))
        if (day >= from && day <= to)
          out.push({
            id: `${id}@${day}`,
            title,
            day,
            start: '00:00',
            end: '23:59',
            allDay: true,
            ...(location ? { location } : {}),
          });
      return;
    }
    let day = dayOf(start);
    for (let n = 0; n < 14 && day <= dayOf(end); n++, day = addDays(day, 1)) {
      const s = day === dayOf(start) ? nowMinutes(start) : 0;
      const f = day === dayOf(end) ? nowMinutes(end) : 24 * 60 - 1;
      if (f <= s || day < from || day > to) continue;
      out.push({ id: `${id}@${day}`, title, day, start: timeOf(s), end: timeOf(f), ...(location ? { location } : {}) });
    }
  });
  return out.sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
}
