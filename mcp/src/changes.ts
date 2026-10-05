import * as z from 'zod';
import { isoWeekday } from '../../src/model/dates';
import {
  addArea,
  addPlan,
  addProject,
  addStep,
  complete,
  removePlan,
  removeTask,
  setField,
  stepsOf,
  taskEffort,
  toggleStep,
  uncomplete,
  type Ctx,
} from '../../src/model/doc';
import type { Day, Doc, Part, Task } from '../../src/model/types';

export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A day is YYYY-MM-DD.');
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time is HH:MM (24-hour).');
export const partSchema = z.enum(['am', 'pm', 'eve']);
const taskId = z.string().min(1).max(100);

/** One change to an existing task, as the AI proposes it. The owner approves a list of them together. */
export const changeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update'),
    task_id: taskId,
    title: z.string().trim().min(1).max(500).optional(),
    note: z.string().max(20000).optional().describe('Replaces the whole note (Markdown).'),
    due: daySchema.nullable().optional().describe('Deadline day; null removes it.'),
    due_time: timeSchema.nullable().optional(),
    effort_minutes: z.number().int().min(1).max(10000).nullable().optional(),
    star: z.boolean().optional().describe('Important.'),
    area: z.string().max(100).nullable().optional().describe('Area name or id; a new name creates it; null clears.'),
    project: z
      .string()
      .max(100)
      .nullable()
      .optional()
      .describe('Project name or id; a new name creates it; null clears.'),
  }),
  z.object({ type: z.literal('complete'), task_id: taskId }),
  z.object({ type: z.literal('reopen'), task_id: taskId }),
  z.object({
    type: z.literal('snooze'),
    task_id: taskId,
    until: daySchema.optional().describe('Back on this day; leave out to snooze until further notice.'),
    reason: z.string().max(200).optional().describe('What it is waiting for.'),
  }),
  z.object({ type: z.literal('unsnooze'), task_id: taskId }),
  z.object({
    type: z.literal('plan'),
    task_id: taskId,
    day: daySchema,
    part: partSchema.optional().describe('am, pm or eve; leave out with a start time.'),
    start: timeSchema.optional().describe('Reserve a time from this start.'),
    minutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .optional()
      .describe('Length of the reserved time.'),
  }),
  z.object({ type: z.literal('unplan'), task_id: taskId, plan_id: z.string().min(1).max(100) }),
  z.object({ type: z.literal('add_step'), task_id: taskId, text: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal('check_step'), task_id: taskId, step_id: z.string().min(1).max(100), done: z.boolean() }),
  z.object({ type: z.literal('delete'), task_id: taskId }),
]);
export type Change = z.infer<typeof changeSchema>;

/** An area or project by id or by name (any case); a name that does not exist yet is created. */
export function resolveGroup(doc: Doc, ctx: Ctx, kind: 'areas' | 'projects', ref: string): [Doc, string] {
  const live = Object.values(doc[kind]).filter((g) => !g.deleted);
  const hit =
    live.find((g) => g.id === ref) ?? live.find((g) => g.name.trim().toLowerCase() === ref.trim().toLowerCase());
  if (hit) return [doc, hit.id];
  return kind === 'areas' ? addArea(doc, ctx, ref) : addProject(doc, ctx, ref);
}

/** A reserved time without a length takes the task's estimate, at most two hours (as in the app). */
export const reservedMinutes = (t: Task, minutes?: number) => minutes ?? Math.min(taskEffort(t) ?? 60, 120);

const liveTask = (doc: Doc, id: string): Task => {
  const t = doc.tasks[id];
  if (!t || t.deleted) throw new Error(`There is no task ${id}.`);
  return t;
};

/** Apply one change. Throws if the task, step or reserved time is gone. */
export function applyChange(doc: Doc, ctx: Ctx, c: Change): Doc {
  const t = liveTask(doc, c.task_id);
  switch (c.type) {
    case 'update': {
      let d = doc;
      if (c.title !== undefined) d = setField(d, ctx, t.id, 'title', c.title);
      if (c.note !== undefined) d = setField(d, ctx, t.id, 'note', c.note || undefined);
      if (c.due !== undefined) d = setField(d, ctx, t.id, 'due', c.due ?? undefined);
      if (c.due_time !== undefined) d = setField(d, ctx, t.id, 'dueTime', c.due_time ?? undefined);
      if (c.effort_minutes !== undefined) d = setField(d, ctx, t.id, 'effort', c.effort_minutes ?? undefined);
      if (c.star !== undefined) d = setField(d, ctx, t.id, 'star', c.star || undefined);
      for (const [key, kind, field] of [
        ['area', 'areas', 'areaId'],
        ['project', 'projects', 'projectId'],
      ] as const) {
        const ref = c[key];
        if (ref === undefined) continue;
        if (ref === null || !ref.trim()) d = setField(d, ctx, t.id, field, undefined);
        else {
          let id: string;
          [d, id] = resolveGroup(d, ctx, kind, ref);
          d = setField(d, ctx, t.id, field, id);
        }
      }
      return d;
    }
    case 'complete':
      return complete(doc, ctx, t.id);
    case 'reopen':
      return uncomplete(doc, ctx, t.id);
    case 'snooze':
      return setField(doc, ctx, t.id, 'snooze', {
        ...(c.until ? { until: c.until } : {}),
        ...(c.reason ? { reason: c.reason } : {}),
      });
    case 'unsnooze':
      return setField(doc, ctx, t.id, 'snooze', undefined);
    case 'plan':
      return addPlan(doc, ctx, t.id, {
        day: c.day,
        ...(c.start ? { start: c.start, minutes: reservedMinutes(t, c.minutes) } : {}),
        ...(!c.start && c.part ? { part: c.part } : {}),
      });
    case 'unplan':
      if (!t.plan.some((p) => p.id === c.plan_id && !p.deleted)) throw new Error(`There is no plan ${c.plan_id}.`);
      return removePlan(doc, ctx, t.id, c.plan_id);
    case 'add_step':
      return addStep(doc, ctx, t.id, c.text);
    case 'check_step':
      if (!stepsOf(t).some((s) => s.id === c.step_id)) throw new Error(`There is no step ${c.step_id}.`);
      return toggleStep(doc, ctx, t.id, c.step_id, c.done);
    case 'delete':
      return removeTask(doc, ctx, t.id);
  }
}

/** Apply a list of changes together: all of them, or (by throwing) none. */
export function applyChanges(doc: Doc, ctx: Ctx, changes: Change[]): Doc {
  return changes.reduce((d, c) => applyChange(d, ctx, c), doc);
}

// ---------- words for the owner ----------

type T = (zh: string, en: string) => string;
const CN_WEEK = '一二三四五六日';
const EN_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const dayWords = (day: Day, t: T) => {
  const w = isoWeekday(day);
  return t(`${+day.slice(5, 7)}/${+day.slice(8)}（周${CN_WEEK[w - 1]}）`, `${EN_WEEK[w - 1]} ${day.slice(5)}`);
};
export const minutesWords = (m: number, t: T) =>
  m % 60 === 0
    ? t(`${m / 60} 小时`, `${m / 60} h`)
    : m > 60
      ? t(`${Math.floor(m / 60)} 小时 ${m % 60} 分钟`, `${Math.floor(m / 60)} h ${m % 60} min`)
      : t(`${m} 分钟`, `${m} min`);
const partWords = (p: Part, t: T) =>
  ({ am: t('上午', 'morning'), pm: t('下午', 'afternoon'), eve: t('晚上', 'evening') })[p];

/**
 * What a change will do, in the owner's language, against the document as it is now.
 * A change whose task is gone says so, rather than failing.
 */
export function describeChange(doc: Doc, c: Change, t: T): string {
  const task = doc.tasks[c.task_id];
  if (!task || task.deleted) return t(`（任务已不存在：${c.task_id}）`, `(the task is gone: ${c.task_id})`);
  const name = `「${task.title}」`;
  const groupName = (kind: 'areas' | 'projects', id?: string) => (id ? doc[kind][id]?.name : undefined);
  const none = t('无', 'none');
  const arrow = (from: string | undefined, to: string | undefined) => `${from ?? none} → ${to ?? none}`;
  switch (c.type) {
    case 'update': {
      const parts: string[] = [];
      if (c.title !== undefined) parts.push(t('标题：', 'Title: ') + arrow(task.title, c.title));
      if (c.note !== undefined)
        parts.push(
          c.note
            ? t(`备注改为（${c.note.length} 字）：`, `Note becomes (${c.note.length} chars): `) + c.note
            : t('清空备注', 'Clear the note'),
        );
      if (c.due !== undefined)
        parts.push(
          t('截止：', 'Deadline: ') + arrow(task.due && dayWords(task.due, t), c.due ? dayWords(c.due, t) : undefined),
        );
      if (c.due_time !== undefined)
        parts.push(t('截止时间：', 'Due time: ') + arrow(task.dueTime, c.due_time ?? undefined));
      if (c.effort_minutes !== undefined)
        parts.push(
          t('用时：', 'Effort: ') +
            arrow(
              task.effort ? minutesWords(task.effort, t) : undefined,
              c.effort_minutes ? minutesWords(c.effort_minutes, t) : undefined,
            ),
        );
      if (c.star !== undefined) parts.push(c.star ? t('标为重要', 'Mark important') : t('取消重要', 'Not important'));
      if (c.area !== undefined)
        parts.push(t('区域：', 'Area: ') + arrow(groupName('areas', task.areaId), c.area ?? undefined));
      if (c.project !== undefined)
        parts.push(t('项目：', 'Project: ') + arrow(groupName('projects', task.projectId), c.project ?? undefined));
      return `${t('修改', 'Edit')} ${name}：${parts.join('；') || t('（没有改动）', '(nothing)')}`;
    }
    case 'complete':
      return t(`完成 ${name}`, `Complete ${name}`);
    case 'reopen':
      return t(`重新打开 ${name}`, `Reopen ${name}`);
    case 'snooze':
      return (
        t(`暂缓 ${name}`, `Snooze ${name}`) +
        (c.until ? t(` 到 ${dayWords(c.until, t)}`, ` until ${dayWords(c.until, t)}`) : t('（不定期）', ' (no end)')) +
        (c.reason ? t(`，原因：${c.reason}`, `, because: ${c.reason}`) : '')
      );
    case 'unsnooze':
      return t(`取消暂缓 ${name}`, `Unsnooze ${name}`);
    case 'plan': {
      const minutes = reservedMinutes(task, c.minutes);
      const when = c.start
        ? `${c.start}${t(`，${minutesWords(minutes, t)}`, `, ${minutesWords(minutes, t)}`)}`
        : c.part
          ? partWords(c.part, t)
          : '';
      return t(
        `安排 ${name} 在 ${dayWords(c.day, t)} ${when}`,
        `Plan ${name} for ${dayWords(c.day, t)} ${when}`,
      ).trim();
    }
    case 'unplan': {
      const p = task.plan.find((x) => x.id === c.plan_id);
      return (
        t(`取消 ${name} 的安排`, `Remove a plan of ${name}`) +
        (p ? `（${dayWords(p.day, t)}${p.start ? ' ' + p.start : ''}）` : '')
      );
    }
    case 'add_step':
      return t(`给 ${name} 加步骤：${c.text}`, `Add a step to ${name}: ${c.text}`);
    case 'check_step': {
      const s = task.steps.find((x) => x.id === c.step_id);
      const label = s ? `「${s.text}」` : c.step_id;
      return c.done
        ? t(`勾掉 ${name} 的步骤 ${label}`, `Check ${label} in ${name}`)
        : t(`取消勾选 ${name} 的步骤 ${label}`, `Uncheck ${label} in ${name}`);
    }
    case 'delete':
      return t(`删除 ${name}`, `Delete ${name}`);
  }
}
