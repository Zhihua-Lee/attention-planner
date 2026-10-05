import { addDays, dayOf, diffDays } from './dates';
import { nextCopyDay, roundOf, type RoundState } from './repeat';
import {
  TASK_FIELDS,
  type Area,
  type Day,
  type Doc,
  type PlanEntry,
  type Project,
  type RepeatRule,
  type Round,
  type Settings,
  type Stamp,
  type Step,
  type Task,
  type TaskField,
  type TextField,
} from './types';

/** Who is editing, and when. Every change is stamped from this. */
export type Ctx = { now: Date; device: string };

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Larger means newer. */
export function cmpStamp(a: Stamp | undefined, b: Stamp | undefined): number {
  if (!a || !b) return a ? 1 : b ? -1 : 0;
  return a.rev - b.rev || a.at.localeCompare(b.at) || a.by.localeCompare(b.by);
}

export const defaultSettings = (s: Stamp): Settings => ({
  workStart: '09:00',
  workEnd: '18:00',
  workDays: [1, 2, 3, 4, 5],
  chips: ['due', 'plan', 'effort', 'star'],
  theme: 'system',
  lang: 'zh',
  s,
});

export function emptyDoc(ctx: Ctx): Doc {
  const s = { rev: 0, at: ctx.now.toISOString(), by: ctx.device };
  return { v: 1, clock: 0, tasks: {}, areas: {}, projects: {}, settings: defaultSettings(s) };
}

/** A transaction: every record it touches shares one new stamp. */
export class Edit {
  readonly s: Stamp;
  readonly doc: Doc;
  constructor(
    doc: Doc,
    readonly ctx: Ctx,
  ) {
    const rev = doc.clock + 1;
    this.s = { rev, at: ctx.now.toISOString(), by: ctx.device };
    this.doc = { ...doc, clock: rev, tasks: { ...doc.tasks }, areas: { ...doc.areas }, projects: { ...doc.projects } };
  }
  task(id: string): Task {
    const t = this.doc.tasks[id];
    if (!t || t.deleted) throw new Error('This task no longer exists.');
    return t;
  }
  put(task: Task) {
    this.doc.tasks[task.id] = { ...task, s: this.s };
  }
  set<K extends TaskField>(id: string, field: K, value: Task[K]) {
    const t = this.task(id);
    if (JSON.stringify(t[field]) === JSON.stringify(value)) return;
    const next = { ...t, fs: { ...t.fs, [field]: this.s } } as Task;
    if ((field === 'title' || field === 'note') && t.fs[field]) next.fb = { ...t.fb, [field]: t.fs[field] };
    if (value === undefined) delete next[field];
    else next[field] = value;
    this.put(next);
  }
  child<K extends 'plan' | 'steps' | 'rounds'>(id: string, list: K, fn: (items: Task[K]) => Task[K]) {
    const t = this.task(id);
    this.put({ ...t, [list]: fn(t[list]) });
  }
}

export function edit(doc: Doc, ctx: Ctx, fn: (e: Edit) => void): Doc {
  const e = new Edit(doc, ctx);
  fn(e);
  return e.doc;
}

// ---------- reading ----------

export const live = <T extends { deleted?: boolean }>(items: T[]) => items.filter((i) => !i.deleted);
export const liveTasks = (doc: Doc) => Object.values(doc.tasks).filter((t) => !t.deleted);
export const stepsOf = (t: Task) => live(t.steps).sort((a, b) => a.order - b.order);
export const planOf = (t: Task) =>
  live(t.plan).sort((a, b) => (a.day + (a.start ?? partKey(a))).localeCompare(b.day + (b.start ?? partKey(b))));
const partKey = (p: PlanEntry) => (p.part === 'am' ? '08' : p.part === 'pm' ? '12' : p.part === 'eve' ? '18' : '00');
export const lastRound = (t: Task): Round | undefined =>
  live(t.rounds)
    .sort((a, b) => a.doneAt.localeCompare(b.doneAt))
    .at(-1);

/** The current round of a task that reopens in place, or null. */
export function taskRound(t: Task, now: Date): RoundState | null {
  if (t.repeat?.mode !== 'reopen') return null;
  return roundOf(t.repeat.rule, lastRound(t), now, t.repeat.paused);
}

function stepRound(step: Step, now: Date): RoundState | null {
  if (!step.repeat || step.repeat === 'none') return null;
  const last = step.doneIn && step.doneAt ? { key: step.doneIn, doneAt: step.doneAt } : undefined;
  return roundOf(step.repeat, last, now);
}

export function stepDone(t: Task, step: Step, now: Date): boolean {
  if (step.repeat === 'none') return !!step.done;
  if (step.repeat) return !!stepRound(step, now)?.done;
  const round = taskRound(t, now);
  return round ? step.doneIn === round.key : !!step.done;
}

/** Done for good, or (for a task that reopens) done for the current round. */
export function isFinished(t: Task, now: Date): boolean {
  if (t.done) return true;
  const round = taskRound(t, now);
  return !!round?.done;
}

export const isSnoozed = (t: Task, today: Day) => !!t.snooze && (!t.snooze.until || t.snooze.until > today);

/** The task's effort: its own estimate, or else the sum of its steps' estimates. */
export function taskEffort(t: Task): number | undefined {
  if (t.effort) return t.effort;
  const sum = stepsOf(t).reduce((s, x) => s + (x.effort ?? 0), 0);
  return sum || undefined;
}

/**
 * What is left to do. With step estimates and no task estimate, it is the estimate of the steps not yet done;
 * otherwise the task's estimate minus the minutes logged on reserved times.
 */
export function remainingEffort(t: Task, now = new Date()): number | undefined {
  if (!t.effort) {
    const steps = stepsOf(t).filter((s) => s.effort);
    if (!steps.length) return undefined;
    return steps.filter((s) => !stepDone(t, s, now)).reduce((sum, s) => sum + s.effort!, 0);
  }
  return Math.max(0, t.effort - live(t.plan).reduce((s, p) => s + (p.doneMin ?? 0), 0));
}

/** The earliest deadline that still matters: the task's, or an earlier one on a step not yet done. */
export function effectiveDue(t: Task, now = new Date()): { day: Day; step?: Step } | undefined {
  let best: { day: Day; step?: Step } | undefined = t.due ? { day: t.due } : undefined;
  for (const s of stepsOf(t))
    if (s.due && !stepDone(t, s, now) && (!best || s.due < best.day)) best = { day: s.due, step: s };
  return best;
}

// ---------- writing ----------

export type NewTask = Partial<Pick<Task, TaskField>> & {
  title: string;
  plan?: Omit<PlanEntry, 'id' | 's'>[];
  steps?: string[];
};

export function addTask(doc: Doc, ctx: Ctx, input: NewTask): [Doc, string] {
  const id = newId();
  const next = edit(doc, ctx, (e) => {
    const fs: Record<string, Stamp> = {};
    const t: Task = {
      id,
      title: input.title.trim(),
      created: ctx.now.toISOString(),
      plan: [],
      steps: [],
      rounds: [],
      fs,
      s: e.s,
    };
    for (const f of TASK_FIELDS) {
      const v = input[f];
      if (v !== undefined && v !== '' && f !== 'title') (t as Record<string, unknown>)[f] = v;
      if (v !== undefined) fs[f] = e.s;
    }
    fs.title = e.s;
    t.plan = (input.plan ?? []).map((p) => ({ ...p, id: newId(), s: e.s }));
    t.steps = (input.steps ?? []).filter((x) => x.trim()).map((text, i) => ({ id: newId(), text, order: i, s: e.s }));
    e.put(t);
  });
  return [next, id];
}

export const setField = <K extends TaskField>(doc: Doc, ctx: Ctx, id: string, field: K, value: Task[K]) =>
  edit(doc, ctx, (e) => e.set(id, field, value));

export const removeTask = (doc: Doc, ctx: Ctx, id: string) =>
  edit(doc, ctx, (e) => e.put({ ...e.task(id), deleted: true, fs: { ...e.task(id).fs, deleted: e.s } }));

export const addPlan = (doc: Doc, ctx: Ctx, id: string, entry: Omit<PlanEntry, 'id' | 's'>) =>
  edit(doc, ctx, (e) => e.child(id, 'plan', (plan) => [...plan, { ...entry, id: newId(), s: e.s }]));

export const updatePlan = (
  doc: Doc,
  ctx: Ctx,
  id: string,
  entryId: string,
  patch: Partial<Omit<PlanEntry, 'id' | 's'>>,
) =>
  edit(doc, ctx, (e) =>
    e.child(id, 'plan', (plan) =>
      plan.map((p) => {
        if (p.id !== entryId) return p;
        const next = { ...p, ...patch, s: e.s };
        for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (patch[k] === undefined) delete next[k];
        return next;
      }),
    ),
  );

export const removePlan = (doc: Doc, ctx: Ctx, id: string, entryId: string) =>
  edit(doc, ctx, (e) =>
    e.child(id, 'plan', (plan) => plan.map((p) => (p.id === entryId ? { ...p, deleted: true, s: e.s } : p))),
  );

export const addStep = (
  doc: Doc,
  ctx: Ctx,
  id: string,
  text: string,
  after?: string,
  extra: Partial<Pick<Step, 'due' | 'effort' | 'repeat'>> = {},
) =>
  edit(doc, ctx, (e) =>
    e.child(id, 'steps', (steps) => {
      const ordered = stepsOf({ steps } as Task);
      const i = after ? ordered.findIndex((s) => s.id === after) + 1 : ordered.length;
      const order =
        i <= 0
          ? (ordered[0]?.order ?? 1) - 1
          : i >= ordered.length
            ? (ordered.at(-1)?.order ?? -1) + 1
            : (ordered[i - 1].order + ordered[i].order) / 2;
      return [...steps, { id: newId(), text, order, ...extra, s: e.s }];
    }),
  );

export const updateStep = (
  doc: Doc,
  ctx: Ctx,
  id: string,
  stepId: string,
  patch: Partial<Pick<Step, 'text' | 'repeat' | 'order' | 'due' | 'effort'>>,
) =>
  edit(doc, ctx, (e) =>
    e.child(id, 'steps', (steps) =>
      steps.map((s) => {
        if (s.id !== stepId) return s;
        const next = { ...s, ...patch, s: e.s };
        for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (patch[k] === undefined) delete next[k];
        return next;
      }),
    ),
  );

/** Put the steps in the given order (after a drag). */
export const reorderSteps = (doc: Doc, ctx: Ctx, id: string, ids: string[]) =>
  edit(doc, ctx, (e) =>
    e.child(id, 'steps', (steps) =>
      steps.map((s) => {
        const i = ids.indexOf(s.id);
        return i < 0 || s.order === i ? s : { ...s, order: i, s: e.s };
      }),
    ),
  );

/** A step that has grown: it becomes its own task, linked to this one, keeping its deadline and estimate. */
export function promoteStep(doc: Doc, ctx: Ctx, id: string, stepId: string): [Doc, string] {
  const step = doc.tasks[id]?.steps.find((s) => s.id === stepId && !s.deleted);
  if (!step) throw new Error('This step no longer exists.');
  const [withTask, newId] = addTask(doc, ctx, { title: step.text, linkTo: id, due: step.due, effort: step.effort });
  return [removeStep(withTask, ctx, id, stepId), newId];
}

export const removeStep = (doc: Doc, ctx: Ctx, id: string, stepId: string) =>
  edit(doc, ctx, (e) =>
    e.child(id, 'steps', (steps) => steps.map((s) => (s.id === stepId ? { ...s, deleted: true, s: e.s } : s))),
  );

/** Move a step one place up (-1) or down (+1). */
export const moveStep = (doc: Doc, ctx: Ctx, id: string, stepId: string, dir: -1 | 1) =>
  edit(doc, ctx, (e) => {
    const ordered = stepsOf(e.task(id));
    const i = ordered.findIndex((s) => s.id === stepId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const a = ordered[i];
    const b = ordered[j];
    e.child(id, 'steps', (steps) =>
      steps.map((s) =>
        s.id === a.id ? { ...s, order: b.order, s: e.s } : s.id === b.id ? { ...s, order: a.order, s: e.s } : s,
      ),
    );
  });

/** Check or uncheck a step; in a task that reopens, checking the last one finishes the round. */
export function toggleStep(doc: Doc, ctx: Ctx, id: string, stepId: string, checked: boolean): Doc {
  return edit(doc, ctx, (e) => {
    const t = e.task(id);
    const step = t.steps.find((s) => s.id === stepId);
    if (!step) throw new Error('This step no longer exists.');
    const now = ctx.now;
    let patch: Partial<Step>;
    if (step.repeat && step.repeat !== 'none') {
      const r = stepRound(step, now);
      patch = checked
        ? { doneIn: r?.key ?? 'start', doneAt: now.toISOString() }
        : { doneIn: undefined, doneAt: undefined };
    } else if (!step.repeat && taskRound(t, now)) {
      patch = { doneIn: checked ? taskRound(t, now)!.key : undefined };
    } else patch = { done: checked };
    e.child(id, 'steps', (steps) => steps.map((s) => (s.id === stepId ? { ...s, ...patch, s: e.s } : s)));
    const after = e.task(id);
    const round = taskRound(after, now);
    if (!round) return;
    // The round is done when nothing in the task is left open: the steps that follow it, and also one-off steps and
    // steps on their own rule. A task with no step that follows it never finishes by itself.
    const steps = stepsOf(after);
    const allDone = steps.some((s) => !s.repeat) && steps.every((s) => stepDone(after, s, now));
    if (allDone && !round.done) finishRound(e, id, round.key);
    if (!checked && round.done) reopenRound(e, id, round.key);
  });
}

function finishRound(e: Edit, id: string, key: string) {
  e.child(id, 'rounds', (rounds) => [
    ...rounds.filter((r) => r.key !== key),
    { key, doneAt: e.ctx.now.toISOString(), s: e.s },
  ]);
}
function reopenRound(e: Edit, id: string, key: string) {
  e.child(id, 'rounds', (rounds) =>
    rounds.map((r) => (r.key === key && !r.deleted ? { ...r, deleted: true, s: e.s } : r)),
  );
}

/**
 * Complete a task. A task that reopens finishes its current round (and checks its steps);
 * a "new copy" task is done and its next copy is created; anything else is simply done.
 */
export function complete(doc: Doc, ctx: Ctx, id: string): Doc {
  return edit(doc, ctx, (e) => {
    const t = e.task(id);
    const now = ctx.now;
    const round = taskRound(t, now);
    if (t.repeat?.mode === 'reopen') {
      if (!round) throw new Error('The first round has not started yet.');
      e.child(id, 'steps', (steps) =>
        steps.map((s) => (!s.repeat && !s.deleted ? { ...s, doneIn: round.key, s: e.s } : s)),
      );
      finishRound(e, id, round.key);
      return;
    }
    e.set(id, 'done', now.toISOString());
    if (t.repeat?.mode === 'copy') spawnCopy(e, t);
  });
}

function spawnCopy(e: Edit, t: Task) {
  const rule = t.repeat!.rule;
  const plan = planOf(t);
  const anchor = t.due ?? plan[0]?.day ?? rule.start;
  const next = nextCopyDay(rule, anchor, e.ctx.now);
  if (!next) return;
  const shift = diffDays(next, anchor);
  const nextRule: RepeatRule = { ...rule, ...(rule.count !== undefined ? { count: rule.count - 1 } : {}) };
  const id = newId();
  const fs: Record<string, Stamp> = {};
  const copy: Task = {
    id,
    title: t.title,
    created: e.ctx.now.toISOString(),
    plan: plan.map((p) => ({
      id: newId(),
      day: addDays(p.day, shift),
      part: p.part,
      start: p.start,
      minutes: p.minutes,
      s: e.s,
    })),
    steps: stepsOf(t).map((s) => ({ id: newId(), text: s.text, order: s.order, repeat: s.repeat, s: e.s })),
    rounds: [],
    fs,
    s: e.s,
  };
  for (const p of copy.plan) if (p.part === undefined) delete p.part;
  const carry: Partial<Task> = {
    note: t.note,
    star: t.star,
    effort: t.effort,
    areaId: t.areaId,
    projectId: t.projectId,
    dueTime: t.dueTime,
    due: t.due ? addDays(t.due, shift) : undefined,
    repeat: { mode: 'copy', rule: nextRule },
  };
  for (const [k, v] of Object.entries(carry)) if (v !== undefined) Object.assign(copy, { [k]: v });
  for (const f of TASK_FIELDS) fs[f] = e.s;
  e.put(copy);
}

/** Settle a text conflict: keep what is shown, or take the other device's version. Either way it becomes a new edit. */
export function resolveConflict(doc: Doc, ctx: Ctx, id: string, field: TextField, use: 'current' | 'other'): Doc {
  return edit(doc, ctx, (e) => {
    const t = e.task(id);
    const c = t.conflicts?.[field];
    if (!c) return;
    const rest = { ...t.conflicts };
    delete rest[field];
    const value = use === 'other' ? c.value : t[field];
    const next: Task = { ...t, fs: { ...t.fs, [field]: e.s }, fb: { ...t.fb, [field]: t.fs[field] } };
    if (Object.keys(rest).length) next.conflicts = rest;
    else delete next.conflicts;
    if (value === undefined) delete next[field];
    else next[field] = value;
    e.put(next);
  });
}

/** The conflict on a field that still applies (the field has not changed since). */
export const openConflict = (t: Task, field: TextField) => {
  const c = t.conflicts?.[field];
  return c && t.fs[field] && cmpStamp(c.against, t.fs[field]) === 0 ? c : undefined;
};

/** Undo completion: reopen a done task, or reopen a finished round. */
export function uncomplete(doc: Doc, ctx: Ctx, id: string): Doc {
  return edit(doc, ctx, (e) => {
    const t = e.task(id);
    if (t.done) return e.set(id, 'done', undefined);
    const round = taskRound(t, ctx.now);
    if (round?.done) {
      reopenRound(e, id, round.key);
      e.child(id, 'steps', (steps) =>
        steps.map((s) => (s.doneIn === round.key && !s.repeat ? { ...s, doneIn: undefined, s: e.s } : s)),
      );
    }
  });
}

export const addArea = (doc: Doc, ctx: Ctx, name: string): [Doc, string] => {
  const id = newId();
  return [
    edit(doc, ctx, (e) => {
      const order = Object.values(e.doc.areas).length;
      e.doc.areas[id] = { id, name: name.trim(), order, s: e.s } satisfies Area;
    }),
    id,
  ];
};
export const addProject = (doc: Doc, ctx: Ctx, name: string, areaId?: string): [Doc, string] => {
  const id = newId();
  return [
    edit(doc, ctx, (e) => {
      const order = Object.values(e.doc.projects).length;
      e.doc.projects[id] = { id, name: name.trim(), areaId, order, s: e.s } satisfies Project;
    }),
    id,
  ];
};
/** Put tasks in the order given (a drag in the list sorted by hand). */
export const reorderTasks = (doc: Doc, ctx: Ctx, ids: string[]) =>
  edit(doc, ctx, (e) => {
    ids.forEach((id, i) => {
      if (e.doc.tasks[id] && !e.doc.tasks[id].deleted && e.doc.tasks[id].rank !== i) e.set(id, 'rank', i);
    });
  });

/** Change a project's settings (for now: whether its tasks go one after another). */
export const updateProject = (doc: Doc, ctx: Ctx, id: string, patch: Partial<Pick<Project, 'sequential'>>) =>
  edit(doc, ctx, (e) => {
    const p = e.doc.projects[id];
    if (!p) return;
    const next = { ...p, ...patch, s: e.s };
    if (!next.sequential) delete next.sequential;
    e.doc.projects[id] = next;
  });

export const renameGroup = (doc: Doc, ctx: Ctx, kind: 'areas' | 'projects', id: string, name: string) =>
  edit(doc, ctx, (e) => {
    const g = e.doc[kind][id];
    if (g) e.doc[kind][id] = { ...g, name: name.trim(), s: e.s } as never;
  });
export const removeGroup = (doc: Doc, ctx: Ctx, kind: 'areas' | 'projects', id: string) =>
  edit(doc, ctx, (e) => {
    const g = e.doc[kind][id];
    if (g) e.doc[kind][id] = { ...g, deleted: true, s: e.s } as never;
    const field = kind === 'areas' ? 'areaId' : 'projectId';
    for (const t of liveTasks(e.doc)) if (t[field] === id) e.set(t.id, field, undefined);
  });

export const setSettings = (doc: Doc, ctx: Ctx, patch: Partial<Omit<Settings, 's'>>) =>
  edit(doc, ctx, (e) => {
    e.doc.settings = { ...e.doc.settings, ...patch, s: e.s };
  });

/**
 * Undo by writing an earlier snapshot's values back as new edits, so the undo itself syncs.
 * Only what differs is stamped.
 */
export function restore(current: Doc, snapshot: Doc, ctx: Ctx): Doc {
  return edit(current, ctx, (e) => {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    for (const id of new Set([...Object.keys(current.tasks), ...Object.keys(snapshot.tasks)])) {
      const now = current.tasks[id];
      const was = snapshot.tasks[id];
      if (!was) {
        if (now && !now.deleted) e.put({ ...now, deleted: true, fs: { ...now.fs, deleted: e.s } });
        continue;
      }
      if (!now) {
        e.put(was);
        continue;
      }
      let t: Task = { ...now };
      let changed = false;
      for (const f of [...TASK_FIELDS, 'deleted'] as const) {
        if (same(now[f], was[f])) continue;
        changed = true;
        t = { ...t, fs: { ...t.fs, [f]: e.s } };
        if ((f === 'title' || f === 'note') && now.fs[f]) t.fb = { ...t.fb, [f]: now.fs[f] };
        if (was[f] === undefined) delete (t as Record<string, unknown>)[f];
        else (t as Record<string, unknown>)[f] = was[f];
      }
      for (const list of ['plan', 'steps', 'rounds'] as const) {
        const byId = (xs: { id?: string; key?: string }[]) => new Map(xs.map((x) => [x.id ?? x.key!, x]));
        const a = byId(now[list] as never);
        const b = byId(was[list] as never);
        const merged: unknown[] = [];
        for (const k of new Set([...a.keys(), ...b.keys()])) {
          const x = a.get(k) as { deleted?: boolean } | undefined;
          const y = b.get(k);
          const strip = (v: unknown) => (v ? { ...(v as object), s: undefined } : v);
          if (y && x && same(strip(x), strip(y))) merged.push(x);
          else if (y) (merged.push({ ...y, s: e.s }), (changed = true));
          else if (x && !x.deleted) (merged.push({ ...x, deleted: true, s: e.s }), (changed = true));
          else if (x) merged.push(x);
        }
        t = { ...t, [list]: merged };
      }
      if (changed) e.put(t);
    }
    for (const kind of ['areas', 'projects'] as const) {
      for (const id of new Set([...Object.keys(current[kind]), ...Object.keys(snapshot[kind])])) {
        const now = current[kind][id];
        const was = snapshot[kind][id];
        if (same({ ...now, s: 0 }, { ...was, s: 0 })) continue;
        if (was) e.doc[kind][id] = { ...was, s: e.s } as never;
        else if (now) e.doc[kind][id] = { ...now, deleted: true, s: e.s } as never;
      }
    }
    if (!same({ ...current.settings, s: 0 }, { ...snapshot.settings, s: 0 }))
      e.doc.settings = { ...snapshot.settings, s: e.s };
  });
}

export const today = (ctx: Ctx) => dayOf(ctx.now);
