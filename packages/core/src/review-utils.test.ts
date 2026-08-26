import { describe, expect, it } from 'vitest';
import {
    buildReviewSteps,
    getAdvancedReviewDate,
    getDailyReviewBuckets,
    getExternalCalendarDaySummaries,
    getStaleItems,
    getWeeklyReviewBuckets,
    getWeeklyReviewSummary,
    partitionByReviewDate,
} from './review-utils';
import type { Project, Task } from './types';

const staleUpdatedAt = '2026-01-01T00:00:00.000Z';
const now = new Date('2026-03-01T00:00:00.000Z');

const createTask = (overrides: Partial<Task> = {}): Task => ({
    id: 'task-1',
    title: 'Future task',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: staleUpdatedAt,
    updatedAt: staleUpdatedAt,
    ...overrides,
});

const createProject = (overrides: Partial<Project> = {}): Project => ({
    id: 'project-1',
    title: 'Project',
    status: 'active',
    color: '#3B82F6',
    order: 0,
    tagIds: [],
    createdAt: staleUpdatedAt,
    updatedAt: staleUpdatedAt,
    ...overrides,
});

describe('getStaleItems', () => {
    it('includes task and project scheduling dates in stale review snapshots', () => {
        const task = createTask({
            startTime: '2026-01-05T09:00:00.000Z',
            dueDate: '2026-09-05T17:00:00.000Z',
            reviewAt: '2026-02-15T09:00:00.000Z',
        });
        const project = createProject({
            dueDate: '2026-12-01',
            reviewAt: '2026-02-01T09:00:00.000Z',
        });

        const items = getStaleItems([task], [project], 14, now);

        expect(items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'task-1',
                startTime: task.startTime,
                dueDate: task.dueDate,
                reviewAt: task.reviewAt,
            }),
            expect.objectContaining({
                id: 'project:project-1',
                dueDate: project.dueDate,
                reviewAt: project.reviewAt,
            }),
        ]));
    });

    it('skips tasks explicitly deferred with a future review or start date', () => {
        const futureReview = createTask({ id: 'task-review', reviewAt: '2026-11-01' });
        const futureStart = createTask({ id: 'task-start', startTime: '2026-11-01T09:00:00.000Z' });
        const undated = createTask({ id: 'task-undated' });

        const items = getStaleItems([futureReview, futureStart, undated], [], 14, now);

        expect(items.map((item) => item.id)).toEqual(['task-undated']);
    });

    it('does not treat a future due date as a deferral', () => {
        const task = createTask({ id: 'task-due', dueDate: '2026-11-01' });

        const items = getStaleItems([task], [], 14, now);

        expect(items.map((item) => item.id)).toEqual(['task-due']);
    });

    it('skips projects explicitly deferred with a future review date', () => {
        const deferred = createProject({ id: 'project-deferred', reviewAt: '2026-11-01' });
        const undated = createProject({ id: 'project-undated' });

        const items = getStaleItems([], [deferred, undated], 14, now);

        expect(items.map((item) => item.id)).toEqual(['project:project-undated']);
    });
});

describe('getWeeklyReviewSummary', () => {
    const freshUpdatedAt = '2026-02-28T00:00:00.000Z';

    it('counts inbox items but excludes deleted and archived-project tasks', () => {
        const activeProject = createProject({ id: 'p-active', status: 'active' });
        const archivedProject = createProject({ id: 'p-archived', status: 'archived' });
        const tasks = [
            createTask({ id: 'inbox-loose', status: 'inbox', projectId: undefined }),
            createTask({ id: 'inbox-active', status: 'inbox', projectId: 'p-active' }),
            createTask({ id: 'inbox-deleted', status: 'inbox', deletedAt: staleUpdatedAt }),
            createTask({ id: 'inbox-archived', status: 'inbox', projectId: 'p-archived' }),
            createTask({ id: 'next-not-inbox', status: 'next' }),
        ];

        const summary = getWeeklyReviewSummary(tasks, [activeProject, archivedProject], now);

        expect(summary.inboxCount).toBe(2);
    });

    it('counts active projects without a live next action', () => {
        const withNext = createProject({ id: 'p-with', status: 'active' });
        const without = createProject({ id: 'p-without', status: 'active' });
        const deletedNextOnly = createProject({ id: 'p-deleted-next', status: 'active' });
        const archived = createProject({ id: 'p-archived', status: 'archived' });
        const tasks = [
            createTask({ id: 't-with', status: 'next', projectId: 'p-with' }),
            createTask({ id: 't-with-inbox', status: 'inbox', projectId: 'p-without' }),
            createTask({ id: 't-deleted-next', status: 'next', projectId: 'p-deleted-next', deletedAt: staleUpdatedAt }),
        ];

        const summary = getWeeklyReviewSummary(tasks, [withNext, without, deletedNextOnly, archived], now);

        expect(summary.activeProjectCount).toBe(3);
        expect(summary.projectsWithoutNextAction).toBe(2);
    });

    it('counts stale waiting items but exempts a future review date', () => {
        const staleWaiting = createTask({ id: 'w-stale', status: 'waiting', updatedAt: staleUpdatedAt });
        const deferredWaiting = createTask({ id: 'w-deferred', status: 'waiting', updatedAt: staleUpdatedAt, reviewAt: '2026-11-01' });
        const freshWaiting = createTask({ id: 'w-fresh', status: 'waiting', updatedAt: freshUpdatedAt });
        const staleNext = createTask({ id: 'n-stale', status: 'next', updatedAt: staleUpdatedAt });

        const summary = getWeeklyReviewSummary([staleWaiting, deferredWaiting, freshWaiting, staleNext], [], now);

        expect(summary.staleWaitingCount).toBe(1);
    });

    it('reports zeros for the no-projects case', () => {
        const summary = getWeeklyReviewSummary([createTask({ id: 'loose-inbox', status: 'inbox' })], [], now);

        expect(summary).toEqual({
            inboxCount: 1,
            activeProjectCount: 0,
            projectsWithoutNextAction: 0,
            staleWaitingCount: 0,
        });
    });
});

describe('partitionByReviewDate', () => {
    it('splits items into due, scheduled, and unscheduled groups', () => {
        const due = createTask({ id: 'task-due', reviewAt: '2026-02-01' });
        const scheduled = createTask({ id: 'task-scheduled', reviewAt: '2026-11-01' });
        const unscheduled = createTask({ id: 'task-unscheduled' });

        const groups = partitionByReviewDate([due, scheduled, unscheduled], now);

        expect(groups.due.map((task) => task.id)).toEqual(['task-due']);
        expect(groups.scheduled.map((task) => task.id)).toEqual(['task-scheduled']);
        expect(groups.unscheduled.map((task) => task.id)).toEqual(['task-unscheduled']);
    });

    it('treats an unparsable review date as unscheduled', () => {
        const broken = createTask({ id: 'task-broken', reviewAt: 'not a date' });

        const groups = partitionByReviewDate([broken], now);

        expect(groups.unscheduled.map((task) => task.id)).toEqual(['task-broken']);
        expect(groups.due).toEqual([]);
        expect(groups.scheduled).toEqual([]);
    });
});

describe('getAdvancedReviewDate', () => {
    const localNow = new Date(2026, 5, 10, 15, 30); // 2026-06-10 15:30 local

    it('returns a date-only value one week out for date-only review dates', () => {
        expect(getAdvancedReviewDate('2026-06-01', localNow)).toBe('2026-06-17');
    });

    it('keeps the original time of day for datetime review dates', () => {
        expect(getAdvancedReviewDate('2026-06-01T09:15', localNow)).toBe('2026-06-17T09:15');
    });

    it('falls back to date-only when the review date is missing or invalid', () => {
        expect(getAdvancedReviewDate(undefined, localNow)).toBe('2026-06-17');
        expect(getAdvancedReviewDate('not a date T00:00', localNow)).toBe('2026-06-17');
    });

    it('advances from now, not from an overdue review date', () => {
        expect(getAdvancedReviewDate('2025-01-01', localNow)).toBe('2026-06-17');
    });

    it('honors a custom day count', () => {
        expect(getAdvancedReviewDate('2026-06-01', localNow, 14)).toBe('2026-06-24');
    });
});

describe('getDailyReviewBuckets', () => {
    const dailyNow = new Date(2026, 2, 1, 9, 0, 0); // 2026-03-01 09:00 local

    it('keeps a next task starting later today in the focus candidates (#867)', () => {
        const laterToday = createTask({
            id: 'next-later-today',
            status: 'next',
            startTime: new Date(2026, 2, 1, 16, 0, 0).toISOString(),
        });

        const buckets = getDailyReviewBuckets([laterToday], [], { now: dailyNow });

        expect(buckets.focusCandidates.map((task) => task.id)).toEqual(['next-later-today']);
    });

    it('defers a next task available tomorrow out of the focus candidates', () => {
        const tomorrow = createTask({
            id: 'next-tomorrow',
            status: 'next',
            availableAt: new Date(2026, 2, 2, 8, 0, 0).toISOString(),
        });

        const buckets = getDailyReviewBuckets([tomorrow], [], { now: dailyNow });

        expect(buckets.focusCandidates).toEqual([]);
    });

    it('defers a recurring task with no start time by its next due/review date (#843)', () => {
        const recurring = createTask({
            id: 'recurring-no-start',
            status: 'next',
            recurrence: { rule: 'daily' },
            dueDate: new Date(2026, 2, 2).toISOString(),
        });

        const buckets = getDailyReviewBuckets([recurring], [], { now: dailyNow });

        expect(buckets.focusCandidates).toEqual([]);
    });

    it('excludes done tasks from every bucket', () => {
        const done = createTask({
            id: 'done-task',
            status: 'done',
            isFocusedToday: true,
            dueDate: new Date(2026, 2, 1).toISOString(),
        });

        const buckets = getDailyReviewBuckets([done], [], { now: dailyNow });

        expect(buckets.focused).toEqual([]);
        expect(buckets.dueToday).toEqual([]);
        expect(buckets.overdue).toEqual([]);
        expect(buckets.focusCandidates).toEqual([]);
    });

    it('keeps only the first task of a sequential project in the focus candidates', () => {
        const project = createProject({ id: 'seq-project', isSequential: true });
        const first = createTask({ id: 'seq-1', status: 'next', projectId: project.id, order: 0 });
        const second = createTask({ id: 'seq-2', status: 'next', projectId: project.id, order: 1 });

        const buckets = getDailyReviewBuckets([first, second], [project], { now: dailyNow });

        expect(buckets.focusCandidates.map((task) => task.id)).toEqual(['seq-1']);
    });

    it('sorts dueToday and overdue using the requested sort order', () => {
        const taskB = createTask({ id: 'b-task', title: 'B task', status: 'next', dueDate: new Date(2026, 2, 1).toISOString() });
        const taskA = createTask({ id: 'a-task', title: 'A task', status: 'next', dueDate: new Date(2026, 2, 1).toISOString() });

        const buckets = getDailyReviewBuckets([taskB, taskA], [], { now: dailyNow, sortBy: 'title' });

        expect(buckets.dueToday.map((task) => task.id)).toEqual(['a-task', 'b-task']);
    });
});

describe('getWeeklyReviewBuckets', () => {
    const weeklyNow = new Date(2026, 2, 1);

    it('splits inbox, waiting and someday tasks and orders due-first projects ahead of future ones', () => {
        const activeProject = createProject({ id: 'p-active', status: 'active' });
        const dueProject = createProject({ id: 'p-due', status: 'active', reviewAt: '2026-02-01' });
        const inbox = createTask({ id: 'inbox-1', status: 'inbox' });
        const waiting = createTask({ id: 'waiting-1', status: 'waiting' });
        const someday = createTask({ id: 'someday-1', status: 'someday' });

        const buckets = getWeeklyReviewBuckets([inbox, waiting, someday], [activeProject, dueProject], { now: weeklyNow });

        expect(buckets.inbox.map((task) => task.id)).toEqual(['inbox-1']);
        expect(buckets.waitingGroups.unscheduled.map((task) => task.id)).toEqual(['waiting-1']);
        expect(buckets.somedayGroups.unscheduled.map((task) => task.id)).toEqual(['someday-1']);
        expect(buckets.orderedProjects.map((project) => project.id)).toEqual(['p-due', 'p-active']);
    });

    it('groups reviewable tasks by context, dropping done/archived/reference tasks', () => {
        const live = createTask({ id: 'live', status: 'next', contexts: ['@errands'] });
        const done = createTask({ id: 'done', status: 'done', contexts: ['@errands'] });

        const buckets = getWeeklyReviewBuckets([live, done], [], { now: weeklyNow });

        expect(buckets.contextGroups).toEqual([{ context: '@errands', tasks: [live] }]);
    });

    it('collects due/start dates within the next 7 days as calendar items', () => {
        const withinWindow = createTask({ id: 'due-soon', status: 'next', dueDate: new Date(2026, 2, 3).toISOString() });
        const outsideWindow = createTask({ id: 'due-later', status: 'next', dueDate: new Date(2026, 2, 20).toISOString() });

        const buckets = getWeeklyReviewBuckets([withinWindow, outsideWindow], [], { now: weeklyNow });

        expect(buckets.calendarItems.map((entry) => entry.task.id)).toEqual(['due-soon']);
    });
});

describe('getExternalCalendarDaySummaries', () => {
    const now = new Date(2026, 2, 1);

    it('groups events by day over the window, dropping empty days', () => {
        const events = [
            {
                id: 'e1', sourceId: 'cal', title: 'Standup', allDay: false,
                start: new Date(2026, 2, 2, 9, 0).toISOString(),
                end: new Date(2026, 2, 2, 9, 30).toISOString(),
            },
        ];

        const summaries = getExternalCalendarDaySummaries(events, 7, now);

        expect(summaries).toHaveLength(1);
        expect(summaries[0].totalCount).toBe(1);
        expect(summaries[0].events[0].id).toBe('e1');
    });
});

describe('buildReviewSteps', () => {
    it('marks the daily today step as having work when a task is due today, and hides focus when disabled', () => {
        const buckets = getDailyReviewBuckets(
            [createTask({ id: 'due-today', status: 'next', dueDate: new Date(2026, 2, 1).toISOString() })],
            [],
            { now: new Date(2026, 2, 1, 9, 0) },
        );

        const steps = buildReviewSteps(buckets, { kind: 'daily', includeFocusStep: false });

        expect(steps.map((step) => step.id)).toEqual(['today', 'inbox', 'waiting', 'completed']);
        expect(steps.find((step) => step.id === 'today')?.hasWork).toBe(true);
    });

    it('does not count a not-yet-due waiting task as work for the weekly waiting step', () => {
        const buckets = getWeeklyReviewBuckets(
            [createTask({ id: 'waiting-later', status: 'waiting', reviewAt: '2026-11-01' })],
            [],
            { now: new Date(2026, 2, 1) },
        );

        const steps = buildReviewSteps(buckets, { kind: 'weekly', includeContextStep: false });

        expect(steps.find((step) => step.id === 'waiting')?.hasWork).toBe(false);
    });
});
