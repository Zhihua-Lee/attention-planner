import { addDays, dayOf, diffDays, isoWeekday, minutesOf, nowMinutes, PARTS, timeOf } from './dates';
import {
  isFinished,
  isSnoozed,
  liveTasks,
  planOf,
  remainingEffort,
  stepDone,
  stepsOf,
  effectiveDue,
  taskEffort,
  taskRound,
} from './doc';
import type { CalendarEvent, Day, Doc, Part, Settings, Step, Task } from './types';

export type Reason =
  | { kind: 'slot'; until: string }
  | { kind: 'part'; part: Part }
  | { kind: 'overdue'; days: number; step?: string }
  | { kind: 'dueToday'; step?: string }
  | { kind: 'today' }
  | { kind: 'star' }
  | { kind: 'oldest' };

export type Pick = { task: Task; reason: Reason };

/**
 * In a project done one task after another, how many unfinished tasks come before this one (by when they were added).
 * 0 means it is the one to do now.
 */
export function queuePosition(doc: Doc, t: Task, now: Date): number {
  const p = t.projectId ? doc.projects[t.projectId] : undefined;
  // Repeating tasks come round on their own schedule: they neither wait in the queue nor hold it up.
  if (!p?.sequential || p.deleted || t.repeat || isFinished(t, now)) return 0;
  return liveTasks(doc).filter(
    (o) => o.projectId === t.projectId && o.id !== t.id && !o.repeat && !isFinished(o, now) && o.created < t.created,
  ).length;
}

/** Snoozed and not yet due: a deadline that arrives (today or earlier) brings a snoozed task back. */
export const isResting = (t: Task, now: Date) =>
  isSnoozed(t, dayOf(now)) && !((effectiveDue(t, now)?.day ?? '9') <= dayOf(now));

/** Tasks still to do: not finished (for good or for this round). */
export const openTasks = (doc: Doc, now: Date) => liveTasks(doc).filter((t) => !isFinished(t, now));

/**
 * What to do now, best first. Only the present is computed: a reserved time happening now,
 * a part of today that has begun, overdue, due today, planned today, starred, then the oldest.
 */
export function nowCandidates(doc: Doc, now: Date): Pick[] {
  const today = dayOf(now);
  const m = nowMinutes(now);
  const ready = openTasks(doc, now).filter((t) => !isResting(t, now) && queuePosition(doc, t, now) === 0);
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

/**
 * Replace the events from one source (Outlook, an imported file, a subscription); other sources stay.
 * Events saved before sources were recorded (0.1.6 and earlier) have none; they came from the Outlook export (or a
 * file), so either replaces them.
 */
export function replaceEvents(
  current: CalendarEvent[] | undefined,
  source: string,
  incoming: CalendarEvent[],
): CalendarEvent[] {
  const ours = (e: CalendarEvent) => e.source === source || (!e.source && (source === 'outlook' || source === 'file'));
  return [...(current ?? []).filter((e) => !ours(e)), ...incoming.map((e) => ({ ...e, source }))];
}

/**
 * Timed events on a day (all-day ones are left out unless asked for: they are not busy time). The same event from two
 * sources (say the Outlook export and a subscription to that calendar) is shown once.
 */
export const eventsOn = (doc: Doc, day: Day, withAllDay = false): CalendarEvent[] => {
  const seen = new Set<string>();
  return (doc.events ?? [])
    .filter((e) => e.day === day && (withAllDay || !e.allDay))
    .filter((e) => {
      const key = `${e.title.trim()}|${e.allDay ? 'all' : `${e.start}-${e.end}`}`;
      return !seen.has(key) && !!seen.add(key);
    })
    .sort((a, b) => a.start.localeCompare(b.start));
};

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
/**
 * The free stretches of working time on a day, as [start, end) minutes: working hours on working days, less timed
 * calendar events and every reserved time (except `excludeTask`'s), from `fromMinute` on.
 */
export function freeWindows(
  doc: Doc,
  settings: Settings,
  day: Day,
  fromMinute = 0,
  excludeTask?: string,
): [number, number][] {
  if (!settings.workDays.includes(isoWeekday(day))) return [];
  const lo = Math.max(minutesOf(settings.workStart), fromMinute);
  const hi = minutesOf(settings.workEnd);
  if (hi <= lo) return [];
  const busy: [number, number][] = eventsOn(doc, day).map((e) => [minutesOf(e.start), minutesOf(e.end)]);
  for (const t of liveTasks(doc))
    if (t.id !== excludeTask && !t.done)
      for (const p of planOf(t))
        if (p.day === day && p.start) busy.push([minutesOf(p.start), minutesOf(p.start) + (p.minutes ?? 60)]);
  busy.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = lo;
  for (const [s, e] of busy) {
    if (e <= cur) continue;
    if (s >= hi) break;
    if (s > cur) out.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (cur < hi) out.push([cur, hi]);
  return out;
}

export const freeMinutes = (doc: Doc, settings: Settings, day: Day, fromMinute = 0, excludeTask?: string): number =>
  freeWindows(doc, settings, day, fromMinute, excludeTask).reduce((sum, [s, e]) => sum + e - s, 0);

/** Minutes already reserved for a task (every reserved time, past ones too). */
export const reservedFor = (t: Task) => planOf(t).reduce((sum, p) => sum + (p.start ? (p.minutes ?? 60) : 0), 0);

/** One reserved time at most this long is suggested; a longer job is split into several. */
const LONGEST = 120;

/**
 * How much of a task still needs a time: its estimate (one hour when it has none) less what is reserved.
 * Planning follows the estimate; a reservation never changes it.
 */
export const stillToReserve = (t: Task) => Math.max(0, (taskEffort(t) ?? 60) - reservedFor(t));

/** For one step: its estimate (or an hour) less the time already reserved for it. */
export const stillToReserveStep = (t: Task, step: Step) =>
  Math.max(
    0,
    (step.effort ?? 60) -
      planOf(t).reduce((sum, p) => sum + (p.stepId === step.id && p.start ? (p.minutes ?? 60) : 0), 0),
  );

export type Slot = { day: Day; start: string; minutes: number };

/**
 * Free times for a task, earliest first: within working hours, around calendar events and other reserved times,
 * before its deadline (or in the next two weeks). Each is as long as what is still to reserve, up to two hours; a
 * shorter gap (at least half an hour) is offered too, so a long job can be done in pieces. At most two per day.
 */
export function findTimes(doc: Doc, t: Task, now: Date, limit = 3, step?: Step): Slot[] {
  const want = Math.min(LONGEST, (step ? stillToReserveStep(t, step) : stillToReserve(t)) || 60);
  const today = dayOf(now);
  const last = step?.due ?? effectiveDue(t, now)?.day ?? addDays(today, 13);
  const out: Slot[] = [];
  const from = Math.ceil((nowMinutes(now) + 5) / 30) * 30; // the next half hour, with a moment to get ready
  for (let day = today; day <= last && out.length < limit; day = addDays(day, 1)) {
    let perDay = 0;
    for (const [s, e] of freeWindows(doc, doc.settings, day, day === today ? from : 0)) {
      const minutes = Math.floor(Math.min(want, e - s) / 15) * 15;
      if (minutes < Math.min(30, want)) continue;
      out.push({ day, start: timeOf(s), minutes });
      if (++perDay === 2 || out.length === limit) break;
    }
  }
  return out;
}

/**
 * Tasks worth doing in a free time just tapped on the calendar, best first: the ones whose deadline comes soonest,
 * then those whose remaining time fits, then the important ones. Tasks that are done for now, resting or waiting in
 * a project's queue are left out, and so are tasks already fully reserved.
 */
export function tasksForSlot(doc: Doc, now: Date, day: Day, minutes: number, limit = 3): Task[] {
  const due = (t: Task) => effectiveDue(t, now)?.day ?? '9999';
  return (
    openTasks(doc, now)
      // Snoozed past that day (and not due by then) is left out; a snooze that ends before it is not.
      .filter((t) => !(isSnoozed(t, day) && !(due(t) <= day)))
      .filter((t) => queuePosition(doc, t, now) === 0 && stillToReserve(t) > 0)
      .sort(
        (a, b) =>
          due(a).localeCompare(due(b)) ||
          Number(stillToReserve(b) <= minutes) - Number(stillToReserve(a) <= minutes) ||
          Number(!!b.star) - Number(!!a.star) ||
          a.created.localeCompare(b.created),
      )
      .slice(0, limit)
  );
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

/** All, today, new, due within a week, any deadline, snoozed, or one area (`a:<id>`) or project (`p:<id>`). */
export type Filter =
  'all' | 'today' | 'new' | 'soon' | 'due' | 'star' | 'unplanned' | 'snoozed' | `a:${string}` | `p:${string}`;

/** Not given any day: no deadline (a step's included), no arrangement, no repeat, not snoozed. */
export const isUnplanned = (t: Task, now: Date) =>
  !effectiveDue(t, now) && !planOf(t).length && !t.repeat && !isSnoozed(t, dayOf(now));

/** Recently captured and not yet given a day, deadline, repeat or place: the automatic "unsorted". */
export const isNew = (t: Task, now: Date) =>
  (now.getTime() - new Date(t.created).getTime()) / 864e5 <= 7 &&
  !planOf(t).length &&
  !effectiveDue(t, now) &&
  !t.repeat &&
  !t.areaId &&
  !t.projectId;

/**
 * Belongs to today: due today or overdue (a step's deadline counts), planned today, a round of a repeating task
 * that is open, or a step on its own rule whose round is open. Snoozed tasks wait.
 */
export function isToday(t: Task, now: Date): boolean {
  const today = dayOf(now);
  if (isResting(t, now)) return false;
  const due = effectiveDue(t, now);
  if (due && due.day <= today) return true;
  if (planOf(t).some((p) => p.day === today)) return true;
  const round = taskRound(t, now);
  if (round && !round.done) return true;
  return stepsOf(t).some((s) => typeof s.repeat === 'object' && !stepDone(t, s, now) && today >= s.repeat.start);
}

export function matches(doc: Doc, t: Task, f: Filter, now: Date): boolean {
  const today = dayOf(now);
  if (f.startsWith('a:')) {
    const id = f.slice(2);
    return t.areaId === id || (!!t.projectId && doc.projects[t.projectId]?.areaId === id);
  }
  if (f.startsWith('p:')) return t.projectId === f.slice(2);
  switch (f) {
    case 'today':
      return isToday(t, now);
    case 'new':
      return isNew(t, now);
    case 'soon': {
      const due = effectiveDue(t, now);
      return !!due && due.day <= addDays(today, 7);
    }
    case 'due':
      return !!effectiveDue(t, now);
    case 'star':
      return !!t.star;
    case 'unplanned':
      return isUnplanned(t, now);
    case 'snoozed':
      return isSnoozed(t, today);
    default:
      return true;
  }
}

/**
 * The main list. Sorted automatically (snoozed last, then starred, then by deadline, then newest) or by hand
 * (new tasks on top); either way a linked task follows the task it points to.
 */
export function listTasks(doc: Doc, now: Date, f: Filter): Task[] {
  const today = dayOf(now);
  const rows = openTasks(doc, now).filter((t) => matches(doc, t, f, now));
  if (doc.settings.listSort === 'manual')
    rows.sort((a, b) => (a.rank ?? -Infinity) - (b.rank ?? -Infinity) || b.created.localeCompare(a.created));
  else
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
/** Steps done and in all; the next step is one arranged for today, if any, else the first open one. */
export function stepProgress(t: Task, now: Date) {
  const steps = stepsOf(t);
  const today = dayOf(now);
  const forToday = new Set(planOf(t).flatMap((p) => (p.day === today && p.stepId ? [p.stepId] : [])));
  const open = steps.filter((s) => !stepDone(t, s, now));
  return {
    done: steps.length - open.length,
    total: steps.length,
    next: open.find((s) => forToday.has(s.id)) ?? open[0],
  };
}

/** The words of the step an arrangement is for, when it is for one that is still there. */
const stepOf = (t: Task, stepId?: string) => (stepId ? stepsOf(t).find((s) => s.id === stepId)?.text : undefined);

export type AgendaItem =
  | { kind: 'event'; event: CalendarEvent }
  | { kind: 'slot'; task: Task; start: number; end: number; entryId: string; step?: string }
  | { kind: 'loose'; task: Task; part?: Part; entryId: string; step?: string }
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
            step: stepOf(t, p.stepId),
          });
        else if (!isSnoozed(t, today))
          items.push({ kind: 'loose', task: t, part: p.part, entryId: p.id, step: stepOf(t, p.stepId) });
      }
    if (t.due === day) items.push({ kind: 'due', task: t });
    for (const s of stepsOf(t))
      if (s.due === day && !stepDone(t, s, now)) items.push({ kind: 'due', task: t, step: s.text });
  }
  return items;
}
