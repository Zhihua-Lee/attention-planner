import { describe, expect, it } from 'vitest';
import { createPlanningPolicy } from './planning-policy';
import { selectNow } from './attention-frames';
import type { Project, Task } from './types';

const now = new Date('2026-09-07T09:00:00');
const task = (id: string, fields: Partial<Task> = {}): Task => ({
    id, title: id, status: 'next', contexts: [], tags: [],
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...fields,
});
const project = (fields: Partial<Project> = {}): Project => ({
    id: 'p', title: 'Research', status: 'active', color: '#000000', order: 0,
    tagIds: [], createdAt: '', updatedAt: '', ...fields,
});

describe('planning and execution have different contracts', () => {
    it('T01/T02: permits planning a future Available task, without recommending it now', () => {
        const future = task('future', { availableAt: '2026-09-08', isFocusedToday: true });
        const policy = createPlanningPolicy([future], [], now);
        expect(policy.isCandidate(future)).toBe(true);
        expect(policy.isVisible(future)).toBe(true);
        expect(policy.executionBlock(future)).toBe('unavailable');
        expect(selectNow({ tasks: [future], projects: [], now })).toBeNull();
    });
    it('T12: retains paused-project plans, but excludes even starred projects from execution', () => {
        const planned = task('planned', { projectId: 'p', isFocusedToday: true });
        const projects = [project({ status: 'waiting', isFocused: true })];
        const policy = createPlanningPolicy([planned], projects, now);
        expect(policy.isVisible(planned)).toBe(true);
        expect(policy.isCandidate(planned)).toBe(false);
        expect(policy.executionBlock(planned)).toBe('project');
        expect(selectNow({ tasks: [planned], projects, now })).toBeNull();
    });
    it('allows planning later sequential steps; starring cannot bypass a predecessor', () => {
        const first = task('first', { projectId: 'p', order: 1, status: 'waiting' });
        const second = task('second', { projectId: 'p', order: 2, isFocusedToday: true });
        const projects = [project({ isSequential: true })];
        const policy = createPlanningPolicy([first, second], projects, now);
        expect(policy.isCandidate(second)).toBe(true);
        expect(policy.executionBlock(second)).toBe('sequential');
        expect(selectNow({ tasks: [first, second], projects, now })).toBeNull();
    });
    it('respects section-scoped streams and completion without letting deleted predecessors block', () => {
        const done = task('done', { projectId: 'p', sectionId: 'a', order: 0, status: 'done' });
        const a = task('a', { projectId: 'p', sectionId: 'a', order: 1 });
        const b = task('b', { projectId: 'p', sectionId: 'b', order: 2 });
        const policy = createPlanningPolicy([done, a, b], [project({ isSequential: true, sequentialScope: 'section' })], now);
        expect(policy.executionBlock(a)).toBeNull();
        expect(policy.executionBlock(b)).toBeNull();
    });
    it('T22: snooze and a future block suppress NOW only', () => {
        for (const fields of [{ snoozedUntil: '2026-09-07T14:00:00' }, { scheduledAt: '2026-09-07T14:00:00' }]) {
            const planned = task('planned', fields);
            const policy = createPlanningPolicy([planned], [], now);
            expect(policy.isCandidate(planned)).toBe(true);
            expect(policy.isVisible(planned)).toBe(true);
            expect(selectNow({ tasks: [planned], projects: [], now })).toBeNull();
        }
    });
});
