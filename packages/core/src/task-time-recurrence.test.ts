import { describe, expect, it } from 'vitest';

import {
    createNextRecurringTask,
    createProjectedRecurringTask,
    getProjectedRecurringTaskCalendarDate,
    getRecurringTaskPreviewDate,
} from './recurrence';
import type { Task } from './types';

const recurringTask = (overrides: Partial<Task> = {}): Task => ({
    id: 'recurring-time-task',
    title: 'Protected writing block',
    status: 'next',
    tags: [],
    contexts: [],
    recurrence: { rule: 'daily', strategy: 'strict' },
    createdAt: '2026-08-25T12:00:00.000Z',
    updatedAt: '2026-08-25T12:00:00.000Z',
    ...overrides,
});

describe('recurring semantic task times', () => {
    it('advances availability and schedule independently and clears a snooze', () => {
        const next = createNextRecurringTask(recurringTask({
            availableAt: '2026-08-25',
            scheduledAt: '2026-08-25T13:00:00.000Z',
            snoozedUntil: '2026-08-25T12:30:00.000Z',
        }), '2026-08-25T14:00:00.000Z', 'done');

        expect(next?.availableAt).toBe('2026-08-26');
        expect(next?.scheduledAt).toBe('2026-08-26T13:00:00.000Z');
        expect(next?.snoozedUntil).toBeUndefined();
    });

    it('projects the next calendar block from scheduledAt', () => {
        const projected = createProjectedRecurringTask(recurringTask({
            scheduledAt: '2026-08-25T13:00:00.000Z',
            showFutureRecurrence: true,
        }), '2026-08-25T12:00:00.000Z');

        expect(projected?.scheduledAt).toBe('2026-08-26T13:00:00.000Z');
        expect(projected?.startTime).toBeUndefined();
    });

    it('projects availability-only recurrence for the Recurring preview without creating a calendar block', () => {
        const value = recurringTask({
            availableAt: '2026-08-25',
            showFutureRecurrence: true,
        });
        const projected = createProjectedRecurringTask(value, '2026-08-25T12:00:00.000Z');

        expect(projected?.availableAt).toBe('2026-08-26');
        expect(getRecurringTaskPreviewDate(value, '2026-08-25T12:00:00.000Z')).toBe('2026-08-26');
        expect(getProjectedRecurringTaskCalendarDate(value, '2026-08-25T12:00:00.000Z')).toBeUndefined();
    });
});
