import type { Day, Time } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export const dayOf = (d: Date): Day => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toDate = (day: Day, time: Time = '00:00') => new Date(`${day}T${time}:00`);
export const addDays = (day: Day, n: number): Day => {
  const d = toDate(day);
  d.setDate(d.getDate() + n);
  return dayOf(d);
};
/** Whole days from `b` to `a`. */
export const diffDays = (a: Day, b: Day) => Math.round((toDate(a).getTime() - toDate(b).getTime()) / 864e5);
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (day: Day) => toDate(day).getDay() || 7;
export const weekStart = (day: Day) => addDays(day, 1 - isoWeekday(day));
export const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate(); // m is 1-based

export const minutesOf = (t: Time) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const timeOf = (minutes: number): Time => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
export const nowMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

export const isDay = (v: unknown): v is Day =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && dayOf(toDate(v)) === v;
export const isTime = (v: unknown): v is Time => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export const PARTS = {
  am: { from: 8 * 60, to: 12 * 60 },
  pm: { from: 12 * 60, to: 18 * 60 },
  eve: { from: 18 * 60, to: 23 * 60 },
} as const;
