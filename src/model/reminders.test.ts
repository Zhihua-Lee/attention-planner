import { describe, expect, it } from 'vitest';
import { addPlan, addTask, complete, emptyDoc, setSettings, stepsOf, updateStep } from './doc';
import { describeReminder, reminders } from './reminders';

const now = new Date(2026, 8, 29, 10, 0); // Tue 10:00
const ctx = { now, device: 'a' };
const at = (d: string, t: string) => new Date(`${d}T${t}:00`).getTime();

describe('reminders', () => {
  it('fire on a deadline day, an hour before a timed deadline, on a step deadline, and before reserved times', () => {
    let d = emptyDoc(ctx);
    let a: string, b: string, c: string;
    [d, a] = addTask(d, ctx, { title: 'Report', due: '2026-10-02', steps: ['Figure'] });
    [d, b] = addTask(d, ctx, { title: 'Form', due: '2026-09-30', dueTime: '17:00' });
    [d, c] = addTask(d, ctx, { title: 'Write', plan: [{ day: '2026-09-29', start: '15:00', minutes: 60 }] });
    d = updateStep(d, ctx, a, stepsOf(d.tasks[a])[0].id, { due: '2026-09-30' });
    const list = reminders(d, now);
    expect(list.map((r) => [describeReminder(d, r.id)?.task.title, describeReminder(d, r.id)?.kind, r.fireAt])).toEqual(
      [
        ['Write', 'slot', at('2026-09-29', '14:55')],
        ['Report', 'step-due', at('2026-09-30', '09:00')],
        ['Form', 'due', at('2026-09-30', '16:00')],
        ['Report', 'due', at('2026-10-02', '09:00')],
      ],
    );
    expect(list.every((r) => /^[A-Za-z0-9_-]{16,64}$/.test(r.id))).toBe(true);
    void b;
    void c;
  });
  it('follow the settings, skip finished work, past times and anything beyond two weeks', () => {
    let d = emptyDoc(ctx);
    let a: string;
    [d, a] = addTask(d, ctx, { title: 'Done', due: '2026-09-30' });
    d = complete(d, ctx, a);
    [d] = addTask(d, ctx, { title: 'Past', due: '2026-09-29' });
    [d] = addTask(d, ctx, { title: 'Far', due: '2026-11-30' });
    let w: string;
    [d, w] = addTask(d, ctx, { title: 'Soon' });
    d = addPlan(d, ctx, w, { day: '2026-09-30', start: '08:00', minutes: 30 });
    d = setSettings(d, ctx, { remind: { dueAt: '07:30', slotLead: 15 } });
    expect(reminders(d, now).map((r) => r.fireAt)).toEqual([at('2026-09-30', '07:45')]);
  });
});
