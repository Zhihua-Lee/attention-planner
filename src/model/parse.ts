import { addDays, dayOf, isoWeekday } from './dates';
import type { Day, Part, Time } from './types';

export type Parsed = {
  title: string;
  due?: Day;
  plan?: { day: Day; part?: Part; start?: Time };
  effort?: number;
  star?: boolean;
  /** The recognised text for each field, as typed. */
  tokens: Partial<Record<'due' | 'plan' | 'effort' | 'star', string>>;
};

const CN_DAYS = '一二三四五六日';
const EN_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const pad = (n: number) => String(n).padStart(2, '0');

function weekday(target: number, today: Day, nextWeek: boolean): Day {
  const w = isoWeekday(today);
  return nextWeek ? addDays(today, 7 - w + target) : addDays(today, (target - w + 7) % 7);
}

/**
 * Pull dates, times, parts of the day, durations and "!" out of a typed line.
 * A date next to a deadline word (截止, 之前, 交, due, by) becomes the deadline; otherwise it is when to do it.
 * Unrecognised text stays in the title untouched.
 */
export function parseCapture(input: string, now: Date): Parsed {
  const today = dayOf(now);
  let rest = ` ${input} `;
  const tokens: Parsed['tokens'] = {};
  const out: Parsed = { title: '', tokens };
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], ' ');
    return m;
  };

  let m = take(/(\d+(?:\.\d+)?)\s*(?:个)?(?:小时|hours?|hrs?|h)(?![a-z])/i);
  if (m) ((out.effort = Math.round(parseFloat(m[1]) * 60)), (tokens.effort = m[0].trim()));
  else if ((m = take(/(\d+)\s*(?:分钟|mins?|minutes?|m)(?![a-z])/i)))
    ((out.effort = +m[1]), (tokens.effort = m[0].trim()));

  if ((m = take(/\s[!！](?=\s)/))) ((out.star = true), (tokens.star = '!'));

  let start: Time | undefined;
  let part: Part | undefined;
  let timeText = '';
  if ((m = take(/(上午|早上|中午|下午|晚上)?\s*(\d{1,2})(?:[:：](\d{2})|点(半)?)/))) {
    let h = +m[2];
    if (/下午|晚上/.test(m[1] ?? '') && h < 12) h += 12;
    if (h < 24) start = `${pad(h)}:${m[3] ?? (m[4] ? '30' : '00')}`;
    timeText = m[0].trim();
  } else if ((m = take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i))) {
    let h = +m[1] % 12;
    if (m[3].toLowerCase() === 'pm') h += 12;
    start = `${pad(h)}:${m[2] ?? '00'}`;
    timeText = m[0].trim();
  } else if ((m = take(/(上午|早上|中午|下午|晚上)|\b(morning|afternoon|evening|tonight)\b/i))) {
    const w = (m[1] ?? m[2]).toLowerCase();
    part = /上午|早上|morning/.test(w) ? 'am' : /中午|下午|afternoon/.test(w) ? 'pm' : 'eve';
    timeText = m[0].trim();
    if (w === 'tonight') rest = ` today ${rest}`;
  }

  let day: Day | undefined;
  let dayText = '';
  let dueWord = false;
  if ((m = take(/(截止|之前|交|due|by)?\s*(今天|明天|后天|下?(?:周|星期)[一二三四五六日天])\s*(之前|前|截止)?/i))) {
    const w = m[2];
    if (w === '今天') day = today;
    else if (w === '明天') day = addDays(today, 1);
    else if (w === '后天') day = addDays(today, 2);
    else day = weekday(CN_DAYS.indexOf(w.slice(-1) === '天' ? '日' : w.slice(-1)) + 1, today, w.startsWith('下'));
    dueWord = !!(m[1] || m[3]);
    dayText = m[0].trim();
  } else if ((m = take(/\b(due|by)?\s*(today|tomorrow|(next\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*)\b/i))) {
    const w = m[2].toLowerCase();
    if (w === 'today') day = today;
    else if (w === 'tomorrow') day = addDays(today, 1);
    else day = weekday(EN_DAYS.indexOf(m[4].toLowerCase()) + 1, today, !!m[3]);
    dueWord = !!m[1];
    dayText = m[0].trim();
  }
  if (!dueWord && day && /截止|交|\bdue\b/i.test(rest)) dueWord = true;

  if (day && dueWord && !start && !part) ((out.due = day), (tokens.due = dayText));
  else if (day || start || part) {
    out.plan = { day: day ?? today, ...(start ? { start } : part ? { part } : {}) };
    tokens.plan = [dayText, timeText].filter(Boolean).join(' ');
  }
  out.title = rest.replace(/\s+/g, ' ').trim();
  return out;
}
