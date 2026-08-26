import { describe, expect, it } from 'vitest';
import type { Task } from '@mindwtr/core';
import { resolveGlobalSearchTaskView } from './GlobalSearch';

const baseTask: Task = {
    id: 'task-1',
    title: 'Task',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-02-27T00:00:00.000Z',
    updatedAt: '2026-02-27T00:00:00.000Z',
};

describe('resolveGlobalSearchTaskView', () => {
    it('falls back to review for deferred next tasks', () => {
        const result = resolveGlobalSearchTaskView(
            {
                ...baseTask,
                status: 'next',
                availableAt: '2026-02-28T10:00:00.000Z',
            },
            new Date('2026-02-27T09:00:00.000Z')
        );
        expect(result).toBe('review');
    });

    it('keeps next view for currently visible next tasks', () => {
        const result = resolveGlobalSearchTaskView(
            {
                ...baseTask,
                status: 'next',
                startTime: '2026-02-27T10:00:00.000Z',
            },
            new Date('2026-02-27T09:00:00.000Z')
        );
        expect(result).toBe('next');
    });

    // A recurring task with no start date defers on its due date, so Next hides
    // it. Navigating there left the task unreachable from search (#867).
    it('falls back to review for recurring tasks deferred by a future due date', () => {
        const result = resolveGlobalSearchTaskView(
            {
                ...baseTask,
                status: 'next',
                dueDate: '2026-03-07',
                recurrence: { rule: 'weekly', strategy: 'fluid', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA' },
            } as unknown as Task,
            new Date('2026-02-27T09:00:00.000Z')
        );
        expect(result).toBe('review');
    });

    // The boundary: a plain future due date does not defer a task, so this must
    // keep routing to Next rather than over-correcting everything into Review.
    it('keeps next view for a non-recurring task with a future due date', () => {
        const result = resolveGlobalSearchTaskView(
            {
                ...baseTask,
                status: 'next',
                dueDate: '2026-03-07',
            },
            new Date('2026-02-27T09:00:00.000Z')
        );
        expect(result).toBe('next');
    });

    it('maps reference tasks to reference view', () => {
        const result = resolveGlobalSearchTaskView({
            ...baseTask,
            status: 'reference',
        });
        expect(result).toBe('reference');
    });
});
