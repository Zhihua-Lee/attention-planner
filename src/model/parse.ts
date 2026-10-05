import { addDays, dayOf, isoWeekday } from './dates';
import { nextOccurrence } from './repeat';
import type { Day, Part, RepeatRule, Time } from './types';

export type Parsed = {
  title: string;
  due?: Day;
  plan?: { day: Day; part?: Part; start?: Time };
  effort?: number;
  star?: boolean;
  /** A repeat said in words ("每天", "每周一三", "every fri"), or "不重复"/"no repeat". */
  repeat?: RepeatRule | 'none';
  /** The recognised text for each field, as typed. */
  tokens: Partial<Record<'due' | 'plan' | 'effort' | 'star' | 'repeat', string>>;
};

const NUM: Record<string, number> = { 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const count = (s?: string) => (!s ? 1 : /^\d+$/.test(s) ? Math.max(1, +s) : (NUM[s] ?? 1));
const cnDay = (c: string) => '一二三四五六日'.indexOf(c === '天' ? '日' : c) + 1;

/**
 * A repeat in words, taken out of the text. The rule starts today; the caller moves the start to the task's own day.
 * Chinese: 每天 / 每 3 天 / 每个工作日 / 每周 / 每周一三五 / 每两周 / 每月 / 每月 15 号 / 每年 / 不重复.
 * English: daily, every day, every 3 days, weekdays, weekly, every mon and thu, every 2 weeks, monthly, yearly, no repeat.
 */
function takeRepeat(
  take: (re: RegExp) => RegExpMatchArray | null,
  today: Day,
): { rule?: RepeatRule | 'none'; text?: string } {
  const rule = (r: Omit<RepeatRule, 'start' | 'fromDone'>): RepeatRule => ({ ...r, fromDone: false, start: today });
  let m: RegExpMatchArray | null;
  if ((m = take(/不重复|\bno\s+repeat\b/i))) return { rule: 'none', text: m[0] };
  if ((m = take(/每个?工作日|\b(?:every\s+weekday|weekdays)\b/i)))
    return { rule: rule({ freq: 'weekly', every: 1, weekdays: [1, 2, 3, 4, 5] }), text: m[0] };
  if (
    (m = take(
      /每\s*(\d+|[两二三四五六七八九十])?\s*个?\s*(?:周|星期|礼拜)\s*([一二三四五六日天](?:\s*[、,，和]?\s*[一二三四五六日天])*)?/,
    ))
  ) {
    const days = [...new Set((m[2] ?? '').match(/[一二三四五六日天]/g)?.map(cnDay) ?? [])].sort();
    return {
      rule: rule({ freq: 'weekly', every: count(m[1]), ...(days.length ? { weekdays: days } : {}) }),
      text: m[0],
    };
  }
  if ((m = take(/每\s*(\d+|[两二三四五六七八九十])?\s*个?\s*月\s*(?:(\d{1,2})\s*[号日]|(最后一天))?/))) {
    const monthDay = m[3] ? -1 : m[2] && +m[2] >= 1 && +m[2] <= 31 ? +m[2] : undefined;
    return { rule: rule({ freq: 'monthly', every: count(m[1]), ...(monthDay ? { monthDay } : {}) }), text: m[0] };
  }
  if ((m = take(/每\s*(\d+|[两二三四五六七八九十])?\s*[天日]/)))
    return { rule: rule({ freq: 'daily', every: count(m[1]) }), text: m[0] };
  if ((m = take(/每\s*(\d+|[两二三四五六七八九十])?\s*年/)))
    return { rule: rule({ freq: 'yearly', every: count(m[1]) }), text: m[0] };
  const EN = '(mon|tue|wed|thu|fri|sat|sun)[a-z]*';
  if ((m = take(new RegExp(`\\bevery\\s+(${EN}(?:\\s*(?:,|and|&)\\s*${EN})*)`, 'i')))) {
    const names = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const days = [
      ...new Set(
        m[1]
          .toLowerCase()
          .match(/mon|tue|wed|thu|fri|sat|sun/g)!
          .map((d) => names.indexOf(d) + 1),
      ),
    ].sort();
    return { rule: rule({ freq: 'weekly', every: 1, weekdays: days }), text: m[0] };
  }
  if ((m = take(/\bevery\s+(\d+)\s+(day|week|month|year)s?\b/i))) {
    const freq = ({ day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' } as const)[
      m[2].toLowerCase() as 'day' | 'week' | 'month' | 'year'
    ];
    return { rule: rule({ freq, every: count(m[1]) }), text: m[0] };
  }
  if ((m = take(/\b(?:daily|every\s+day)\b/i))) return { rule: rule({ freq: 'daily', every: 1 }), text: m[0] };
  if ((m = take(/\b(?:weekly|every\s+week)\b/i))) return { rule: rule({ freq: 'weekly', every: 1 }), text: m[0] };
  if ((m = take(/\b(?:monthly|every\s+month)\b/i))) return { rule: rule({ freq: 'monthly', every: 1 }), text: m[0] };
  if ((m = take(/\b(?:yearly|annually|every\s+year)\b/i)))
    return { rule: rule({ freq: 'yearly', every: 1 }), text: m[0] };
  return {};
}

const CN_DAYS = '一二三四五六日';
const EN_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const pad = (n: number) => String(n).padStart(2, '0');

function weekday(target: number, today: Day, nextWeek: boolean): Day {
  const w = isoWeekday(today);
  return nextWeek ? addDays(today, 7 - w + target) : addDays(today, (target - w + 7) % 7);
}

/**
 * Pull dates, times, parts of the day, durations, repeats and "!" out of a typed line.
 * A date next to a deadline word (截止, 之前, 交, due, by) becomes the deadline; otherwise it is when to do it.
 * A repeat with a deadline word but no date ("每周五交周报") is due on its next occurrence.
 * For a step (`step: true`) only dates, durations and repeats are read, and any date is the step's deadline:
 * steps have no "when", and times or "!" stay in the text.
 * Unrecognised text stays in the title untouched.
 */
export function parseCapture(input: string, now: Date, { step = false }: { step?: boolean } = {}): Parsed {
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

  // Before dates: "每周五" is a repeat, not this Friday.
  const repeat = takeRepeat(take, today);
  if (repeat.text) tokens.repeat = repeat.text.trim();

  if (!step && (m = take(/\s[!！](?=\s)/))) ((out.star = true), (tokens.star = '!'));

  let start: Time | undefined;
  let part: Part | undefined;
  let timeText = '';
  if (step) {
    // Steps have no time of day.
  } else if ((m = take(/(上午|早上|中午|下午|晚上)?\s*(\d{1,2})(?:[:：](\d{2})|点(半)?)/))) {
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
  if (!dueWord && /截止|交|\bdue\b/i.test(rest)) dueWord = !!day || typeof repeat.rule === 'object';
  // "每周五交周报": due on the next Friday.
  if (!day && dueWord && typeof repeat.rule === 'object' && !start && !part)
    day = nextOccurrence(repeat.rule, today, true);

  if (day && (step || (dueWord && !start && !part))) {
    out.due = day;
    if (dayText) tokens.due = dayText;
  } else if (day || start || part) {
    out.plan = { day: day ?? today, ...(start ? { start } : part ? { part } : {}) };
    tokens.plan = [dayText, timeText].filter(Boolean).join(' ');
  }
  if (repeat.rule === 'none') out.repeat = 'none';
  else if (repeat.rule) out.repeat = { ...repeat.rule, start: out.due ?? out.plan?.day ?? today };
  out.title = rest.replace(/\s+/g, ' ').trim();
  return out;
}
