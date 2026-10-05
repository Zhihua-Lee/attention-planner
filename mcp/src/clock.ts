import { dayOf, timeOf } from '../../src/model/dates';
import type { CalendarEvent, Doc } from '../../src/model/types';

/**
 * The model reads days and times from a Date's local fields, but a Worker runs in UTC. This returns a Date whose
 * local fields show the owner's wall-clock time in `timeZone`, so "today" and "now" mean what they mean on the phone.
 */
export function wallClock(timeZone: string, real: Date = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(real)
      .map((p) => [p.type, p.value]),
  );
  return new Date(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
    real.getMilliseconds(),
  );
}

/**
 * Every timestamp an edit writes (stamps, created, done) is `ctx.now.toISOString()`. Edits here run on the wall clock,
 * so swap that one string for the real instant before saving.
 */
export function realTimes(doc: Doc, wall: Date, real: Date): Doc {
  const from = wall.toISOString();
  const to = real.toISOString();
  return from === to ? doc : (JSON.parse(JSON.stringify(doc).split(from).join(to)) as Doc);
}

/**
 * Calendar parsers give times in the runtime's local zone; move a timed event into the owner's zone.
 * All-day events have no time to move.
 */
export function eventToZone(e: CalendarEvent, timeZone: string): CalendarEvent {
  if (e.allDay) return e;
  const start = new Date(`${e.day}T${e.start}:00`);
  let end = new Date(`${e.day}T${e.end}:00`);
  if (end <= start) end = new Date(end.getTime() + 864e5);
  const s = wallClock(timeZone, start);
  const f = wallClock(timeZone, end);
  const startMin = s.getHours() * 60 + s.getMinutes();
  const endMin = dayOf(f) === dayOf(s) ? f.getHours() * 60 + f.getMinutes() : 24 * 60 - 1;
  return { ...e, day: dayOf(s), start: timeOf(startMin), end: timeOf(Math.max(endMin, startMin)) };
}
