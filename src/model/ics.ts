import { addDays, dayOf, nowMinutes, timeOf } from './dates';
import type { CalendarEvent, Day } from './types';

/**
 * Read timed events from an iCalendar (.ics) file and expand simple repeats (DAILY/WEEKLY with
 * INTERVAL, BYDAY, UNTIL, COUNT) into a window of days. All-day events go to the all-day strip and
 * never count as busy time. Times are converted to this device's time zone.
 */
export function parseIcs(text: string, from: Day, to: Day): CalendarEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out: CalendarEvent[] = [];
  let ev: Record<string, { value: string; params: Record<string, string> }> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT' && ev) {
      out.push(...expand(ev, from, to));
      ev = null;
    } else if (ev) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      ev[name.toUpperCase()] = {
        value: line.slice(i + 1),
        params: Object.fromEntries(params.map((p) => p.split('=') as [string, string])),
      };
    }
  }
  return out.sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
}

function zoneOffsetMinutes(date: Date, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - date.getTime()) / 60000;
}

/** An ICS date-time to an absolute Date; `null` for all-day values. */
export function icsDate(value: string, tzid?: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m || m[4] === undefined) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  if (m[7]) return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (tzid) {
    try {
      const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
      const off = zoneOffsetMinutes(guess, tzid);
      const first = new Date(guess.getTime() - off * 60000);
      return new Date(guess.getTime() - zoneOffsetMinutes(first, tzid) * 60000);
    } catch {
      /* unknown zone: fall back to local time */
    }
  }
  return new Date(y, mo - 1, d, h, mi, s);
}

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function expand(
  ev: Record<string, { value: string; params: Record<string, string> }>,
  from: Day,
  to: Day,
): CalendarEvent[] {
  if (!ev.DTSTART || ev.STATUS?.value === 'CANCELLED') return [];
  const unescape = (s: string) => s.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ');
  const title = unescape(ev.SUMMARY?.value ?? '') || '(无标题)';
  const location = unescape(ev.LOCATION?.value ?? '').trim() || undefined;
  const start = icsDate(ev.DTSTART.value, ev.DTSTART.params.TZID);
  if (!start) {
    // A date-only value: an all-day event; its end date is exclusive.
    const d = /^(\d{4})(\d{2})(\d{2})$/.exec(ev.DTSTART.value.trim());
    if (!d) return [];
    const first = `${d[1]}-${d[2]}-${d[3]}`;
    const e = ev.DTEND && /^(\d{4})(\d{2})(\d{2})$/.exec(ev.DTEND.value.trim());
    const last = e ? addDays(`${e[1]}-${e[2]}-${e[3]}`, -1) : first;
    const days: CalendarEvent[] = [];
    for (let day = first, n = 0; n < 31 && day <= last; n++, day = addDays(day, 1))
      if (day >= from && day <= to)
        days.push({
          id: `${ev.UID?.value ?? title}@${day}`,
          title,
          day,
          start: '00:00',
          end: '23:59',
          allDay: true,
          ...(location ? { location } : {}),
        });
    return days;
  }
  const end = ev.DTEND ? icsDate(ev.DTEND.value, ev.DTEND.params.TZID) : new Date(start.getTime() + 3600e3);
  const length = Math.max(15, Math.round(((end ?? start).getTime() - start.getTime()) / 60000));
  const uid = ev.UID?.value ?? `${title}-${start.toISOString()}`;
  const make = (at: Date): CalendarEvent => {
    const m = nowMinutes(at);
    return {
      id: `${uid}@${at.toISOString()}`,
      title,
      day: dayOf(at),
      start: timeOf(m),
      end: timeOf(Math.min(m + length, 24 * 60 - 1)),
      ...(location ? { location } : {}),
    };
  };
  const exdates = new Set(
    (ev.EXDATE?.value ?? '')
      .split(',')
      .filter(Boolean)
      .map((v) => icsDate(v, ev.EXDATE?.params.TZID)?.getTime()),
  );
  const rule = ev.RRULE
    ? Object.fromEntries(ev.RRULE.value.split(';').map((kv) => kv.split('=') as [string, string]))
    : null;
  const inWindow = (at: Date) => dayOf(at) >= from && dayOf(at) <= to && !exdates.has(at.getTime());
  if (!rule) return inWindow(start) ? [make(start)] : [];
  if (rule.FREQ !== 'DAILY' && rule.FREQ !== 'WEEKLY') return inWindow(start) ? [make(start)] : [];
  const every = Math.max(1, Number(rule.INTERVAL) || 1);
  const until = rule.UNTIL ? icsDate(rule.UNTIL.length === 8 ? `${rule.UNTIL}T235959` : rule.UNTIL) : null;
  const count = Number(rule.COUNT) || Infinity;
  const days = rule.BYDAY ? rule.BYDAY.split(',').map((d) => BYDAY.indexOf(d.slice(-2)) + 1) : [start.getDay() || 7];
  const out: CalendarEvent[] = [];
  let n = 0;
  const startDay = dayOf(start);
  for (let day = startDay, i = 0; i < 3700 && day <= to; day = addDays(day, 1), i++) {
    const at = new Date(`${day}T${timeOf(nowMinutes(start))}:00`);
    if (until && at > until) break;
    const diff = Math.round(
      (new Date(`${day}T00:00:00`).getTime() - new Date(`${startDay}T00:00:00`).getTime()) / 864e5,
    );
    const weekday = at.getDay() || 7;
    const hit =
      rule.FREQ === 'DAILY'
        ? diff % every === 0
        : Math.floor((diff + ((start.getDay() || 7) - 1)) / 7) % every === 0 && days.includes(weekday);
    if (!hit) continue;
    if (++n > count) break;
    if (inWindow(at)) out.push(make(at));
  }
  return out;
}
