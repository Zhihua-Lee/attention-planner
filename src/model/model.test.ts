import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import {
  addPlan,
  addStep,
  addTask,
  complete,
  emptyDoc,
  isFinished,
  liveTasks,
  moveStep,
  restore,
  setField,
  stepDone,
  stepsOf,
  taskRound,
  toggleStep,
  updateStep,
  uncomplete,
  type Ctx,
} from './doc';
import { capacity, freeMinutes, listTasks, nowCandidates } from './derive';
import { mergeDocs, purgeTombstones, stable } from './merge';
import { addInterval, nextCopyDay, nextOccurrence, occursOn, roundOf } from './repeat';
import type { Doc, RepeatRule } from './types';

// Tuesday 2026-09-29, 10:00 local
const T0 = new Date(2026, 8, 29, 10, 0);
const at = (day: string, time = '10:00') => new Date(`${day}T${time}:00`);
const ctx = (now = T0, device = 'a'): Ctx => ({ now, device });
const make = (title = 'x', extra = {}): [Doc, string] => addTask(emptyDoc(ctx()), ctx(), { title, ...extra });

describe('repeat rules', () => {
  const weekly: RepeatRule = { freq: 'weekly', every: 1, fromDone: false, weekdays: [2, 4], start: '2026-09-28' };
  it('finds weekly occurrences on the chosen weekdays', () => {
    expect(occursOn(weekly, '2026-09-29')).toBe(true);
    expect(occursOn(weekly, '2026-09-30')).toBe(false);
    expect(nextOccurrence(weekly, '2026-09-29')).toBe('2026-10-01');
  });
  it('honours every-n-weeks counted from the start week', () => {
    const fortnight = { ...weekly, every: 2 };
    expect(occursOn(fortnight, '2026-10-06')).toBe(false);
    expect(occursOn(fortnight, '2026-10-13')).toBe(true);
  });
  it('skips missing month days but supports the last day', () => {
    const on31: RepeatRule = { freq: 'monthly', every: 1, fromDone: false, start: '2026-01-31' };
    expect(nextOccurrence(on31, '2026-01-31')).toBe('2026-03-31');
    expect(nextOccurrence({ ...on31, monthDay: -1 }, '2026-01-31')).toBe('2026-02-28');
  });
  it('stops at until', () => {
    expect(nextOccurrence({ ...weekly, until: '2026-09-30' }, '2026-09-29')).toBeUndefined();
  });
  it('adds after-completion intervals with month clamping', () => {
    expect(addInterval(new Date(2026, 0, 31), { freq: 'monthly', every: 1 }).getDate()).toBe(28);
    expect(addInterval(new Date(2026, 0, 1, 10), { freq: 'hourly', every: 3 }).getHours()).toBe(13);
  });
  it('keys calendar rounds by day and respects the opening time', () => {
    const r = { ...weekly, time: '12:00' };
    expect(roundOf(r, undefined, at('2026-09-29', '11:00'))).toBeNull(); // first round opens at noon
    expect(roundOf(r, undefined, at('2026-09-29', '12:30'))?.key).toBe('2026-09-29');
    expect(roundOf(r, undefined, at('2026-09-30', '09:00'))?.key).toBe('2026-09-29');
  });
  it('opens an after-completion round one interval after the last check', () => {
    const r: RepeatRule = { freq: 'daily', every: 2, fromDone: true, start: '2026-09-01' };
    const last = { key: 'start', doneAt: at('2026-09-29').toISOString() };
    expect(roundOf(r, last, at('2026-09-30'))?.done).toBe(true);
    const opened = roundOf(r, last, at('2026-10-01', '10:01'));
    expect(opened?.done).toBe(false);
    expect(opened?.key.startsWith('t:')).toBe(true);
  });
  it('ends a copy series by count or until', () => {
    const r: RepeatRule = { freq: 'daily', every: 1, fromDone: false, start: '2026-09-01' };
    expect(nextCopyDay({ ...r, count: 1 }, '2026-09-29', T0)).toBeUndefined();
    expect(nextCopyDay({ ...r, count: 2 }, '2026-09-29', T0)).toBe('2026-09-30');
    expect(nextCopyDay({ ...r, until: '2026-09-29' }, '2026-09-29', T0)).toBeUndefined();
  });
});

describe('tasks', () => {
  it('stamps every field and keeps a monotonic clock', () => {
    const [d1, id] = make('Write report', { due: '2026-10-02', star: true });
    const d2 = setField(d1, ctx(), id, 'title', 'Write the report');
    expect(d2.clock).toBe(d1.clock + 1);
    expect(d2.tasks[id].fs.title.rev).toBe(d2.clock);
    expect(d2.tasks[id].fs.due.rev).toBe(d1.clock);
  });
  it('a reopening task finishes its round when the last step is checked, then reopens next round', () => {
    const rule: RepeatRule = { freq: 'weekly', every: 1, fromDone: false, weekdays: [2, 4], start: '2026-09-28' };
    let [d, id] = make('1560 prep', { repeat: { mode: 'reopen', rule } });
    d = addStep(d, ctx(), id, 'Slides');
    d = addStep(d, ctx(), id, 'Quiz');
    const [s1, s2] = stepsOf(d.tasks[id]);
    d = toggleStep(d, ctx(), id, s1.id, true);
    expect(isFinished(d.tasks[id], T0)).toBe(false);
    d = toggleStep(d, ctx(), id, s2.id, true);
    expect(isFinished(d.tasks[id], T0)).toBe(true);
    const thursday = at('2026-10-01', '08:00');
    expect(isFinished(d.tasks[id], thursday)).toBe(false);
    expect(stepDone(d.tasks[id], s1, thursday)).toBe(false);
    expect(taskRound(d.tasks[id], thursday)?.key).toBe('2026-10-01');
  });
  it('a round is not finished while a one-off or own-rule step is still open', () => {
    const rule: RepeatRule = { freq: 'weekly', every: 1, fromDone: false, weekdays: [2], start: '2026-09-29' };
    let [d, id] = make('TA list', { repeat: { mode: 'reopen', rule } });
    d = addStep(d, ctx(), id, 'Grade');
    d = addStep(d, ctx(), id, 'Order books');
    d = addStep(d, ctx(), id, 'Weekly email');
    const [follow, once, own] = stepsOf(d.tasks[id]);
    d = updateStep(d, ctx(), id, once.id, { repeat: 'none' });
    d = updateStep(d, ctx(), id, own.id, { repeat: { ...rule } });
    d = toggleStep(d, ctx(), id, follow.id, true);
    expect(isFinished(d.tasks[id], T0)).toBe(false);
    d = toggleStep(d, ctx(), id, once.id, true);
    expect(isFinished(d.tasks[id], T0)).toBe(false);
    d = toggleStep(d, ctx(), id, own.id, true);
    expect(isFinished(d.tasks[id], T0)).toBe(true);
  });
  it('unchecking a step reopens a finished round', () => {
    const rule: RepeatRule = { freq: 'daily', every: 1, fromDone: false, start: '2026-09-28' };
    let [d, id] = make('Daily', { repeat: { mode: 'reopen', rule } });
    d = addStep(d, ctx(), id, 'One');
    const [s] = stepsOf(d.tasks[id]);
    d = toggleStep(d, ctx(), id, s.id, true);
    expect(isFinished(d.tasks[id], T0)).toBe(true);
    d = toggleStep(d, ctx(), id, s.id, false);
    expect(isFinished(d.tasks[id], T0)).toBe(false);
  });
  it('a "new copy" task creates the next copy with shifted dates and reset steps', () => {
    const rule: RepeatRule = { freq: 'weekly', every: 1, fromDone: false, start: '2026-09-29', count: 3 };
    let [d, id] = make('Laundry', {
      repeat: { mode: 'copy', rule },
      due: '2026-09-29',
      plan: [{ day: '2026-09-29', part: 'eve' }],
      steps: ['Wash'],
    });
    d = toggleStep(d, ctx(), id, stepsOf(d.tasks[id])[0].id, true);
    d = complete(d, ctx(), id);
    const copies = liveTasks(d).filter((t) => t.id !== id);
    expect(d.tasks[id].done).toBeTruthy();
    expect(copies).toHaveLength(1);
    expect(copies[0].due).toBe('2026-10-06');
    expect(copies[0].plan[0]).toMatchObject({ day: '2026-10-06', part: 'eve' });
    expect(copies[0].steps[0].done).toBeUndefined();
    expect(copies[0].repeat?.rule.count).toBe(2);
  });
  it('uncomplete reopens a done task', () => {
    let [d, id] = make();
    d = complete(d, ctx(), id);
    d = uncomplete(d, ctx(), id);
    expect(d.tasks[id].done).toBeUndefined();
  });
  it('moves steps up and down', () => {
    let [d, id] = make('t', { steps: ['a', 'b', 'c'] });
    const [, b] = stepsOf(d.tasks[id]);
    d = moveStep(d, ctx(), id, b.id, -1);
    expect(stepsOf(d.tasks[id]).map((s) => s.text)).toEqual(['b', 'a', 'c']);
  });
  it('undo writes the earlier values back as new edits', () => {
    const [d1, id] = make('Before');
    const d2 = setField(d1, ctx(), id, 'title', 'After');
    const [d3, id2] = addTask(d2, ctx(), { title: 'Added later' });
    const back = restore(d3, d1, ctx());
    expect(back.tasks[id].title).toBe('Before');
    expect(back.tasks[id].fs.title.rev).toBe(back.clock);
    expect(back.tasks[id2].deleted).toBe(true);
  });
});

describe('now and planning', () => {
  it('orders candidates: reserved time now, part of day, overdue, due today, planned today, starred, oldest', () => {
    let d = emptyDoc(ctx());
    const add = (title: string, extra = {}) => ([d] = addTask(d, ctx(), { title, ...extra }));
    add('oldest');
    add('starred', { star: true });
    add('planned', { plan: [{ day: '2026-09-29' }] });
    add('due today', { due: '2026-09-29' });
    add('overdue', { due: '2026-09-27' });
    add('morning', { plan: [{ day: '2026-09-29', part: 'am' }] });
    add('slot', { plan: [{ day: '2026-09-29', start: '09:30', minutes: 60 }] });
    add('snoozed', { star: true, snooze: { until: '2026-10-05' } });
    const order = nowCandidates(d, T0).map((p) => p.task.title);
    expect(order).toEqual(['slot', 'morning', 'overdue', 'due today', 'planned', 'starred', 'oldest']);
    expect(nowCandidates(d, T0)[0].reason).toEqual({ kind: 'slot', until: '10:30' });
  });
  it('counts free working time around events and reserved time', () => {
    let [d] = make('x', { plan: [{ day: '2026-09-29', start: '13:00', minutes: 60 }] });
    d = { ...d, events: [{ id: 'e', title: 'Class', day: '2026-09-29', start: '09:00', end: '10:30' }] };
    expect(freeMinutes(d, d.settings, '2026-09-29')).toBe(9 * 60 - 90 - 60);
    expect(freeMinutes(d, d.settings, '2026-10-03')).toBe(0); // Saturday
  });
  it('warns when the effort due by a deadline exceeds the free time before it', () => {
    let [d] = make('Report', { due: '2026-09-30', effort: 20 * 60 });
    expect(capacity(d, T0)).toMatchObject({ missing: expect.any(Number) });
    [d] = make('Small', { due: '2026-09-30', effort: 60 });
    expect(capacity(d, T0)).toBeNull();
  });
  it('lists a linked task right after its target', () => {
    let d = emptyDoc(ctx());
    let parent: string;
    [d, parent] = addTask(d, ctx(), { title: 'Paper' });
    [d] = addTask(d, ctx(), { title: 'Unrelated', star: true });
    [d] = addTask(d, ctx(), { title: 'Figure 3', linkTo: parent });
    expect(listTasks(d, T0, 'all').map((t) => t.title)).toEqual(['Unrelated', 'Paper', 'Figure 3']);
  });
  it('a planned day can carry several entries', () => {
    let [d, id] = make('Report');
    d = addPlan(d, ctx(), id, { day: '2026-09-29', start: '15:00', minutes: 120 });
    d = addPlan(d, ctx(), id, { day: addDays('2026-09-29', 2), part: 'am' });
    expect(d.tasks[id].plan).toHaveLength(2);
  });
});

describe('sync merge', () => {
  it('keeps concurrent edits to different fields', () => {
    const [base, id] = make('Report');
    const a = setField(base, ctx(T0, 'a'), id, 'title', 'Report v2');
    const b = setField(base, ctx(T0, 'b'), id, 'due', '2026-10-02');
    const ab = mergeDocs(a, b);
    const ba = mergeDocs(b, a);
    expect(ab.tasks[id]).toMatchObject({ title: 'Report v2', due: '2026-10-02' });
    expect(stable(ab.tasks)).toBe(stable(ba.tasks));
  });
  it('merges steps and arrangements record by record', () => {
    const [base, id] = make('Report');
    const a = addStep(base, ctx(T0, 'a'), id, 'From A');
    const b = addPlan(base, ctx(T0, 'b'), id, { day: '2026-09-30' });
    const m = mergeDocs(a, b);
    expect(m.tasks[id].steps).toHaveLength(1);
    expect(m.tasks[id].plan).toHaveLength(1);
    expect(mergeDocs(m, m)).toEqual(m);
  });
  it('a later delete wins and old tombstones are purged', () => {
    const [base, id] = make('Gone');
    const del = {
      ...base,
      clock: base.clock + 1,
      tasks: {
        [id]: {
          ...base.tasks[id],
          deleted: true,
          fs: { ...base.tasks[id].fs, deleted: { rev: base.clock + 1, at: '2026-01-01T00:00:00.000Z', by: 'b' } },
        },
      },
    };
    const m = mergeDocs(base, del);
    expect(m.tasks[id].deleted).toBe(true);
    const purged = purgeTombstones(
      { ...m, tasks: { [id]: { ...m.tasks[id], s: { rev: 9, at: '2026-01-01T00:00:00.000Z', by: 'b' } } } },
      T0,
    );
    expect(purged.tasks[id]).toBeUndefined();
  });
});

describe('steps with their own deadline, estimate and repeat', () => {
  it('the earliest deadline of an unfinished step leads, and NOW names the step', async () => {
    const { effectiveDue, updateStep } = await import('./doc');
    let [d, id] = make('Report', { due: '2026-10-02', steps: ['Draw figure', 'Write'] });
    const [draw] = stepsOf(d.tasks[id]);
    d = updateStep(d, ctx(), id, draw.id, { due: '2026-09-29' });
    expect(effectiveDue(d.tasks[id], T0)).toMatchObject({ day: '2026-09-29', step: { text: 'Draw figure' } });
    expect(nowCandidates(d, T0)[0].reason).toEqual({ kind: 'dueToday', step: 'Draw figure' });
    d = toggleStep(d, ctx(), id, draw.id, true);
    expect(effectiveDue(d.tasks[id], T0)).toEqual({ day: '2026-10-02' });
  });
  it('step estimates add up, and what is left counts only unfinished steps', async () => {
    const { taskEffort, remainingEffort, updateStep } = await import('./doc');
    let [d, id] = make('Report', { steps: ['A', 'B'] });
    const [a, b] = stepsOf(d.tasks[id]);
    d = updateStep(d, ctx(), id, a.id, { effort: 60 });
    d = updateStep(d, ctx(), id, b.id, { effort: 90 });
    expect(taskEffort(d.tasks[id])).toBe(150);
    d = toggleStep(d, ctx(), id, a.id, true);
    expect(remainingEffort(d.tasks[id], T0)).toBe(90);
    d = updateStep(d, ctx(), id, b.id, { effort: undefined });
    expect(stepsOf(d.tasks[id])[1].effort).toBeUndefined();
  });
  it('a step becomes its own task, linked to the old one, keeping its deadline', async () => {
    const { promoteStep, updateStep } = await import('./doc');
    let [d, id] = make('Paper', { steps: ['Redraw figure 3'] });
    const [step] = stepsOf(d.tasks[id]);
    d = updateStep(d, ctx(), id, step.id, { due: '2026-09-30' });
    const [next, newId] = promoteStep(d, ctx(), id, step.id);
    expect(next.tasks[newId]).toMatchObject({ title: 'Redraw figure 3', linkTo: id, due: '2026-09-30' });
    expect(stepsOf(next.tasks[id])).toHaveLength(0);
  });
  it('steps take a dragged order', async () => {
    const { reorderSteps } = await import('./doc');
    let [d, id] = make('t', { steps: ['a', 'b', 'c'] });
    const ids = stepsOf(d.tasks[id]).map((s) => s.id);
    d = reorderSteps(d, ctx(), id, [ids[2], ids[0], ids[1]]);
    expect(stepsOf(d.tasks[id]).map((s) => s.text)).toEqual(['c', 'a', 'b']);
  });
  it('a step with its own rule clears itself in a task that does not repeat', async () => {
    const { updateStep } = await import('./doc');
    let [d, id] = make('Inbox zero', { steps: ['Check mail'] });
    const [s] = stepsOf(d.tasks[id]);
    d = updateStep(d, ctx(), id, s.id, { repeat: { freq: 'daily', every: 1, fromDone: false, start: '2026-09-28' } });
    d = toggleStep(d, ctx(), id, s.id, true);
    expect(stepDone(d.tasks[id], stepsOf(d.tasks[id])[0], T0)).toBe(true);
    expect(stepDone(d.tasks[id], stepsOf(d.tasks[id])[0], at('2026-09-30'))).toBe(false);
  });
});

describe('projects done in order', () => {
  it('only the first unfinished task is suggested; the next one moves up when it is done', async () => {
    const { addProject, updateProject } = await import('./doc');
    const { queuePosition } = await import('./derive');
    let d = emptyDoc(ctx());
    let p: string, a: string, b: string;
    [d, p] = addProject(d, ctx(), 'Paper');
    d = updateProject(d, ctx(), p, { sequential: true });
    [d, a] = addTask(d, ctx(new Date(2026, 8, 29, 9)), { title: 'Collect data', projectId: p });
    [d, b] = addTask(d, ctx(new Date(2026, 8, 29, 9, 30)), { title: 'Analyse', projectId: p, star: true });
    expect(queuePosition(d, d.tasks[b], T0)).toBe(1);
    expect(nowCandidates(d, T0).map((c) => c.task.title)).toEqual(['Collect data']);
    d = complete(d, ctx(), a);
    expect(queuePosition(d, d.tasks[b], T0)).toBe(0);
    expect(nowCandidates(d, T0)[0].task.title).toBe('Analyse');
  });
});

describe('today and the hand-sorted list', () => {
  it('today includes overdue, planned, an open round and a step due on its own rule', async () => {
    const { isToday, listTasks } = await import('./derive');
    const { setSettings, reorderTasks } = await import('./doc');
    let d = emptyDoc(ctx());
    const add = (title: string, extra = {}) => ([d] = addTask(d, ctx(), { title, ...extra }));
    add('late', { due: '2026-09-28' });
    add('planned', { plan: [{ day: '2026-09-29' }] });
    add('daily', {
      repeat: { mode: 'reopen', rule: { freq: 'daily', every: 1, fromDone: false, start: '2026-09-01' } },
    });
    add('later', { due: '2026-10-20' });
    add('waiting', { due: '2026-09-29', snooze: { until: '2026-10-05' } });
    const today = liveTasks(d)
      .filter((t) => isToday(t, T0))
      .map((t) => t.title)
      .sort();
    expect(today).toEqual(['daily', 'late', 'planned']);
    const ids = listTasks(d, T0, 'all').map((t) => t.id);
    d = setSettings(d, ctx(), { listSort: 'manual' });
    d = reorderTasks(d, ctx(), ids.slice().reverse());
    expect(listTasks(d, T0, 'all').map((t) => t.id)).toEqual(ids.slice().reverse());
  });
});

describe('calendar events by source', () => {
  it('Outlook replaces events saved before sources were recorded, keeps other sources, and nothing shows twice', async () => {
    const { replaceEvents, eventsOn } = await import('./derive');
    const ev = (id: string, title: string, start: string, source?: string) => ({
      id,
      title,
      day: '2026-09-28',
      start,
      end: '10:00',
      ...(source ? { source } : {}),
    });
    const old = [ev('a@2026-09-28', 'TA Meeting', '09:30'), ev('b@2026-09-28', 'Research', '08:00')];
    const kept = [ev('s@2026-09-28', 'Seminar', '09:00', 'sub:x'), ev('f@2026-09-28', 'Imported', '07:00', 'file')];
    const fresh = [ev('a@2026-09-28', 'TA Meeting', '09:30'), ev('b@2026-09-28', 'Research', '08:00')];
    const next = replaceEvents([...old, ...kept], 'outlook', fresh);
    expect(next.map((e) => `${e.title}:${e.source}`).sort()).toEqual([
      'Imported:file',
      'Research:outlook',
      'Seminar:sub:x',
      'TA Meeting:outlook',
    ]);
    // The same meeting from the Outlook export and a subscription to that calendar is listed once.
    const doc = { ...emptyDoc(ctx()), events: [...next, ev('dup', 'TA Meeting', '09:30', 'sub:y')] };
    expect(eventsOn(doc, '2026-09-28').map((e) => e.title)).toEqual(['Imported', 'Research', 'Seminar', 'TA Meeting']);
  });
});
