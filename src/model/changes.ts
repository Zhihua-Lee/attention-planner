import { dayOf, isoWeekday } from './dates';
import {
  addArea,
  addPlan,
  addProject,
  addStep,
  addTask,
  complete,
  planOf,
  promoteStep,
  removePlan,
  removeStep,
  reorderSteps,
  removeTask,
  renameGroup,
  setField,
  stepsOf,
  taskEffort,
  toggleStep,
  uncomplete,
  updatePlan,
  updateProject,
  updateStep,
  type Ctx,
} from './doc';
import type { Day, Doc, Part, Repeat, RepeatRule, Task, Time } from './types';

/**
 * Changes to tasks, projects and areas as an AI proposes them (see mcp/src/changes.ts for their schema). The owner
 * approves a list of them in the app; then they are applied here, with the same operations the app uses.
 */

/** A repeat rule as the AI writes it. */
export type RuleInput = {
  freq: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  every?: number;
  weekdays?: number[];
  month_day?: number;
  from_done?: boolean;
  start?: Day;
  until?: Day;
  count?: number;
};
export type RepeatInput = { mode: 'reopen' | 'copy'; rule: RuleInput; lead_days?: number };

/** A new task, its words already read: the title as it will show, with days and times worked out. */
export type NewTaskInput = {
  type: 'add_task';
  title: string;
  note?: string;
  due?: Day;
  due_time?: Time;
  effort_minutes?: number;
  star?: boolean;
  area?: string;
  project?: string;
  steps?: string[];
  plan?: { day: Day; part?: Part; start?: Time; minutes?: number };
  link_to?: string;
  repeat?: RepeatInput;
};

export type Change =
  | NewTaskInput
  | {
      type: 'update';
      task_id: string;
      title?: string;
      note?: string;
      due?: Day | null;
      due_time?: Time | null;
      effort_minutes?: number | null;
      star?: boolean;
      area?: string | null;
      project?: string | null;
    }
  | { type: 'complete'; task_id: string }
  | { type: 'reopen'; task_id: string }
  | { type: 'snooze'; task_id: string; until?: Day; reason?: string }
  | { type: 'unsnooze'; task_id: string }
  | { type: 'plan'; task_id: string; day: Day; part?: Part; start?: Time; minutes?: number; step_id?: string }
  | { type: 'unplan'; task_id: string; plan_id: string }
  | { type: 'add_step'; task_id: string; text: string }
  | { type: 'check_step'; task_id: string; step_id: string; done: boolean }
  | {
      type: 'edit_step';
      task_id: string;
      step_id: string;
      text?: string;
      due?: Day | null;
      effort_minutes?: number | null;
      repeat?: 'follow' | 'none' | RuleInput;
    }
  | { type: 'remove_step'; task_id: string; step_id: string }
  | { type: 'promote_step'; task_id: string; step_id: string }
  | { type: 'order_steps'; task_id: string; step_ids: string[] }
  | {
      type: 'move_plan';
      task_id: string;
      plan_id: string;
      day?: Day;
      start?: Time | null;
      part?: Part | null;
      minutes?: number;
    }
  | { type: 'link'; task_id: string; to: string | null }
  | { type: 'set_repeat'; task_id: string; repeat: RepeatInput | null }
  | { type: 'delete'; task_id: string }
  | { type: 'update_project'; project: string; name?: string; one_after_another?: boolean }
  | { type: 'rename_area'; area: string; name: string };

/** The task a change is about, if it is about one. */
export const changeTask = (c: Change): string | undefined => ('task_id' in c ? c.task_id : undefined);

export function toRule(r: RuleInput, start: Day): RepeatRule {
  return {
    freq: r.freq,
    every: r.every ?? 1,
    fromDone: !!r.from_done,
    start: r.start ?? start,
    ...(r.weekdays?.length ? { weekdays: [...new Set(r.weekdays)].sort() } : {}),
    ...(r.month_day ? { monthDay: r.month_day } : {}),
    ...(r.until ? { until: r.until } : {}),
    ...(r.count ? { count: r.count } : {}),
  };
}
/** A model repeat rule (as the capture parser reads one) in the AI's terms. */
export function fromRule(r: RepeatRule): RuleInput {
  return {
    freq: r.freq,
    ...(r.every > 1 ? { every: r.every } : {}),
    ...(r.weekdays?.length ? { weekdays: r.weekdays } : {}),
    ...(r.monthDay ? { month_day: r.monthDay } : {}),
    ...(r.fromDone ? { from_done: true } : {}),
    start: r.start,
    ...(r.until ? { until: r.until } : {}),
    ...(r.count ? { count: r.count } : {}),
  };
}
export function toRepeat(r: RepeatInput, start: Day): Repeat {
  if (r.mode === 'copy' && r.rule.freq === 'hourly') throw new Error('A new-copy repeat cannot be hourly.');
  return {
    mode: r.mode,
    rule: toRule(r.rule, start),
    ...(r.mode === 'copy' && r.lead_days ? { lead: r.lead_days } : {}),
  };
}

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

/** An existing area or project by id or name; unlike `resolveGroup`, never creates one. */
export function findGroup(doc: Doc, kind: 'areas' | 'projects', ref: string) {
  const live = Object.values(doc[kind]).filter((g) => !g.deleted);
  const hit =
    live.find((g) => g.id === ref) ?? live.find((g) => g.name.trim().toLowerCase() === ref.trim().toLowerCase());
  if (!hit) throw new Error(`There is no ${kind === 'areas' ? 'area' : 'project'} "${ref}".`);
  return hit;
}

/** Write a new task down; a new area or project name creates it. */
export function addNewTask(doc: Doc, ctx: Ctx, c: NewTaskInput): [Doc, string] {
  if (c.link_to && (!doc.tasks[c.link_to] || doc.tasks[c.link_to].deleted))
    throw new Error(`There is no task ${c.link_to} to link to.`);
  let d = doc;
  let areaId: string | undefined;
  let projectId: string | undefined;
  if (c.area) [d, areaId] = resolveGroup(d, ctx, 'areas', c.area);
  if (c.project) [d, projectId] = resolveGroup(d, ctx, 'projects', c.project);
  const p = c.plan;
  return addTask(d, ctx, {
    title: c.title,
    note: c.note?.trim() ? c.note : undefined,
    due: c.due,
    dueTime: c.due_time,
    linkTo: c.link_to,
    // As in the app: a repeat starts on the task's own day.
    repeat: c.repeat ? toRepeat(c.repeat, c.due ?? p?.day ?? dayOf(ctx.now)) : undefined,
    effort: c.effort_minutes,
    star: c.star || undefined,
    areaId,
    projectId,
    steps: c.steps,
    plan: p
      ? [
          {
            day: p.day,
            ...(p.start
              ? { start: p.start, minutes: p.minutes ?? Math.min(c.effort_minutes ?? 60, 120) }
              : p.part
                ? { part: p.part }
                : {}),
          },
        ]
      : [],
  });
}

/** Apply one change. Throws if the task, step, plan or group is gone. */
export function applyChange(doc: Doc, ctx: Ctx, c: Change): Doc {
  if (c.type === 'add_task') return addNewTask(doc, ctx, c)[0];
  if (c.type === 'update_project') {
    const p = findGroup(doc, 'projects', c.project);
    let d = doc;
    if (c.name) d = renameGroup(d, ctx, 'projects', p.id, c.name);
    if (c.one_after_another !== undefined) d = updateProject(d, ctx, p.id, { sequential: c.one_after_another });
    return d;
  }
  if (c.type === 'rename_area') return renameGroup(doc, ctx, 'areas', findGroup(doc, 'areas', c.area).id, c.name);
  const t = liveTask(doc, c.task_id);
  const step = (id: string) => {
    if (!stepsOf(t).some((s) => s.id === id)) throw new Error(`There is no step ${id}.`);
    return id;
  };
  switch (c.type) {
    case 'edit_step': {
      const patch: Parameters<typeof updateStep>[4] = {};
      if (c.text !== undefined) patch.text = c.text;
      if (c.due !== undefined) patch.due = c.due ?? undefined;
      if (c.effort_minutes !== undefined) patch.effort = c.effort_minutes ?? undefined;
      if (c.repeat !== undefined)
        patch.repeat =
          c.repeat === 'follow' ? undefined : c.repeat === 'none' ? 'none' : toRule(c.repeat, dayOf(ctx.now));
      return updateStep(doc, ctx, t.id, step(c.step_id), patch);
    }
    case 'remove_step':
      return removeStep(doc, ctx, t.id, step(c.step_id));
    case 'promote_step':
      return promoteStep(doc, ctx, t.id, step(c.step_id))[0];
    case 'order_steps': {
      const first = c.step_ids.map(step);
      if (new Set(first).size !== first.length) throw new Error('A step is listed twice.');
      const rest = stepsOf(t).filter((s) => !first.includes(s.id));
      return reorderSteps(doc, ctx, t.id, [...first, ...rest.map((s) => s.id)]);
    }
    case 'move_plan': {
      if (!t.plan.some((p) => p.id === c.plan_id && !p.deleted)) throw new Error(`There is no plan ${c.plan_id}.`);
      const patch: Parameters<typeof updatePlan>[4] = {};
      if (c.day) patch.day = c.day;
      if (c.start !== undefined) {
        patch.start = c.start ?? undefined;
        if (c.start) patch.part = undefined;
        if (!c.start) patch.minutes = undefined;
      }
      if (c.part !== undefined && !c.start) patch.part = c.part ?? undefined;
      if (c.minutes) patch.minutes = c.minutes;
      return updatePlan(doc, ctx, t.id, c.plan_id, patch);
    }
    case 'link':
      if (c.to !== null && (c.to === t.id || !doc.tasks[c.to] || doc.tasks[c.to].deleted))
        throw new Error(`Cannot link to ${c.to}.`);
      return setField(doc, ctx, t.id, 'linkTo', c.to ?? undefined);
    case 'set_repeat':
      return setField(
        doc,
        ctx,
        t.id,
        'repeat',
        c.repeat ? toRepeat(c.repeat, t.due ?? planOf(t)[0]?.day ?? dayOf(ctx.now)) : undefined,
      );
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
    case 'plan': {
      const forStep = c.step_id ? stepsOf(t).find((s) => s.id === step(c.step_id!)) : undefined;
      return addPlan(doc, ctx, t.id, {
        day: c.day,
        ...(c.start
          ? {
              start: c.start,
              minutes: c.minutes ?? (forStep?.effort ? Math.min(forStep.effort, 120) : reservedMinutes(t)),
            }
          : {}),
        ...(!c.start && c.part ? { part: c.part } : {}),
        ...(forStep ? { stepId: forStep.id } : {}),
      });
    }
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

/** “Shows up N days before its deadline”, for a new-copy repeat that says so. */
const leadWords = (r: RepeatInput, t: T) =>
  r.mode === 'copy' && r.lead_days
    ? t(`，截止前 ${r.lead_days} 天出现`, `, shows up ${r.lead_days} day(s) before its deadline`)
    : '';

/** A note in one short line: its first line without Markdown marks, cut at 60 characters. */
export function noteGist(note: string): string {
  const line = note.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const plain = line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .trim();
  return plain.length > 60 || note.trim() !== line.trim() ? `${plain.slice(0, 60)}…` : plain;
}

/** A repeat rule in a few words: 每周一、三 / 每 2 天 / 每月 15 日 / 完成后 3 天. */
export function ruleWords(r: RuleInput, t: T): string {
  const n = r.every ?? 1;
  const unit = {
    hourly: t('小时', 'hour'),
    daily: t('天', 'day'),
    weekly: t('周', 'week'),
    monthly: t('个月', 'month'),
    yearly: t('年', 'year'),
  }[r.freq];
  let s = r.from_done
    ? t(`完成后 ${n} ${unit}`, `${n} ${unit}(s) after done`)
    : n === 1
      ? t(`每${unit === '个月' ? '月' : unit}`, `every ${unit}`)
      : t(`每 ${n} ${unit}`, `every ${n} ${unit}s`);
  // Counted from completion, the calendar's weekdays and month days do not apply.
  if (r.weekdays?.length && !r.from_done)
    s += ' ' + r.weekdays.map((d) => t(`周${CN_WEEK[d - 1]}`, EN_WEEK[d - 1])).join(t('、', ', '));
  if (r.month_day && !r.from_done)
    s += r.month_day === -1 ? t(' 最后一天', ', last day') : t(` ${r.month_day} 日`, `, day ${r.month_day}`);
  if (r.until) s += t(`，到 ${dayWords(r.until, t)}`, `, until ${dayWords(r.until, t)}`);
  if (r.count) s += t(`，共 ${r.count} 次`, `, ${r.count} times`);
  return s;
}

/**
 * What a change will do, in the owner's language, against the document as it is now.
 * A change whose task is gone says so, rather than failing.
 */
export function describeChange(doc: Doc, c: Change, t: T): string {
  if (c.type === 'add_task') {
    const group = (kind: 'areas' | 'projects', ref: string) =>
      Object.values(doc[kind]).find((g) => !g.deleted && g.id === ref)?.name ?? ref;
    const link = c.link_to && (doc.tasks[c.link_to]?.title ?? c.link_to);
    const p = c.plan;
    const parts = [
      c.due && t('截止：', 'deadline: ') + dayWords(c.due, t) + (c.due_time ? ' ' + c.due_time : ''),
      p &&
        t('安排：', 'plan: ') +
          dayWords(p.day, t) +
          (p.start ? ' ' + p.start : p.part ? ' ' + partWords(p.part, t) : ''),
      c.effort_minutes && t('用时：', 'effort: ') + minutesWords(c.effort_minutes, t),
      c.star && t('重要', 'important'),
      c.repeat &&
        t('重复：', 'repeat: ') +
          ruleWords(c.repeat.rule, t) +
          (c.repeat.mode === 'reopen'
            ? t('，原地重开', ', reopens in place')
            : t('，新建一份', ', a new copy each time')) +
          leadWords(c.repeat, t),
      c.area && t('区域：', 'area: ') + group('areas', c.area),
      c.project && t('项目：', 'project: ') + group('projects', c.project),
      link && t(`关联到「${link}」`, `linked to “${link}”`),
      c.steps?.length && t('步骤：', 'steps: ') + c.steps.join(t('、', ', ')),
      c.note && t(`备注（${c.note.length} 字）：`, `note (${c.note.length} chars): `) + noteGist(c.note),
    ].filter(Boolean);
    return (
      t(`新建 「${c.title}」`, `Add “${c.title}”`) + (parts.length ? t('：', ': ') + parts.join(t('；', '; ')) : '')
    );
  }
  if (c.type === 'update_project') {
    const p = Object.values(doc.projects).find((g) => !g.deleted && (g.id === c.project || g.name === c.project));
    const label = `「${p?.name ?? c.project}」`;
    const parts = [
      c.name && t(`改名为「${c.name}」`, `rename to “${c.name}”`),
      c.one_after_another !== undefined &&
        (c.one_after_another ? t('按顺序做', 'one task after another') : t('不再按顺序', 'not in order')),
    ].filter(Boolean);
    return t(`项目 ${label}：`, `Project ${label}: `) + parts.join(t('；', '; '));
  }
  if (c.type === 'rename_area') {
    const a = Object.values(doc.areas).find((g) => !g.deleted && (g.id === c.area || g.name === c.area));
    return t(`区域「${a?.name ?? c.area}」改名为「${c.name}」`, `Rename area “${a?.name ?? c.area}” to “${c.name}”`);
  }
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
            ? t(`备注改为（${c.note.length} 字）：`, `Note becomes (${c.note.length} chars): `) + noteGist(c.note)
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
      const forStep = c.step_id ? task.steps.find((s) => s.id === c.step_id) : undefined;
      const what = forStep ? t(`${name} 的步骤「${forStep.text}」`, `step “${forStep.text}” of ${name}`) : name;
      return t(
        `安排 ${what} 在 ${dayWords(c.day, t)} ${when}`,
        `Plan ${what} for ${dayWords(c.day, t)} ${when}`,
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
    case 'order_steps': {
      const texts = c.step_ids.map((id) => task.steps.find((s) => s.id === id)?.text ?? id);
      return (
        t(`调整 ${name} 的步骤顺序：`, `Reorder the steps of ${name}: `) + texts.map((x) => `「${x}」`).join(' → ')
      );
    }
    case 'edit_step':
    case 'remove_step':
    case 'promote_step': {
      const s = task.steps.find((x) => x.id === c.step_id && !x.deleted);
      const label = s ? `「${s.text}」` : c.step_id;
      if (c.type === 'remove_step') return t(`删除 ${name} 的步骤 ${label}`, `Remove step ${label} from ${name}`);
      if (c.type === 'promote_step')
        return t(`把 ${name} 的步骤 ${label} 独立成任务`, `Make step ${label} of ${name} its own task`);
      const parts: string[] = [];
      if (c.text !== undefined) parts.push(t('文字：', 'text: ') + arrow(s?.text, c.text));
      if (c.due !== undefined)
        parts.push(
          t('截止：', 'deadline: ') + arrow(s?.due && dayWords(s.due, t), c.due ? dayWords(c.due, t) : undefined),
        );
      if (c.effort_minutes !== undefined)
        parts.push(
          t('用时：', 'effort: ') +
            arrow(
              s?.effort ? minutesWords(s.effort, t) : undefined,
              c.effort_minutes ? minutesWords(c.effort_minutes, t) : undefined,
            ),
        );
      if (c.repeat !== undefined)
        parts.push(
          t('重复：', 'repeat: ') +
            (c.repeat === 'follow'
              ? t('跟随任务', 'follows the task')
              : c.repeat === 'none'
                ? t('不重复', 'does not repeat')
                : ruleWords(c.repeat, t)),
        );
      return t(`修改 ${name} 的步骤 ${label}：`, `Edit step ${label} of ${name}: `) + parts.join(t('；', '; '));
    }
    case 'move_plan': {
      const p = task.plan.find((x) => x.id === c.plan_id);
      const from = p
        ? `${dayWords(p.day, t)}${p.start ? ' ' + p.start : p.part ? ' ' + partWords(p.part, t) : ''}`
        : c.plan_id;
      const day = c.day ?? p?.day;
      const start = c.start === undefined ? p?.start : (c.start ?? undefined);
      const part = c.part === undefined ? p?.part : (c.part ?? undefined);
      const to = `${day ? dayWords(day, t) : ''}${start ? ' ' + start : part ? ' ' + partWords(part, t) : ''}${c.minutes ? t(`，${minutesWords(c.minutes, t)}`, `, ${minutesWords(c.minutes, t)}`) : ''}`;
      return t(`把 ${name} 的安排从 ${from} 改到 ${to}`, `Move ${name} from ${from} to ${to}`);
    }
    case 'link': {
      const target = c.to ? doc.tasks[c.to] : undefined;
      return c.to
        ? t(`把 ${name} 关联到「${target?.title ?? c.to}」`, `Link ${name} to “${target?.title ?? c.to}”`)
        : t(`取消 ${name} 的关联`, `Unlink ${name}`);
    }
    case 'set_repeat':
      return c.repeat
        ? t(
            `${name} 改为重复：${ruleWords(c.repeat.rule, t)}，${c.repeat.mode === 'reopen' ? '原地重开' : '新建一份'}`,
            `${name} repeats: ${ruleWords(c.repeat.rule, t)}, ${c.repeat.mode === 'reopen' ? 'reopens in place' : 'a new copy each time'}`,
          ) + leadWords(c.repeat, t)
        : t(`${name} 不再重复`, `${name} stops repeating`);
    case 'delete':
      return t(`删除 ${name}`, `Delete ${name}`);
  }
}
