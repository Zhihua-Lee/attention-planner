import { cmpStamp } from './doc';
import { TASK_FIELDS, TEXT_FIELDS, type Doc, type Stamp, type Step, type Task } from './types';

type Stamped = { s: Stamp };
const newer = <T extends Stamped>(a: T | undefined, b: T | undefined): T | undefined =>
  cmpStamp(a?.s, b?.s) >= 0 ? a : b;

function mergeList<T extends Stamped>(
  a: T[],
  b: T[],
  key: (x: T) => string,
  pick: (x: T, y: T) => T = (x, y) => newer(x, y)!,
): T[] {
  const map = new Map<string, T>();
  for (const x of a) map.set(key(x), x);
  for (const y of b) {
    const x = map.get(key(y));
    map.set(key(y), x ? pick(x, y) : y);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
}

const CHECK_FIELDS = ['done', 'doneIn', 'doneAt', 'ds'] as const;

/** A step: the newer record, with its check state from whichever side was checked or unchecked last. */
function mergeStep(a: Step, b: Step): Step {
  const base = newer(a, b)!;
  if (!a.ds && !b.ds) return base;
  const checked = cmpStamp(a.ds, b.ds) >= 0 ? a : b;
  if (checked === base) return base;
  const out: Step = { ...base };
  for (const k of CHECK_FIELDS) {
    if (checked[k] === undefined) delete out[k];
    else (out as Record<string, unknown>)[k] = checked[k];
  }
  return out;
}

/** Each scalar field keeps whichever side stamped it last; children merge record by record. */
export function mergeTask(a: Task, b: Task): Task {
  const base = cmpStamp(a.s, b.s) >= 0 ? a : b;
  const out: Task = { ...base, fs: { ...a.fs } };
  for (const f of [...TASK_FIELDS, 'deleted'] as const) {
    const sa = a.fs[f];
    const sb = b.fs[f];
    const src = cmpStamp(sa, sb) >= 0 ? a : b;
    const stamp = cmpStamp(sa, sb) >= 0 ? sa : sb;
    if (stamp) out.fs[f] = stamp;
    const v = src[f];
    if (v === undefined) delete (out as Record<string, unknown>)[f];
    else (out as Record<string, unknown>)[f] = v;
  }
  // Text: remember what each version replaced, and keep the losing side of a genuinely concurrent edit.
  const fb: NonNullable<Task['fb']> = {};
  const conflicts: NonNullable<Task['conflicts']> = {};
  for (const f of TEXT_FIELDS) {
    const win = cmpStamp(a.fs[f], b.fs[f]) >= 0 ? a : b;
    const lose = win === a ? b : a;
    if (win.fb?.[f]) fb[f] = win.fb[f];
    const ws = win.fs[f];
    const ls = lose.fs[f];
    const concurrent =
      ws &&
      ls &&
      cmpStamp(ws, ls) !== 0 &&
      win[f] !== lose[f] &&
      !!win.fb?.[f] &&
      cmpStamp(win.fb[f], ls) < 0 &&
      !(lose.fb?.[f] && cmpStamp(lose.fb[f], ws) >= 0);
    const known = [a.conflicts?.[f], b.conflicts?.[f]].find((c) => c && ws && cmpStamp(c.against, ws) === 0);
    if (concurrent) conflicts[f] = { value: lose[f], s: ls!, against: ws! };
    else if (known) conflicts[f] = known;
  }
  if (Object.keys(fb).length) out.fb = fb;
  else delete out.fb;
  if (Object.keys(conflicts).length) out.conflicts = conflicts;
  else delete out.conflicts;
  out.plan = mergeList(a.plan, b.plan, (x) => x.id);
  out.steps = mergeList(a.steps, b.steps, (x) => x.id, mergeStep);
  out.rounds = mergeList(a.rounds, b.rounds, (x) => x.key);
  out.s = cmpStamp(a.s, b.s) >= 0 ? a.s : b.s;
  return out;
}

/**
 * Merge two copies of the data. Commutative and idempotent, so devices converge whatever order they sync in.
 * Calendar events stay with the local copy (`a`): they are imported per device.
 */
export function mergeDocs(a: Doc, b: Doc): Doc {
  const tasks: Doc['tasks'] = { ...a.tasks };
  for (const [id, t] of Object.entries(b.tasks)) tasks[id] = tasks[id] ? mergeTask(tasks[id], t) : t;
  const areas = { ...a.areas };
  for (const [id, x] of Object.entries(b.areas)) areas[id] = newer(areas[id], x)!;
  const projects = { ...a.projects };
  for (const [id, x] of Object.entries(b.projects)) projects[id] = newer(projects[id], x)!;
  const out: Doc = {
    v: 1,
    clock: Math.max(a.clock, b.clock),
    tasks,
    areas,
    projects,
    settings: newer(a.settings, b.settings)!,
  };
  if (a.proposals || b.proposals) {
    const proposals = { ...a.proposals };
    for (const [id, x] of Object.entries(b.proposals ?? {})) proposals[id] = newer(proposals[id], x)!;
    out.proposals = proposals;
  }
  if (a.events) out.events = a.events;
  return out;
}

/** Drop tombstones older than `days`, once every device has had time to see them. */
export function purgeTombstones(doc: Doc, now: Date, days = 90): Doc {
  const cutoff = new Date(now.getTime() - days * 864e5).toISOString();
  const old = (x: { deleted?: boolean; s: Stamp }) => x.deleted && x.s.at < cutoff;
  const tasks: Doc['tasks'] = {};
  for (const [id, t] of Object.entries(doc.tasks)) {
    if (old(t)) continue;
    tasks[id] = {
      ...t,
      plan: t.plan.filter((x) => !old(x)),
      steps: t.steps.filter((x) => !old(x)),
      rounds: t.rounds.filter((x) => !old(x)),
    };
  }
  const keep = <T extends { deleted?: boolean; s: Stamp }>(r: Record<string, T>) =>
    Object.fromEntries(Object.entries(r).filter(([, x]) => !old(x)));
  const out: Doc = { ...doc, tasks, areas: keep(doc.areas), projects: keep(doc.projects) };
  // Decided proposals are kept for a month, for the record; pending ones until decided.
  if (doc.proposals) {
    const month = new Date(now.getTime() - 30 * 864e5).toISOString();
    out.proposals = Object.fromEntries(
      Object.entries(doc.proposals).filter(([, p]) => p.status === 'pending' || p.s.at >= month),
    );
  }
  return out;
}

/** JSON with object keys sorted, so equal data compares equal whatever order it was built in. */
export function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}
