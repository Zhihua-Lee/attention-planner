import { describe, expect, it } from 'vitest';

import { createNextRecurringTask, createProjectedRecurringTask } from './recurrence';
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
});
