import { dayOf } from './dates';
import { inRound, live, newId, planOf, stepDone, stepsOf, taskRound, type Ctx } from './doc';
import type { Day, Doc, Part, PlanEntry, Task, Time } from './types';

export type LogKind =
  'done' | 'reopen' | 'check' | 'uncheck' | 'due' | 'plan' | 'move' | 'unplan' | 'worked' | 'snooze' | 'unsnooze';

/**
 * One thing done to a task, when and from where. Entries are never edited, only added (and voided by undo), so two
 * devices' histories merge as their union.
 */
export type LogEntry = {
  id: string;
  at: string;
  /** The device that did it. */
  by: string;
  kind: LogKind;
  /** The step checked or unchecked (its text as it was then). */
  step?: { id: string; text: string };
  /** due: the new deadline (none when cleared); plan / move / unplan / worked: the arrangement. */
  day?: Day;
  time?: Time;
  part?: Part;
  start?: Time;
  minutes?: number;
  /** move: the day it was on before. */
  from?: Day;
  /** snooze */
  until?: Day;
  reason?: string;
  /** done / check: what was arranged for that day (a part, a start time, or just the day), and the deadline then. */
  planned?: Part | Time | 'day';
  dueThen?: Day;
  /** Applied from a proposal by this AI. */
  ai?: string;
  /** Taken back with undo; kept so the other devices learn it too. */
  voided?: boolean;
};

/** Entries kept per task, newest last. */
export const LOG_LIMIT = 200;

const order = (a: LogEntry, b: LogEntry) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id);

/** Both histories: every entry from either side, voided if either side voided it, the newest `LOG_LIMIT` kept. */
export function mergeLog(a: LogEntry[] | undefined, b: LogEntry[] | undefined): LogEntry[] | undefined {
  if (!a?.length && !b?.length) return a ?? b;
  const map = new Map<string, LogEntry>();
  for (const x of [...(a ?? []), ...(b ?? [])]) {
    const y = map.get(x.id);
    map.set(x.id, y && !x.voided ? y : x);
  }
  return [...map.values()].sort(order).slice(-LOG_LIMIT);
}

const finished = (t: Task, now: Date) => !!t.done || !!taskRound(t, now)?.done;

/** What was arranged for today, for the task or (if it has its own) the step. */
function plannedToday(t: Task, today: Day, stepId?: string): LogEntry['planned'] {
  const plans = planOf(t).filter((p) => p.day === today);
  const p = plans.find((x) => stepId && x.stepId === stepId) ?? plans.find((x) => !x.stepId) ?? plans[0];
  return p ? (p.start ?? p.part ?? 'day') : undefined;
}

const where = (p: PlanEntry) => ({ day: p.day, part: p.part, start: p.start, minutes: p.minutes });

/** The entries for one task's change, from the task before and after it (both as the current round sees them). */
function diffTask(b: Task, a: Task, now: Date): Omit<LogEntry, 'id' | 'at' | 'by'>[] {
  const out: Omit<LogEntry, 'id' | 'at' | 'by'>[] = [];
  const today = dayOf(now);
  const before = new Map(b.steps.map((s) => [s.id, s]));
  const context = (stepId?: string) => ({
    planned: plannedToday(b, today, stepId),
    dueThen: (stepId ? before.get(stepId)?.due : undefined) ?? b.due,
  });

  const wasDone = finished(b, now);
  const isDone = finished(a, now);
  const flips = [];
  for (const s of stepsOf(a)) {
    const old = before.get(s.id);
    if (!old || old.deleted) continue;
    const was = stepDone(b, old, now);
    const is = stepDone(a, s, now);
    if (was !== is) flips.push({ kind: is ? ('check' as const) : ('uncheck' as const), step: s });
  }
  // Finishing a round checks every step at once: that is one thing done, not many.
  const bulk = wasDone !== isDone && flips.length > 1;
  if (!bulk)
    for (const f of flips)
      out.push({
        kind: f.kind,
        step: { id: f.step.id, text: f.step.text },
        ...(f.kind === 'check' ? context(f.step.id) : {}),
      });
  if (wasDone !== isDone) out.push(isDone ? { kind: 'done', ...context() } : { kind: 'reopen' });

  if (b.due !== a.due || (a.due && b.dueTime !== a.dueTime)) out.push({ kind: 'due', day: a.due, time: a.dueTime });

  const plansBefore = new Map(live(b.plan).map((p) => [p.id, p]));
  for (const p of live(a.plan)) {
    const old = plansBefore.get(p.id);
    plansBefore.delete(p.id);
    if (!old) out.push({ kind: 'plan', ...where(p) });
    else {
      if (old.day !== p.day || old.part !== p.part || old.start !== p.start || old.minutes !== p.minutes)
        out.push({ kind: 'move', ...where(p), ...(old.day !== p.day ? { from: old.day } : {}) });
      const worked = (p.doneMin ?? 0) - (old.doneMin ?? 0);
      if (worked) out.push({ kind: 'worked', day: p.day, start: p.start, minutes: worked });
    }
  }
  for (const p of plansBefore.values()) out.push({ kind: 'unplan', ...where(p) });

  if (JSON.stringify(b.snooze) !== JSON.stringify(a.snooze))
    out.push(a.snooze ? { kind: 'snooze', until: a.snooze.until, reason: a.snooze.reason } : { kind: 'unsnooze' });
  return out;
}

const clean = <T extends object>(x: T): T =>
  Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as T;

/**
 * Record in each task's history what a change did to it. Tasks the change created or deleted are left out (a task
 * keeps when it was created). `ai` names the AI whose proposal was applied.
 */
export function logChanges(before: Doc, after: Doc, ctx: Ctx, ai?: string): Doc {
  let tasks: Doc['tasks'] | undefined;
  const at = ctx.now.toISOString();
  for (const [id, a] of Object.entries(after.tasks)) {
    const b = before.tasks[id];
    if (!b || a === b || b.deleted || a.deleted) continue;
    const entries = diffTask(inRound(b, ctx.now), inRound(a, ctx.now), ctx.now);
    if (!entries.length) continue;
    const added = entries.map((e) => clean({ id: newId(), at, by: ctx.device, ...e, ...(ai ? { ai } : {}) }));
    (tasks ??= { ...after.tasks })[id] = { ...a, log: [...(a.log ?? []), ...added].slice(-LOG_LIMIT) };
  }
  return tasks ? { ...after, tasks } : after;
}

/** After undo: void the entries this device added since the snapshot it went back to. */
export function voidSince(doc: Doc, snapshot: Doc, device: string): Doc {
  let tasks: Doc['tasks'] | undefined;
  for (const [id, t] of Object.entries(doc.tasks)) {
    if (!t.log?.length) continue;
    const known = new Set((snapshot.tasks[id]?.log ?? []).map((x) => x.id));
    if (!t.log.some((x) => !known.has(x.id) && x.by === device && !x.voided)) continue;
    const log = t.log.map((x) => (!known.has(x.id) && x.by === device && !x.voided ? { ...x, voided: true } : x));
    (tasks ??= { ...doc.tasks })[id] = { ...t, log };
  }
  return tasks ? { ...doc, tasks } : doc;
}

/**
 * A task's history, newest first, without voided entries. Rounds and a completion from before history was kept are
 * included as "done", so a task that has been around a while still shows them.
 */
export function historyOf(t: Task): LogEntry[] {
  const log = (t.log ?? []).filter((x) => !x.voided);
  const doneAt = new Set(log.filter((x) => x.kind === 'done').map((x) => x.at));
  const older: LogEntry[] = live(t.rounds)
    .filter((r) => !doneAt.has(r.doneAt))
    .map((r) => ({ id: `round:${r.key}`, at: r.doneAt, by: r.s.by, kind: 'done' }));
  if (t.done && !doneAt.has(t.done)) older.push({ id: 'done', at: t.done, by: t.fs.done?.by ?? '', kind: 'done' });
  return [...log, ...older].sort(order).reverse();
}
