import { addDays, dayOf, toDate } from './dates';
import { isFinished, liveTasks, planOf, stepDone, stepsOf } from './doc';
import type { Doc, Settings, Task, Time } from './types';

/** When reminders go off: on a deadline's day (or an hour before a deadline with a time), and before reserved times. */
export type ReminderPrefs = { dueAt: Time; slotLead: number };
export const DEFAULT_REMINDERS: ReminderPrefs = { dueAt: '09:00', slotLead: 5 };
export const reminderPrefs = (s: Settings): ReminderPrefs => ({ ...DEFAULT_REMINDERS, ...(s.remind ?? {}) });

/** An id the push service accepts and that the service worker can map back to a task (letters, digits, - and _). */
export type Reminder = { id: string; fireAt: number };
export type ReminderInfo = { taskId: string; kind: 'due' | 'step-due' | 'slot'; step?: string; start?: Time };

const HORIZON_DAYS = 14;
const MAX = 700;
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 56);

/** What the reminder id points at, so a notification can name the task without the server knowing it. */
export function describeReminder(doc: Doc, id: string): (ReminderInfo & { task: Task }) | undefined {
  const [kind, ref] = [id.slice(0, 2), id.slice(2)];
  for (const task of liveTasks(doc)) {
    if (kind === 'd-' && safe(task.id) === ref) return { task, taskId: task.id, kind: 'due' };
    for (const s of stepsOf(task))
      if (kind === 'p-' && safe(s.id) === ref) return { task, taskId: task.id, kind: 'step-due', step: s.text };
    for (const p of planOf(task))
      if (kind === 's-' && safe(p.id) === ref) return { task, taskId: task.id, kind: 'slot', start: p.start };
  }
  return undefined;
}

/** The reminders for the next two weeks; finished work and passed times are left out. */
export function reminders(doc: Doc, now: Date): Reminder[] {
  const prefs = reminderPrefs(doc.settings);
  const until = toDate(addDays(dayOf(now), HORIZON_DAYS)).getTime();
  const out: Reminder[] = [];
  const add = (id: string, at: Date) => {
    const t = at.getTime();
    if (t > now.getTime() && t < until) out.push({ id, fireAt: t });
  };
  for (const task of liveTasks(doc)) {
    if (isFinished(task, now)) continue;
    if (task.due)
      add(
        `d-${safe(task.id)}`,
        task.dueTime ? new Date(toDate(task.due, task.dueTime).getTime() - 60 * 60e3) : toDate(task.due, prefs.dueAt),
      );
    for (const s of stepsOf(task))
      if (s.due && !stepDone(task, s, now)) add(`p-${safe(s.id)}`, toDate(s.due, prefs.dueAt));
    for (const p of planOf(task))
      if (p.start) add(`s-${safe(p.id)}`, new Date(toDate(p.day, p.start).getTime() - prefs.slotLead * 60e3));
  }
  return out
    .filter((r) => r.id.length >= 16)
    .sort((a, b) => a.fireAt - b.fireAt)
    .slice(0, MAX);
}
