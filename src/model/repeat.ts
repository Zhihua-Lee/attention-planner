import { addDays, dayOf, daysInMonth, diffDays, isoWeekday, minutesOf, nowMinutes, toDate, weekStart } from './dates';
import type { Day, RepeatRule } from './types';

const LIMIT = 3700; // about ten years of days; keeps every search bounded

function parts(day: Day) {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m, d };
}

/** Whether a calendar rule has an occurrence on `day` (ignores `until`). */
export function occursOn(rule: RepeatRule, day: Day): boolean {
  if (day < rule.start) return false;
  const every = Math.max(1, rule.every);
  switch (rule.freq) {
    case 'hourly':
    case 'daily':
      return diffDays(day, rule.start) % every === 0;
    case 'weekly': {
      const weeks = diffDays(weekStart(day), weekStart(rule.start)) / 7;
      const days = rule.weekdays?.length ? rule.weekdays : [isoWeekday(rule.start)];
      return weeks % every === 0 && days.includes(isoWeekday(day));
    }
    case 'monthly': {
      const a = parts(day);
      const s = parts(rule.start);
      const months = (a.y - s.y) * 12 + (a.m - s.m);
      if (months % every !== 0) return false;
      const want = rule.monthDay ?? s.d;
      return want === -1 ? a.d === daysInMonth(a.y, a.m) : a.d === want;
    }
    case 'yearly': {
      const a = parts(day);
      const s = parts(rule.start);
      return (a.y - s.y) % every === 0 && a.m === s.m && a.d === s.d;
    }
  }
}

/** First occurrence strictly after `day` (or on it when `inclusive`), within `until`. */
export function nextOccurrence(rule: RepeatRule, day: Day, inclusive = false): Day | undefined {
  let d = day < rule.start ? rule.start : inclusive ? day : addDays(day, 1);
  for (let i = 0; i < LIMIT; i++, d = addDays(d, 1)) {
    if (rule.until && d > rule.until) return undefined;
    if (occursOn(rule, d)) return d;
  }
  return undefined;
}

/** Latest occurrence on or before `day`, within `until`. */
export function latestOccurrence(rule: RepeatRule, day: Day): Day | undefined {
  let d = rule.until && rule.until < day ? rule.until : day;
  for (let i = 0; i < LIMIT && d >= rule.start; i++, d = addDays(d, -1)) if (occursOn(rule, d)) return d;
  return undefined;
}

/** `from` plus one interval of an after-completion rule. Months clamp to the end of a shorter month. */
export function addInterval(from: Date, rule: Pick<RepeatRule, 'freq' | 'every'>): Date {
  const n = Math.max(1, rule.every);
  const d = new Date(from);
  if (rule.freq === 'hourly') d.setTime(d.getTime() + n * 3600e3);
  else if (rule.freq === 'daily') d.setDate(d.getDate() + n);
  else if (rule.freq === 'weekly') d.setDate(d.getDate() + 7 * n);
  else {
    const months = rule.freq === 'monthly' ? n : 12 * n;
    const want = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    d.setDate(Math.min(want, daysInMonth(d.getFullYear(), d.getMonth() + 1)));
  }
  return d;
}

export type RoundState = {
  /** Stable key of the current round. */
  key: string;
  opensAt: Date;
  done: boolean;
  /** When the following round opens, if any. */
  nextAt?: Date;
};

/**
 * The current round of a rule, given the last finished round.
 * Returns `null` before the first round opens.
 * Calendar rules key rounds by their day; after-completion rules open a new round one interval after the last check.
 */
export function roundOf(
  rule: RepeatRule,
  last: { key: string; doneAt: string } | undefined,
  now: Date,
  paused = false,
): RoundState | null {
  const time = rule.time ?? '00:00';
  if (!rule.fromDone) {
    const today = dayOf(now);
    let day = latestOccurrence(rule, today);
    if (day === today && nowMinutes(now) < minutesOf(time)) day = latestOccurrence(rule, addDays(today, -1));
    if (paused && last) day = last.key; // a paused rule stays on its last finished round
    if (!day) return null;
    const next = nextOccurrence(rule, day);
    return {
      key: day,
      opensAt: toDate(day, time),
      done: last?.key === day,
      nextAt: next ? toDate(next, time) : undefined,
    };
  }
  const first = toDate(rule.start, time);
  if (!last) return now < first ? null : { key: 'start', opensAt: first, done: false };
  const nextAt = addInterval(new Date(last.doneAt), rule);
  const ended = rule.until !== undefined && dayOf(nextAt) > rule.until;
  if (paused || ended || now < nextAt) {
    return { key: last.key, opensAt: new Date(last.doneAt), done: true, nextAt: paused || ended ? undefined : nextAt };
  }
  return { key: `t:${nextAt.toISOString()}`, opensAt: nextAt, done: false };
}

/** The day the next copy of a "new copy" task is anchored to, or undefined when the series ends. */
export function nextCopyDay(rule: RepeatRule, anchor: Day, completedAt: Date): Day | undefined {
  if (rule.count !== undefined && rule.count <= 1) return undefined;
  const day = rule.fromDone ? dayOf(addInterval(completedAt, rule)) : nextOccurrence(rule, anchor);
  if (!day || (rule.until && day > rule.until)) return undefined;
  return day;
}
