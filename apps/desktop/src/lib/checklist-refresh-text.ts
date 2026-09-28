import type { ChecklistRefreshSchedule } from '@mindwtr/core';

const units = {
    en: { hourly: 'hour', daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' },
    zh: { hourly: '小时', daily: '天', weekly: '周', monthly: '个月', yearly: '年' },
} as const;

/** "3 hours after completion" / "完成后 3 小时" for an after-completion schedule. */
export function checklistDelayLabel(schedule: Pick<ChecklistRefreshSchedule, 'frequency' | 'interval'>, zh: boolean) {
    const n = schedule.interval;
    return zh ? `完成后 ${n} ${units.zh[schedule.frequency]}` : `${n} ${units.en[schedule.frequency]}${n === 1 ? '' : 's'} after completion`;
}
