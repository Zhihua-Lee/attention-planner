import { addDays, dayOf, diffDays, isoWeekday, minutesOf, nowMinutes, PARTS, timeOf } from './dates';
import { isFinished, isSnoozed, liveTasks, planOf, remainingEffort, stepDone, stepsOf, effectiveDue } from './doc';
import type { CalendarEvent, Day, Doc, Part, Settings, Task } from './types';

export type Reason =
  | { kind: 'slot'; until: string }
  | { kind: 'part'; part: Part }
  | { kind: 'overdue'; days: number; step?: string }
  | { kind: 'dueToday'; step?: string }
  | { kind: 'today' }
  | { kind: 'star' }
  | { kind: 'oldest' };

export type Pick = { task: Task; reason: Reason };

/** Tasks still to do: not finished (for good or for this round). */
export const openTasks = (doc: Doc, now: Date) => liveTasks(doc).filter((t) => !isFinished(t, now));

/**
 * What to do now, best first. Only the present is computed: a reserved time happening now,
 * a part of today that has begun, overdue, due today, planned today, starred, then the oldest.
 */
export function nowCandidates(doc: Doc, now: Date): Pick[] {
  const today = dayOf(now);
  const m = nowMinutes(now);
  const ready = openTasks(doc, now).filter((t) => !isSnoozed(t, today));
  const out: Pick[] = [];
  const seen = new Set<string>();
  const push = (task: Task, reason: Reason) => {
    if (!seen.has(task.id)) (seen.add(task.id), out.push({ task, reason }));
  };
  for (const t of ready)
    for (const p of planOf(t))
      if (p.day === today && p.start) {
        const s = minutesOf(p.start);
        const e = s + (p.minutes ?? 60);
        if (s <= m && m < e) push(t, { kind: 'slot', until: timeOf(e) });
      }
  for (const t of ready)
    for (const p of planOf(t))
      if (p.day === today && p.part && PARTS[p.part].from <= m && m < PARTS[p.part].to)
        push(t, { kind: 'part', part: p.part });
  const byDue = ready
    .map((t) => ({ t, d: effectiveDue(t, now) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d!.day.localeCompare(b.d!.day));
  for (const { t, d } of byDue)
    if (d!.day < today) push(t, { kind: 'overdue', days: diffDays(today, d!.day), step: d!.step?.text });
  for (const { t, d } of byDue) if (d!.day === today) push(t, { kind: 'dueToday', step: d!.step?.text });
  for (const t of ready)
    if (planOf(t).some((p) => p.day === today && !p.start && !(p.part && PARTS[p.part].from > m)))
      push(t, { kind: 'today' });
  for (const t of ready) if (t.star) push(t, { kind: 'star' });
  for (const t of ready.slice().sort((a, b) => a.created.localeCompare(b.created))) push(t, { kind: 'oldest' });
  return out;
}

/** Timed events on a day (all-day ones are left out unless asked for: they are not busy time). */
export const eventsOn = (doc: Doc, day: Day, withAllDay = false): CalendarEvent[] =>
  (doc.events ?? [])
    .filter((e) => e.day === day && (withAllDay || !e.allDay))
    .sort((a, b) => a.start.localeCompare(b.start));

export function currentEvent(doc: Doc, now: Date): CalendarEvent | undefined {
  const m = nowMinutes(now);
  return eventsOn(doc, dayOf(now)).find((e) => minutesOf(e.start) <= m && m < minutesOf(e.end));
}

/** Minutes until the next calendar event today, or null when nothing else is scheduled. */
export function freeUntilNext(doc: Doc, now: Date): number | null {
  const m = nowMinutes(now);
  const next = eventsOn(doc, dayOf(now))
    .map((e) => minutesOf(e.start))
    .filter((s) => s > m)
    .sort((a, b) => a - b)[0];
  return next === undefined ? null : next - m;
}

/** Free minutes inside the working hours of `day`, after `fromMinute`, minus events and other reserved time. */
export function freeMinutes(doc: Doc, settings: Settings, day: Day, fromMinute = 0, excludeTask?: string): number {
  if (!settings.workDays.includes(isoWeekday(day))) return 0;
  const lo = Math.max(minutesOf(settings.workStart), fromMinute);
  const hi = minutesOf(settings.workEnd);
  if (hi <= lo) return 0;
  const busy: [number, number][] = eventsOn(doc, day).map((e) => [minutesOf(e.start), minutesOf(e.end)]);
  for (const t of liveTasks(doc))
    if (t.id !== excludeTask && !t.done)
      for (const p of planOf(t))
        if (p.day === day && p.start) busy.push([minutesOf(p.start), minutesOf(p.start) + (p.minutes ?? 60)]);
  busy.sort((a, b) => a[0] - b[0]);
  let free = 0;
  let cur = lo;
  for (const [s, e] of busy) {
    if (e <= cur) continue;
    if (s >= hi) break;
    if (s > cur) free += s - cur;
    cur = Math.max(cur, e);
  }
  if (cur < hi) free += hi - cur;
  return free;
}

export type Shortfall = { task: Task; missing: number };

/**
 * Is there enough free time before each deadline? Sums the remaining effort of everything due by a date
 * and compares it with free working time until then. Returns the first deadline that falls short.
 */
export function capacity(doc: Doc, now: Date): Shortfall | null {
  const today = dayOf(now);
  const dueOf = (t: Task) => t.due ?? effectiveDue(t, now)?.day;
  const due = openTasks(doc, now)
    .filter((t) => dueOf(t) && dueOf(t)! >= today && remainingEffort(t, now))
    .sort((a, b) => dueOf(a)!.localeCompare(dueOf(b)!));
  for (const t of due) {
    const need = due.filter((o) => dueOf(o)! <= dueOf(t)!).reduce((s, o) => s + remainingEffort(o, now)!, 0);
    let free = 0;
    for (let d = today; d <= dueOf(t)!; d = addDays(d, 1))
      free += freeMinutes(doc, doc.settings, d, d === today ? nowMinutes(now) : 0);
    if (need > free) return { task: t, missing: Math.ceil((need - free) / 30) * 30 };
  }
  return null;
}

export type Filter = 'all' | 'today' | 'new' | 'due' | 'snoozed';

/** Recently captured and not yet given a day or a deadline: the automatic "unsorted". */
export const isNew = (t: Task, now: Date) =>
  (now.getTime() - new Date(t.created).getTime()) / 864e5 <= 7 && !planOf(t).length && !effectiveDue(t, now);

export function matches(t: Task, f: Filter, now: Date): boolean {
  const today = dayOf(now);
  switch (f) {
    case 'all':
      return true;
    case 'today':
      return effectiveDue(t, now)?.day === today || planOf(t).some((p) => p.day === today);
    case 'new':
      return isNew(t, now);
    case 'due':
      return !!effectiveDue(t, now);
    case 'snoozed':
      return isSnoozed(t, today);
  }
}

/** The main list: snoozed last, then starred, then by deadline, then newest; linked tasks follow their target. */
export function listTasks(doc: Doc, now: Date, f: Filter, group?: { areaId?: string; projectId?: string }): Task[] {
  const today = dayOf(now);
  const rows = openTasks(doc, now).filter(
    (t) =>
      matches(t, f, now) &&
      (!group?.areaId ||
        t.areaId === group.areaId ||
        (t.projectId && doc.projects[t.projectId]?.areaId === group.areaId)) &&
      (!group?.projectId || t.projectId === group.projectId),
  );
  rows.sort(
    (a, b) =>
      Number(isSnoozed(a, today)) - Number(isSnoozed(b, today)) ||
      Number(!!b.star) - Number(!!a.star) ||
      (effectiveDue(a, now)?.day ?? '9').localeCompare(effectiveDue(b, now)?.day ?? '9') ||
      b.created.localeCompare(a.created),
  );
  // Group a task right after the task it links to, one level deep, when both are listed.
  const ids = new Set(rows.map((t) => t.id));
  const out: Task[] = [];
  const placed = new Set<string>();
  for (const t of rows) {
    if (placed.has(t.id) || (t.linkTo && ids.has(t.linkTo))) continue;
    out.push(t);
    placed.add(t.id);
    for (const c of rows) if (c.linkTo === t.id && !placed.has(c.id)) (out.push(c), placed.add(c.id));
  }
  for (const t of rows) if (!placed.has(t.id)) out.push(t);
  return out;
}

export const finishedTasks = (doc: Doc) =>
  liveTasks(doc)
    .filter((t) => t.done)
    .sort((a, b) => b.done!.localeCompare(a.done!));

/** Steps progress for display, e.g. 1/3. */
export function stepProgress(t: Task, now: Date) {
  const steps = stepsOf(t);
  return {
    done: steps.filter((s) => stepDone(t, s, now)).length,
    total: steps.length,
    next: steps.find((s) => !stepDone(t, s, now)),
  };
}

export type AgendaItem =
  | { kind: 'event'; event: CalendarEvent }
  | { kind: 'slot'; task: Task; start: number; end: number; entryId: string }
  | { kind: 'loose'; task: Task; part?: Part; entryId: string }
  | { kind: 'due'; task: Task; step?: string };

export function agenda(doc: Doc, day: Day, now: Date): AgendaItem[] {
  const items: AgendaItem[] = eventsOn(doc, day).map((event) => ({ kind: 'event', event }));
  const today = dayOf(now);
  for (const t of openTasks(doc, now)) {
    for (const p of planOf(t))
      if (p.day === day) {
        if (p.start)
          items.push({
            kind: 'slot',
            task: t,
            start: minutesOf(p.start),
            end: minutesOf(p.start) + (p.minutes ?? 60),
            entryId: p.id,
          });
        else if (!isSnoozed(t, today)) items.push({ kind: 'loose', task: t, part: p.part, entryId: p.id });
      }
    if (t.due === day) items.push({ kind: 'due', task: t });
    for (const s of stepsOf(t))
      if (s.due === day && !stepDone(t, s, now)) items.push({ kind: 'due', task: t, step: s.text });
  }
  return items;
}
