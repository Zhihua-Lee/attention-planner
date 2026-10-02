import { describe, expect, it } from 'vitest';
import type { Task } from '@mindwtr/core';
import { defaultRule, matchingPreset, presetRule, recurrenceFromRule, ruleFromRecurrence, ruleFromSchedule, ruleLabel, sameCadence, scheduleFromRule, stepRepeat, taskRepeat } from './repeat-rules';

const today = new Date('2026-10-02T15:00:00Z'); // Friday
const base = { ...defaultRule(today, 'America/Chicago') };
const task = (patch: Partial<Task> = {}): Task => ({ id: 't', title: 't', status: 'next', tags: [], contexts: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...patch });

describe('repeat rules', () => {
    it('defaults to daily at midnight in the device zone', () => {
        expect(base).toMatchObject({ frequency: 'daily', interval: 1, anchor: 'calendar', startDate: '2026-10-02', time: '00:00', timeZone: 'America/Chicago' });
    });
    it('builds presets from today and recognizes them again', () => {
        expect(presetRule('weekly', base).weekdays).toEqual([5]);
        expect(presetRule('monthly', base).monthDays).toEqual([2]);
        for (const id of ['daily', 'weekdays', 'weekly', 'monthly', 'after-1-day'] as const) expect(matchingPreset(presetRule(id, base))).toBe(id);
        expect(matchingPreset({ ...base, interval: 2 })).toBeUndefined();
    });
    it('labels rules tersely', () => {
        expect(ruleLabel(presetRule('weekdays', base), true)).toBe('工作日');
        expect(ruleLabel({ ...base, frequency: 'weekly', weekdays: [2, 4] }, true)).toBe('每周二、四');
        expect(ruleLabel({ ...base, frequency: 'monthly', monthDays: [-1] }, true)).toBe('每月 最后一天');
        expect(ruleLabel({ ...base, anchor: 'completion', frequency: 'hourly', interval: 3 }, true)).toBe('完成后 3 小时');
        expect(ruleLabel({ ...base, time: '06:00', end: '2026-12-10' }, true, true)).toBe('每天 06:00 · 至 2026-12-10');
        expect(ruleLabel({ ...base, frequency: 'weekly', weekdays: [2, 4] }, false)).toBe('Every Tue, Thu');
    });
    it('round-trips a reopen schedule and keeps its version for the same cadence', () => {
        const rule = { ...base, frequency: 'weekly' as const, weekdays: [2, 4], end: '2026-12-10' };
        const schedule = scheduleFromRule(rule, 'v1');
        expect(ruleFromSchedule(schedule, '2026-12-10')).toEqual(rule);
        expect(sameCadence(schedule, scheduleFromRule({ ...rule, end: undefined }, 'other'))).toBe(true);
        expect(sameCadence(schedule, scheduleFromRule({ ...rule, weekdays: [2] }, 'v1'))).toBe(false);
        expect(scheduleFromRule({ ...base, anchor: 'completion', frequency: 'weekly', weekdays: [2] }, 'v2')).not.toHaveProperty('weekdays');
    });
    it('round-trips a new-copy recurrence', () => {
        const rule = { ...base, frequency: 'weekly' as const, weekdays: [1, 3], end: '2026-12-31' };
        const recurrence = recurrenceFromRule(rule);
        expect(recurrence).toMatchObject({ rule: 'weekly', strategy: 'strict', byDay: ['MO', 'WE'], until: '2026-12-31' });
        expect(ruleFromRecurrence(recurrence, task(), today)).toMatchObject({ frequency: 'weekly', weekdays: [1, 3], anchor: 'calendar', end: '2026-12-31' });
        expect(recurrenceFromRule({ ...base, anchor: 'completion', interval: 3 }).strategy).toBe('fluid');
    });
    it('reads what a task and its steps currently do', () => {
        expect(taskRepeat(task(), today).kind).toBe('none');
        expect(taskRepeat(task({ recurrence: 'weekly' }), today).kind).toBe('copy');
        const policy = { mode: 'custom' as const, schedule: scheduleFromRule(base, 'v1'), end: { mode: 'never' as const }, revision: 1, updatedAt: '2026-10-01T00:00:00Z', deviceId: 'a' };
        const reopening = task({ checklist: [{ id: 'a', title: 'A', isCompleted: false }], planner: { version: 1, blocks: [], days: [], checklistRefresh: { version: 1, defaults: policy, items: { a: { ...policy, mode: 'off', schedule: undefined } }, marks: {} } } });
        expect(taskRepeat(reopening, today)).toMatchObject({ kind: 'reopen', paused: false });
        expect(stepRepeat(reopening, 'a').kind).toBe('none');
        expect(stepRepeat(task({ checklist: [{ id: 'b', title: 'B', isCompleted: false }] }), 'b').kind).toBe('follow');
    });
});
