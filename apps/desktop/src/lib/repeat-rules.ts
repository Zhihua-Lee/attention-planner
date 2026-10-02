import { buildRRuleString, checklistLocalDay, checklistTargetPolicy, parseRRuleString, type ChecklistRefreshPolicy, type ChecklistRefreshSchedule,
    type Recurrence, type RecurrenceByDay, type Task } from '@mindwtr/core';

/**
 * One repeat rule for both behaviors:
 * - 'reopen': the same task (or step) reopens each round (planner.checklistRefresh)
 * - 'copy': completing it creates the next task (task.recurrence)
 */
export type RepeatRule = {
    frequency: ChecklistRefreshSchedule['frequency'];
    interval: number;
    anchor: 'calendar' | 'completion';
    weekdays?: number[]; // ISO 1 = Monday … 7 = Sunday
    monthDays?: number[]; // 1–31, -1 = last day
    startDate: string;
    time: string;
    timeZone: string;
    end?: string;
};
export type TaskRepeat = { kind: 'none' } | { kind: 'reopen'; rule: RepeatRule; paused: boolean } | { kind: 'copy'; rule: RepeatRule };
export type StepRepeat = { kind: 'follow' } | { kind: 'none' } | { kind: 'own'; rule: RepeatRule };

const CODES: RecurrenceByDay[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const isoWeekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() || 7;

export function defaultRule(now = new Date(), zone = deviceTimeZone()): RepeatRule {
    return { frequency: 'daily', interval: 1, anchor: 'calendar', startDate: checklistLocalDay(now, zone), time: '00:00', timeZone: zone };
}

export type PresetId = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'after-1-day';
/** Common rules, anchored on today; anything else is a custom rule. */
export function presetRule(id: PresetId, base: RepeatRule): RepeatRule {
    const { startDate, time, timeZone, end } = base, today = Number(startDate.slice(8, 10));
    const keep = { startDate, time, timeZone, end, interval: 1 };
    switch (id) {
        case 'daily': return { ...keep, frequency: 'daily', anchor: 'calendar' };
        case 'weekdays': return { ...keep, frequency: 'weekly', anchor: 'calendar', weekdays: [1, 2, 3, 4, 5] };
        case 'weekly': return { ...keep, frequency: 'weekly', anchor: 'calendar', weekdays: [isoWeekday(startDate)] };
        case 'monthly': return { ...keep, frequency: 'monthly', anchor: 'calendar', monthDays: [today] };
        case 'after-1-day': return { ...keep, frequency: 'daily', anchor: 'completion' };
    }
}
const sameDays = (a: number[] | undefined, b: number[] | undefined) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
export function matchingPreset(rule: RepeatRule): PresetId | undefined {
    return (['daily', 'weekdays', 'weekly', 'monthly', 'after-1-day'] as const).find(id => {
        const preset = presetRule(id, rule);
        return preset.frequency === rule.frequency && preset.anchor === rule.anchor && rule.interval === 1
            && sameDays(preset.weekdays, rule.weekdays) && sameDays(preset.monthDays, rule.monthDays);
    });
}

const UNIT = { zh: { hourly: '小时', daily: '天', weekly: '周', monthly: '个月', yearly: '年' }, en: { hourly: 'hour', daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } };
const DAY = { zh: ['一', '二', '三', '四', '五', '六', '日'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };
/** Short label, e.g. "每周二、四" / "Every Tue, Thu", "完成后 3 天". */
export function ruleLabel(rule: RepeatRule, zh: boolean, withTime = false): string {
    const n = rule.interval, unit = UNIT[zh ? 'zh' : 'en'][rule.frequency];
    const plural = (text: string) => zh || n === 1 ? text : `${text}s`;
    let text: string;
    if (rule.anchor === 'completion') text = zh ? `完成后 ${n} ${unit}` : `${n} ${plural(unit)} after done`;
    else if (rule.frequency === 'weekly' && n === 1 && sameDays(rule.weekdays, [1, 2, 3, 4, 5])) text = zh ? '工作日' : 'Weekdays';
    else if (rule.frequency === 'weekly' && n === 1 && rule.weekdays?.length === 7) text = zh ? '每天' : 'Daily';
    else if (rule.frequency === 'weekly') {
        const days = [...(rule.weekdays ?? [])].sort().map(d => DAY[zh ? 'zh' : 'en'][d - 1]).join(zh ? '、' : ', ');
        text = zh ? `${n === 1 ? '每周' : `每 ${n} 周`}${days}` : `${n === 1 ? 'Every' : `Every ${n} weeks,`} ${days}`;
    } else if (rule.frequency === 'monthly') {
        const days = (rule.monthDays?.length ? rule.monthDays : [Number(rule.startDate.slice(8, 10))]).map(d => d === -1 ? (zh ? '最后一天' : 'last day') : zh ? `${d} 日` : `day ${d}`).join(zh ? '、' : ', ');
        text = zh ? `${n === 1 ? '每月' : `每 ${n} 个月`} ${days}` : `${n === 1 ? 'Monthly' : `Every ${n} months`}, ${days}`;
    } else if (rule.frequency === 'yearly') text = zh ? `${n === 1 ? '每年' : `每 ${n} 年`} ${Number(rule.startDate.slice(5, 7))} 月 ${Number(rule.startDate.slice(8, 10))} 日` : `${n === 1 ? 'Yearly' : `Every ${n} years`}, ${rule.startDate.slice(5)}`;
    else text = n === 1 ? (zh ? '每天' : 'Daily') : zh ? `每 ${n} 天` : `Every ${n} days`;
    if (withTime && rule.anchor === 'calendar' && rule.time !== '00:00') text += ` ${rule.time}`;
    if (rule.end) text += zh ? ` · 至 ${rule.end}` : ` · until ${rule.end}`;
    return text;
}

// ——— reopen in place: planner.checklistRefresh policies ———
export function ruleFromSchedule(schedule: ChecklistRefreshSchedule, end?: string): RepeatRule {
    return { frequency: schedule.frequency, interval: schedule.interval, anchor: schedule.anchor === 'completion' ? 'completion' : 'calendar',
        weekdays: schedule.weekdays, monthDays: schedule.monthDays, startDate: schedule.startDate, time: schedule.time, timeZone: schedule.timeZone, end };
}
/** Cadence fields only; `id` is chosen by the caller so a schedule version survives edits that keep the cadence. */
export function scheduleFromRule(rule: RepeatRule, id: string): ChecklistRefreshSchedule {
    const completion = rule.anchor === 'completion';
    return { id, ...(completion ? { anchor: 'completion' as const } : {}), frequency: rule.frequency, interval: rule.interval,
        ...(!completion && rule.frequency === 'weekly' ? { weekdays: rule.weekdays?.length ? rule.weekdays : [isoWeekday(rule.startDate)] } : {}),
        ...(!completion && rule.frequency === 'monthly' && rule.monthDays?.length ? { monthDays: rule.monthDays } : {}),
        startDate: rule.startDate, time: rule.time, timeZone: rule.timeZone };
}
/** Same cadence (ignoring end date): the schedule version, and so this round's checkmarks, is kept. */
export const sameCadence = (a: ChecklistRefreshSchedule | undefined, b: ChecklistRefreshSchedule) => !!a && JSON.stringify({ ...a, id: '' }) === JSON.stringify({ ...b, id: '' });

// ——— a new copy each time: task.recurrence ———
export function ruleFromRecurrence(recurrence: NonNullable<Task['recurrence']>, task: Task, now = new Date()): RepeatRule {
    const value = typeof recurrence === 'string' ? { rule: recurrence } as Recurrence : recurrence;
    const parsed = value.rrule ? parseRRuleString(value.rrule) : undefined;
    const byDay = (parsed?.byDay ?? value.byDay ?? []).filter((day): day is RecurrenceByDay => CODES.includes(day as RecurrenceByDay));
    const base = defaultRule(now);
    return { ...base, frequency: value.rule, interval: parsed?.interval ?? 1, anchor: value.strategy === 'fluid' ? 'completion' : 'calendar',
        weekdays: byDay.length ? byDay.map(day => CODES.indexOf(day) + 1) : undefined, monthDays: parsed?.byMonthDay ?? value.byMonthDay,
        startDate: (task.dueDate || task.availableAt || base.startDate).slice(0, 10), end: value.until?.slice(0, 10) };
}
export function recurrenceFromRule(rule: RepeatRule, previous?: Task['recurrence']): Recurrence {
    const frequency = rule.frequency === 'hourly' ? 'daily' : rule.frequency;
    const byDay = rule.anchor === 'calendar' && frequency === 'weekly' ? (rule.weekdays ?? []).map(d => CODES[d - 1]) : undefined;
    const byMonthDay = rule.anchor === 'calendar' && frequency === 'monthly' ? rule.monthDays : undefined;
    const old = previous && typeof previous === 'object' ? previous : undefined;
    return { ...(old?.seriesId ? { seriesId: old.seriesId } : {}), rule: frequency, strategy: rule.anchor === 'completion' ? 'fluid' : 'strict',
        ...(byDay?.length ? { byDay } : {}), ...(byMonthDay?.length ? { byMonthDay } : {}),
        rrule: buildRRuleString(frequency, byDay, rule.interval, { byMonthDay }), ...(rule.end ? { until: rule.end } : {}) };
}

// ——— reading what a task / step currently does ———
export function taskRepeat(task: Task, now = new Date()): TaskRepeat {
    if (task.recurrence) return { kind: 'copy', rule: ruleFromRecurrence(task.recurrence, task, now) };
    const policy = checklistTargetPolicy(task);
    if (policy?.mode === 'custom' && policy.schedule) return { kind: 'reopen', rule: ruleFromSchedule(policy.schedule, policy.end.mode === 'date' ? policy.end.date : undefined), paused: !!policy.pausedAt };
    return { kind: 'none' };
}
export function stepRepeat(task: Task, itemId: string): StepRepeat {
    const policy: ChecklistRefreshPolicy | undefined = checklistTargetPolicy(task, itemId);
    if (policy?.mode === 'custom' && policy.schedule) return { kind: 'own', rule: ruleFromSchedule(policy.schedule, policy.end.mode === 'date' ? policy.end.date : undefined) };
    if (policy?.mode === 'off') return { kind: 'none' };
    return { kind: 'follow' };
}
