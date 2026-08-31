import { describe, expect, it } from 'vitest';

import {
    getTaskAvailableAt,
    getTaskAvailabilityPatch,
    getTaskSchedulePatch,
    getTaskScheduledAt,
    getTaskUnschedulePatch,
    isTaskAttentionEligible,
    isTaskReadyForNow,
} from './task-time-semantics';
import type { Task } from './types';

const task = (overrides: Partial<Task> = {}): Task => ({
    id: 'task',
    title: 'Task',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
});

describe('task time semantics', () => {
    it('keeps legacy date-only and timed start values unambiguous', () => {
        expect(getTaskAvailableAt(task({ startTime: '2026-08-25' }))).toBe('2026-08-25');
        expect(getTaskScheduledAt(task({ startTime: '2026-08-25' }))).toBeUndefined();

        expect(getTaskAvailableAt(task({ startTime: '2026-08-25T13:00:00.000Z' }))).toBeUndefined();
        expect(getTaskScheduledAt(task({ startTime: '2026-08-25T13:00:00.000Z' }))).toBe('2026-08-25T13:00:00.000Z');
    });

    it('prefers explicit fields over the legacy compatibility value', () => {
        const value = task({
            startTime: '2026-08-25',
            availableAt: '2026-08-26',
            scheduledAt: '2026-08-26T13:00:00.000Z',
        });
        expect(getTaskAvailableAt(value)).toBe('2026-08-26');
        expect(getTaskScheduledAt(value)).toBe('2026-08-26T13:00:00.000Z');
    });

    it('treats snooze as temporary NOW suppression without changing either time field', () => {
        const now = new Date('2026-08-25T12:00:00.000Z');
        const value = task({
            availableAt: '2026-08-25T09:00:00.000Z',
            scheduledAt: '2026-08-25T14:00:00.000Z',
            snoozedUntil: '2026-08-25T12:30:00.000Z',
        });
        expect(isTaskReadyForNow(value, now)).toBe(false);
        expect(getTaskAvailableAt(value)).toBe('2026-08-25T09:00:00.000Z');
        expect(getTaskScheduledAt(value)).toBe('2026-08-25T14:00:00.000Z');
        expect(isTaskReadyForNow(value, new Date('2026-08-25T14:01:00.000Z'))).toBe(true);
    });

    it('uses one Ready eligibility rule for status and availability while keeping snooze NOW-only', () => {
        const now = new Date('2026-08-25T12:00:00.000Z');

        expect(isTaskAttentionEligible(task(), now)).toBe(true);
        expect(isTaskAttentionEligible(task({ status: 'inbox' }), now)).toBe(false);
        expect(isTaskAttentionEligible(task({ status: 'waiting' }), now)).toBe(false);
        expect(isTaskAttentionEligible(task({ status: 'someday' }), now)).toBe(false);
        expect(isTaskAttentionEligible(task({ availableAt: '2026-08-26' }), now)).toBe(false);

        const snoozed = task({ snoozedUntil: '2026-08-25T12:30:00.000Z' });
        expect(isTaskAttentionEligible(snoozed, now)).toBe(true);
        expect(isTaskReadyForNow(snoozed, now)).toBe(false);
    });

    it('keeps a future time block out of NOW until its scheduled time', () => {
        const now = new Date('2026-08-25T12:00:00.000Z');
        const futureBlock = task({ scheduledAt: '2026-08-25T14:00:00.000Z' });

        expect(isTaskAttentionEligible(futureBlock, now)).toBe(true);
        expect(isTaskReadyForNow(futureBlock, now)).toBe(false);
        expect(isTaskReadyForNow(futureBlock, new Date('2026-08-25T14:00:00.000Z'))).toBe(true);
    });

    it('clears a timed legacy schedule without erasing date-only legacy availability', () => {
        expect(getTaskUnschedulePatch(task({
            scheduledAt: '2026-08-25T14:00:00.000Z',
            startTime: '2026-08-25T13:00:00.000Z',
            relativeStartOffset: { amount: -1, unit: 'day' },
        }))).toEqual({
            scheduledAt: undefined,
            startTime: undefined,
            relativeStartOffset: undefined,
        });
        expect(getTaskUnschedulePatch(task({
            scheduledAt: '2026-08-25T14:00:00.000Z',
            startTime: '2026-08-25',
        }))).toEqual({ scheduledAt: undefined });
    });

    it('centralizes semantic writes and retires only the matching legacy fallback', () => {
        expect(getTaskSchedulePatch(task({ startTime: '2026-08-25T13:00:00.000Z' }), '2026-08-25T14:00:00.000Z')).toEqual({
            scheduledAt: '2026-08-25T14:00:00.000Z',
            startTime: undefined,
            relativeStartOffset: undefined,
        });
        expect(getTaskAvailabilityPatch(task({ startTime: '2026-08-25' }), '2026-08-26')).toEqual({
            availableAt: '2026-08-26',
            startTime: undefined,
            relativeStartOffset: undefined,
        });
        expect(getTaskAvailabilityPatch(task({ startTime: '2026-08-25T13:00:00.000Z' }), '2026-08-26')).toEqual({
            availableAt: '2026-08-26',
        });
    });
});
