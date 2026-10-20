import { describe, expect, it } from 'vitest';
import {
  addPlan,
  addStep,
  addTask,
  complete,
  emptyDoc,
  restore,
  setField,
  toggleStep,
  updatePlan,
  type Ctx,
} from './doc';
import { historyOf, LOG_LIMIT, logChanges, mergeLog, voidSince, type LogEntry } from './history';
import { mergeDocs } from './merge';
import type { Doc } from './types';

// Tuesday 2026-09-29, 21:05 local
const T0 = new Date(2026, 8, 29, 21, 5);
const ctx = (now = T0, device = 'a'): Ctx => ({ now, device });
/** A change as the store commits it: applied, then noted in the history. */
const run = (d: Doc, fn: (d: Doc, c: Ctx) => Doc, c = ctx(), ai?: string) => logChanges(d, fn(d, c), c, ai);
const kinds = (d: Doc, id: string) => historyOf(d.tasks[id]).map((x) => x.kind);

function withSteps(): [Doc, string, string] {
  const [d0, id] = addTask(emptyDoc(ctx()), ctx(), { title: 'Wash up', steps: ['Plates', 'Pans'] });
  return [d0, id, d0.tasks[id].steps[0].id];
}

describe('history', () => {
  it('records a check with what was planned that day and the deadline then', () => {
    let [d, id, step] = withSteps();
    d = setField(d, ctx(), id, 'due', '2026-10-01');
    d = addPlan(d, ctx(), id, { day: '2026-09-29', part: 'eve' });
    d = run(d, (x, c) => toggleStep(x, c, id, step, true));
    const [e] = historyOf(d.tasks[id]);
    expect(e).toMatchObject({
      kind: 'check',
      step: { id: step, text: 'Plates' },
      planned: 'eve',
      dueThen: '2026-10-01',
      by: 'a',
      at: T0.toISOString(),
    });
  });

  it('a new task starts with no history; creating it is not an entry', () => {
    const d = run(emptyDoc(ctx()), (x, c) => addTask(x, c, { title: 'New', due: '2026-10-02' })[0]);
    const t = Object.values(d.tasks)[0];
    expect(t.log).toBeUndefined();
  });

  it('records done, reopen, deadline, plans and snoozing', () => {
    let [d, id] = withSteps();
    let minute = 0;
    const later = () => ctx(new Date(T0.getTime() + ++minute * 60e3));
    d = run(d, (x, c) => setField(x, c, id, 'due', '2026-10-03'), later());
    d = run(d, (x, c) => addPlan(x, c, id, { day: '2026-09-30', start: '19:00', minutes: 40 }), later());
    const plan = d.tasks[id].plan[0].id;
    d = run(d, (x, c) => updatePlan(x, c, id, plan, { day: '2026-10-01' }), later());
    d = run(d, (x, c) => updatePlan(x, c, id, plan, { doneMin: 30 }), later());
    d = run(d, (x, c) => setField(x, c, id, 'snooze', { until: '2026-10-05', reason: 'waiting' }), later());
    d = run(d, (x, c) => complete(x, c, id), later());
    expect(kinds(d, id).reverse()).toEqual(['due', 'plan', 'move', 'worked', 'snooze', 'done']);
    const log = d.tasks[id].log!;
    expect(log[2]).toMatchObject({ kind: 'move', day: '2026-10-01', from: '2026-09-30', start: '19:00' });
    expect(log[3]).toMatchObject({ kind: 'worked', minutes: 30 });
    expect(log[4]).toMatchObject({ until: '2026-10-05', reason: 'waiting' });
  });

  it('finishing a round is one entry, not one per step', () => {
    let [d, id] = addTask(emptyDoc(ctx()), ctx(), {
      title: 'Laundry',
      steps: ['Wash', 'Dry'],
      repeat: { mode: 'reopen', rule: { freq: 'weekly', every: 1, fromDone: false, start: '2026-09-28' } },
    });
    d = run(d, (x, c) => complete(x, c, id));
    expect(kinds(d, id)).toEqual(['done']);
    expect(historyOf(d.tasks[id])).toHaveLength(1); // the round itself is not listed twice
  });

  it('names the AI whose proposal it applied', () => {
    let [d, id] = withSteps();
    d = run(d, (x, c) => complete(x, c, id), ctx(), 'Claude');
    expect(historyOf(d.tasks[id])[0]).toMatchObject({ kind: 'done', ai: 'Claude' });
  });

  it('undo voids the entries it took back, and the void reaches other devices', () => {
    let [d, id, step] = withSteps();
    const before = d;
    d = run(d, (x, c) => toggleStep(x, c, id, step, true));
    const other = d; // another device synced the check
    d = voidSince(restore(d, before, ctx()), before, 'a');
    expect(historyOf(d.tasks[id])).toEqual([]);
    expect(historyOf(mergeDocs(other, d).tasks[id])).toEqual([]);
    expect(historyOf(mergeDocs(d, other).tasks[id])).toEqual([]);
  });

  it('two devices keep both histories', () => {
    const [d0, id, step] = withSteps();
    const a = run(d0, (x, c) => toggleStep(x, c, id, step, true), ctx(T0, 'a'));
    const b = run(d0, (x, c) => addStep(x, c, id, 'Cups'), ctx(T0, 'b'));
    const b2 = run(b, (x, c) => setField(x, c, id, 'due', '2026-10-09'), ctx(T0, 'b'));
    const ab = mergeDocs(a, b2);
    expect(ab.tasks[id].log).toEqual(mergeDocs(b2, a).tasks[id].log);
    expect(kinds(ab, id).sort()).toEqual(['check', 'due']);
  });

  it('keeps the newest entries when there are too many', () => {
    const entry = (i: number): LogEntry => ({
      id: `e${String(i).padStart(4, '0')}`,
      at: new Date(2026, 0, 1, 0, i).toISOString(),
      by: 'a',
      kind: 'done',
    });
    const a = Array.from({ length: LOG_LIMIT }, (_, i) => entry(i));
    const b = Array.from({ length: 10 }, (_, i) => entry(LOG_LIMIT + i));
    const m = mergeLog(a, b)!;
    expect(m).toHaveLength(LOG_LIMIT);
    expect(m.at(-1)!.id).toBe(entry(LOG_LIMIT + 9).id);
    expect(m[0].id).toBe(entry(10).id);
  });

  it('shows rounds and a completion from before history was kept', () => {
    let [d, id] = addTask(emptyDoc(ctx()), ctx(), { title: 'Old' });
    d = complete(d, ctx(), id); // not through the store: no entry
    expect(historyOf(d.tasks[id])).toMatchObject([{ kind: 'done', at: T0.toISOString() }]);
  });
});
