import { dayOf, isDay, isTime, timeOf, nowMinutes } from './dates';
import { edit, newId, type Ctx } from './doc';
import {
  TASK_FIELDS,
  type Doc,
  type Frequency,
  type PlanEntry,
  type Repeat,
  type RepeatRule,
  type Snooze,
  type Stamp,
  type Step,
  type Task,
} from './types';

/**
 * Import data exported from the previous app (Attention Planner legacy / Mindwtr JSON).
 * The mapping follows docs/design.md: statuses become "done" or a snooze, planned days and
 * reserved blocks become arrangements, both repeat styles map onto `repeat`, and fields
 * this app does not use are kept in `legacy` rather than dropped.
 */
export type ImportReport = {
  tasks: number;
  done: number;
  snoozed: number;
  areas: number;
  projects: number;
  skipped: number;
};

type AnyRec = Record<string, unknown>;
const obj = (v: unknown): AnyRec | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRec) : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

const ESTIMATES: Record<string, number> = {
  '5min': 5,
  '10min': 10,
  '15min': 15,
  '30min': 30,
  '1hr': 60,
  '2hr': 120,
  '3hr': 180,
  '4hr': 240,
  '4hr+': 300,
};
function effortOf(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const custom = /^custom:(\d+)$/.exec(s);
  if (custom) return +custom[1] || undefined;
  return ESTIMATES[s];
}

/** A legacy date value: `YYYY-MM-DD`, or an ISO date-time read in local time. */
function dayPart(v: unknown): { day?: string; time?: string } {
  const s = str(v);
  if (!s) return {};
  if (isDay(s.slice(0, 10)) && s.length === 10) return { day: s };
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return {};
  const hasTime = s.includes('T') && !/T00:00(:00(\.000)?)?(Z|[+-]00:?00)?$/.test(s);
  return { day: dayOf(d), time: hasTime ? timeOf(nowMinutes(d)) : undefined };
}

const FREQS: Frequency[] = ['hourly', 'daily', 'weekly', 'monthly', 'yearly'];
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** Legacy "new copy" recurrence: a rule name plus an optional RRULE. */
function copyRule(rec: unknown, start: string): RepeatRule | undefined {
  const r = typeof rec === 'string' ? { rule: rec } : obj(rec);
  if (!r) return undefined;
  const rrule = Object.fromEntries(
    (str(r.rrule) ?? '')
      .replace(/^RRULE:/, '')
      .split(';')
      .filter(Boolean)
      .map((kv) => kv.split('=') as [string, string]),
  );
  const freq = (str(r.rule) ?? rrule.FREQ?.toLowerCase()) as Frequency;
  if (!FREQS.includes(freq) || freq === 'hourly') return undefined;
  const byDay = (rrule.BYDAY ? rrule.BYDAY.split(',') : arr(r.byDay).map(String))
    .map((d) => BYDAY.indexOf(d.slice(-2)))
    .filter((i) => i >= 0)
    .map((i) => i + 1);
  const monthDay = Number((rrule.BYMONTHDAY ?? arr(r.byMonthDay)[0]) || NaN);
  const untilRaw = str(r.until) ?? rrule.UNTIL;
  const until = untilRaw
    ? /^\d{8}/.test(untilRaw)
      ? `${untilRaw.slice(0, 4)}-${untilRaw.slice(4, 6)}-${untilRaw.slice(6, 8)}`
      : untilRaw.slice(0, 10)
    : undefined;
  const count = Number(r.count ?? rrule.COUNT) || undefined;
  return {
    freq,
    every: Math.max(1, Number(rrule.INTERVAL) || 1),
    fromDone: r.strategy === 'fluid',
    start,
    ...(byDay.length ? { weekdays: byDay } : {}),
    ...(Number.isFinite(monthDay) ? { monthDay } : {}),
    ...(until && isDay(until) ? { until } : {}),
    ...(count ? { count } : {}),
  };
}

/** Legacy "reopen in place" checklist refresh policy. */
function reopenRule(policy: unknown): (RepeatRule & { paused?: boolean }) | 'none' | undefined {
  const p = obj(policy);
  if (!p) return undefined;
  if (p.mode === 'off') return 'none';
  const s = obj(p.schedule);
  if (p.mode !== 'custom' || !s) return undefined;
  const freq = s.frequency as Frequency;
  if (!FREQS.includes(freq) || !isDay(s.startDate)) return undefined;
  const end = obj(p.end);
  const monthDays = arr(s.monthDays).map(Number);
  return {
    freq,
    every: Math.max(1, Number(s.interval) || 1),
    fromDone: s.anchor === 'completion',
    start: s.startDate,
    ...(isTime(s.time) && s.time !== '00:00' ? { time: s.time } : {}),
    ...(arr(s.weekdays).length ? { weekdays: arr(s.weekdays).map(Number) } : {}),
    ...(monthDays.length ? { monthDay: monthDays[0] } : {}),
    ...(end?.mode === 'date' && isDay(end.date) ? { until: end.date } : {}),
    ...(p.pausedAt ? { paused: true } : {}),
  };
}

const SNOOZE_REASON: Record<string, string> = { waiting: '等待中', someday: '暂不做', reference: '资料' };

export function importLegacy(doc: Doc, ctx: Ctx, data: unknown): [Doc, ImportReport] {
  const root = obj(data) ?? {};
  const src = obj(root.data) ?? root; // some exports wrap the payload
  const report: ImportReport = { tasks: 0, done: 0, snoozed: 0, areas: 0, projects: 0, skipped: 0 };
  const today = dayOf(ctx.now);
  const next = edit(doc, ctx, (e) => {
    const s: Stamp = e.s;
    const areaIds = new Map<string, string>();
    for (const a of arr(src.areas).map(obj)) {
      if (!a || a.deletedAt || !str(a.name ?? a.title)) continue;
      const id = str(a.id) ?? newId();
      areaIds.set(String(a.id), id);
      e.doc.areas[id] = { id, name: String(a.name ?? a.title), order: Number(a.order) || report.areas, s };
      report.areas++;
    }
    const projectIds = new Map<string, string>();
    for (const p of arr(src.projects).map(obj)) {
      if (!p || p.deletedAt || !str(p.title ?? p.name)) continue;
      const id = str(p.id) ?? newId();
      projectIds.set(String(p.id), id);
      e.doc.projects[id] = {
        id,
        name: String(p.title ?? p.name),
        order: Number(p.order) || report.projects,
        s,
        ...(p.areaId && areaIds.has(String(p.areaId)) ? { areaId: areaIds.get(String(p.areaId)) } : {}),
        ...(p.status === 'archived' || p.status === 'completed'
          ? { done: str(p.updatedAt) ?? ctx.now.toISOString() }
          : {}),
      };
      report.projects++;
    }
    const taskIds = new Set(arr(src.tasks).map((t) => String(obj(t)?.id)));
    for (const raw of arr(src.tasks)) {
      const t = obj(raw);
      if (!t || t.deletedAt || t.purgedAt || !str(t.title)) {
        report.skipped++;
        continue;
      }
      const id = str(t.id) ?? newId();
      const status = String(t.status ?? 'inbox');
      const planner = obj(t.planner) ?? {};
      const refresh = obj(planner.checklistRefresh);
      const plan: PlanEntry[] = [];
      for (const d of arr(planner.days).map(obj))
        if (d && d.selected && isDay(d.date)) plan.push({ id: newId(), day: d.date, s });
      for (const b of arr(planner.blocks).map(obj)) {
        if (!b || b.state === 'cancelled' || !str(b.startAt)) continue;
        const at = new Date(String(b.startAt));
        if (Number.isNaN(at.getTime())) continue;
        const done = Number(b.completedMinutes) || 0;
        plan.push({
          id: newId(),
          day: dayOf(at),
          start: timeOf(nowMinutes(at)),
          minutes: Number(b.durationMinutes) || 60,
          ...(done ? { doneMin: done } : {}),
          s,
        });
      }
      const due = dayPart(t.dueDate);
      const available = dayPart(
        t.availableAt ?? (str(t.startTime) && !String(t.startTime).includes('T') ? t.startTime : undefined),
      );
      let snooze: Snooze | undefined;
      if (SNOOZE_REASON[status]) snooze = { reason: SNOOZE_REASON[status] };
      if (available.day && available.day > today) snooze = { ...snooze, until: available.day };
      const refreshRule = reopenRule(refresh?.defaults);
      let repeat: Repeat | undefined;
      if (refreshRule && refreshRule !== 'none') {
        const { paused, ...rule } = refreshRule;
        repeat = { mode: 'reopen', rule, ...(paused ? { paused } : {}) };
      } else if (t.recurrence) {
        const rule = copyRule(t.recurrence, due.day ?? plan[0]?.day ?? today);
        if (rule) repeat = { mode: 'copy', rule };
      }
      const items = obj(refresh?.items) ?? {};
      const steps: Step[] = arr(t.checklist)
        .map(obj)
        .filter((c): c is AnyRec => !!c && !!str(c.title))
        .map((c, i) => {
          const own = reopenRule(items[String(c.id)]);
          const stepRepeat = own === 'none' ? 'none' : own ? (({ paused: _p, ...r }) => r)(own) : undefined;
          return {
            id: str(c.id) ?? newId(),
            text: String(c.title),
            order: i,
            ...(repeat?.mode === 'reopen' && !stepRepeat ? {} : { done: !!c.isCompleted }),
            ...(stepRepeat ? { repeat: stepRepeat } : {}),
            s,
          } as Step;
        });
      const doneAt =
        status === 'done' || status === 'archived'
          ? (str(t.completedAt) ?? str(t.updatedAt) ?? ctx.now.toISOString())
          : undefined;
      const legacy: AnyRec = {};
      for (const k of [
        'tags',
        'contexts',
        'priority',
        'energyLevel',
        'assignedTo',
        'location',
        'attachments',
        'status',
      ])
        if (t[k] !== undefined && !(Array.isArray(t[k]) && !(t[k] as unknown[]).length)) legacy[k] = t[k];
      const task: Task = {
        id,
        title: String(t.title).trim(),
        created: str(t.createdAt) ?? ctx.now.toISOString(),
        plan,
        steps,
        rounds: [],
        fs: {},
        s,
      };
      const fields: Partial<Task> = {
        note: str(t.description),
        done: doneAt,
        star: t.priority === 'high' || t.priority === 'urgent' ? true : undefined,
        snooze,
        due: due.day,
        dueTime: due.time,
        effort: effortOf(t.timeEstimate),
        areaId: t.areaId && areaIds.has(String(t.areaId)) ? areaIds.get(String(t.areaId)) : undefined,
        projectId: t.projectId && projectIds.has(String(t.projectId)) ? projectIds.get(String(t.projectId)) : undefined,
        linkTo: str(t.parentTaskId) && taskIds.has(String(t.parentTaskId)) ? String(t.parentTaskId) : undefined,
        repeat,
      };
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) Object.assign(task, { [k]: v });
      for (const f of TASK_FIELDS) task.fs[f] = s;
      if (Object.keys(legacy).length) task.legacy = legacy;
      e.doc.tasks[id] = task;
      report.tasks++;
      if (doneAt) report.done++;
      if (snooze) report.snoozed++;
    }
  });
  return [next, report];
}
