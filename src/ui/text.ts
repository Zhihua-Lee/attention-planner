import { useStore } from '../store/store';
import { diffDays, isoWeekday } from '../model/dates';
import type { Reason } from '../model/derive';
import type { Day, Part, PlanEntry, RepeatRule } from '../model/types';

export type Lang = 'zh' | 'en';
export type T = (zh: string, en: string) => string;

/** The interface language follows the setting; strings are written in place, Chinese first. */
export function useT(): { t: T; lang: Lang } {
  const lang = useStore().doc.settings.lang;
  return { lang, t: (zh, en) => (lang === 'zh' ? zh : en) };
}

const CN = ['一', '二', '三', '四', '五', '六', '日'];
const EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const weekdayName = (day: Day, lang: Lang) =>
  lang === 'zh' ? `周${CN[isoWeekday(day) - 1]}` : EN[isoWeekday(day) - 1];
export const weekdayShort = (iso: number, lang: Lang) => (lang === 'zh' ? CN[iso - 1] : EN[iso - 1].slice(0, 2));
export const monthDay = (day: Day) => `${+day.slice(5, 7)}/${+day.slice(8, 10)}`;

/** 今天 / 明天 / 周五 / 10/12, relative to `today`. */
export function relDay(day: Day, today: Day, lang: Lang): string {
  const n = diffDays(day, today);
  const zh = lang === 'zh';
  if (n === 0) return zh ? '今天' : 'Today';
  if (n === 1) return zh ? '明天' : 'Tomorrow';
  if (n === -1) return zh ? '昨天' : 'Yesterday';
  if (n === 2 && zh) return '后天';
  if (n > 0 && n < 7) return weekdayName(day, lang);
  return monthDay(day);
}

export function duration(min: number, lang: Lang): string {
  if (min < 60) return lang === 'zh' ? `${min} 分钟` : `${min} min`;
  const h = +(min / 60).toFixed(1);
  return lang === 'zh' ? `${h} 小时` : `${h} h`;
}

export const partName = (p: Part, lang: Lang) =>
  ({ am: ['上午', 'Morning'], pm: ['下午', 'Afternoon'], eve: ['晚上', 'Evening'] })[p][lang === 'zh' ? 0 : 1];

export function planWhen(p: Pick<PlanEntry, 'part' | 'start' | 'minutes'>, lang: Lang): string {
  if (p.start) {
    const [h, m] = p.start.split(':').map(Number);
    const end = h * 60 + m + (p.minutes ?? 60);
    return `${p.start}–${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  }
  return p.part ? partName(p.part, lang) : '';
}
export const planLabel = (p: Pick<PlanEntry, 'day' | 'part' | 'start' | 'minutes'>, today: Day, lang: Lang) =>
  [relDay(p.day, today, lang), planWhen(p, lang)].filter(Boolean).join(' ');

export function dueLabel(due: Day, today: Day, lang: Lang): string {
  const n = diffDays(today, due);
  if (n > 0) return lang === 'zh' ? `截止已过 ${n} 天` : `${n} day${n > 1 ? 's' : ''} past due`;
  return lang === 'zh' ? `${relDay(due, today, lang)}截止` : `Due ${relDay(due, today, lang).toLowerCase()}`;
}

export function reasonText(r: Reason, lang: Lang): string {
  const zh = lang === 'zh';
  switch (r.kind) {
    case 'slot':
      return zh ? `现在是预留的时段 · 到 ${r.until}` : `Reserved time now · until ${r.until}`;
    case 'part':
      return zh ? `你打算今天${partName(r.part, lang)}做` : `Planned for this ${partName(r.part, lang).toLowerCase()}`;
    case 'overdue':
      return zh ? `截止已过 ${r.days} 天` : `${r.days} day${r.days > 1 ? 's' : ''} past due`;
    case 'dueToday':
      return zh ? '今天截止' : 'Due today';
    case 'today':
      return zh ? '今天想做的' : 'Planned for today';
    case 'star':
      return zh ? '标了重要' : 'Marked important';
    case 'oldest':
      return zh ? '最早记下的一件' : 'The oldest open task';
  }
}

export function ruleLabel(rule: RepeatRule, lang: Lang): string {
  const zh = lang === 'zh';
  const n = rule.every;
  const unit = {
    hourly: zh ? '小时' : 'hour',
    daily: zh ? '天' : 'day',
    weekly: zh ? '周' : 'week',
    monthly: zh ? '个月' : 'month',
    yearly: zh ? '年' : 'year',
  }[rule.freq];
  let text: string;
  if (rule.fromDone) text = zh ? `完成后 ${n} ${unit}` : `${n} ${unit}${n > 1 ? 's' : ''} after done`;
  else if (rule.freq === 'weekly') {
    const days = (rule.weekdays ?? [isoWeekday(rule.start)]).slice().sort();
    const workdays = days.join() === '1,2,3,4,5';
    const list = workdays
      ? zh
        ? '工作日'
        : 'weekdays'
      : days.map((d) => weekdayShort(d, lang)).join(zh ? '、' : ', ');
    text = zh
      ? `${n === 1 ? '每周' : `每 ${n} 周`}${workdays ? '的' : ''}${list}`
      : `Every ${n === 1 ? '' : n + ' weeks on '}${list}`;
  } else if (rule.freq === 'monthly') {
    const d = rule.monthDay ?? +rule.start.slice(8, 10);
    const day = d === -1 ? (zh ? '最后一天' : 'last day') : zh ? `${d} 日` : `day ${d}`;
    text = zh ? `${n === 1 ? '每月' : `每 ${n} 个月`} ${day}` : `${n === 1 ? 'Monthly' : `Every ${n} months`}, ${day}`;
  } else if (rule.freq === 'yearly')
    text = zh
      ? `${n === 1 ? '每年' : `每 ${n} 年`} ${monthDay(rule.start)}`
      : `${n === 1 ? 'Yearly' : `Every ${n} years`}, ${monthDay(rule.start)}`;
  else text = n === 1 ? (zh ? '每天' : 'Daily') : zh ? `每 ${n} 天` : `Every ${n} days`;
  if (rule.until) text += zh ? ` · 至 ${monthDay(rule.until)}` : ` · until ${monthDay(rule.until)}`;
  else if (rule.count) text += zh ? ` · 共 ${rule.count} 次` : ` · ${rule.count} times`;
  return text;
}
