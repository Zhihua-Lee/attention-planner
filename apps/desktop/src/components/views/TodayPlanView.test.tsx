import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useTaskStore, type Task } from '@mindwtr/core';

import { LanguageProvider } from '../../contexts/language-context';
import { TodayPlanView } from './TodayPlanView';

const now = new Date();
const todayAt = (hour: number) => new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    0,
    0,
    0,
).toISOString();

const task = (id: string, title: string, overrides: Partial<Task> = {}): Task => ({
    id,
    title,
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
});

const renderView = () => render(
    <LanguageProvider>
        <TodayPlanView />
    </LanguageProvider>,
);

describe('TodayPlanView', () => {
    beforeEach(() => {
        const tasks = [
            task('commitment', 'Write results', { isFocusedToday: true }),
            task('waiting-commitment', 'Waiting commitment', { status: 'waiting', isFocusedToday: true }),
            task('someday-commitment', 'Someday commitment', { status: 'someday', isFocusedToday: true }),
            task('inbox-commitment', 'Inbox commitment', { status: 'inbox', isFocusedToday: true }),
            task('scheduled', 'Office hours', { scheduledAt: todayAt(13) }),
            task('ready', 'Read paper'),
        ];
        useTaskStore.setState({
            tasks,
            _allTasks: tasks,
            projects: [],
            _allProjects: [],
            areas: [],
            _allAreas: [],
            settings: {},
            error: null,
            highlightTaskId: null,
        });
    });

    it('is a short planning surface, not the legacy Focus cockpit', () => {
        const { getByRole, getByText, queryByRole, queryByText } = renderView();

        expect(getByRole('heading', { name: /today's commitments/i })).toBeInTheDocument();
        expect(getByRole('heading', { name: /time blocks/i })).toBeInTheDocument();
        expect(getByRole('heading', { name: /ready tasks/i })).toBeInTheDocument();
        expect(getByText('Write results')).toBeInTheDocument();
        expect(getByText('Office hours')).toBeInTheDocument();
        expect(getByText('Read paper')).toBeInTheDocument();
        expect(getByText('Waiting commitment')).toBeInTheDocument();
        expect(getByText('Someday commitment')).toBeInTheDocument();
        expect(getByText('Inbox commitment')).toBeInTheDocument();
        expect(queryByRole('button', { name: /^Filters$/i })).not.toBeInTheDocument();
        expect(queryByText(/Pomodoro/i)).not.toBeInTheDocument();
        expect(queryByText(/Review Due/i)).not.toBeInTheDocument();
        expect(queryByText(/Attention rules/i)).not.toBeInTheDocument();
    });

    it('T01/T12: retains future and blocked plans while excluding inactive new candidates', () => {
        const tasks = [
            task('future', 'Tomorrow available', { availableAt: '2099-01-01' }),
            task('blocked', 'Existing blocked plan', { status: 'waiting', scheduledAt: todayAt(14) }),
            task('candidate', 'Paused candidate', { projectId: 'paused' }),
        ];
        useTaskStore.setState({ tasks, _allTasks: tasks, projects: [{ id: 'paused', status: 'waiting' } as never] });
        const { getByText, queryByText } = renderView();
        expect(getByText('Tomorrow available')).toBeInTheDocument();
        expect(getByText('Existing blocked plan')).toBeInTheDocument();
        expect(queryByText('Paused candidate')).not.toBeInTheDocument();
        expect(getByText(/Not available yet/)).toBeInTheDocument();
    });

    it('writes a distinct scheduledAt value from the Ready list', () => {
        const updateTask = vi.fn().mockResolvedValue({ success: true });
        useTaskStore.setState({ updateTask });
        const { getAllByRole, getByLabelText } = renderView();

        const scheduleButtons = getAllByRole('button', { name: 'Schedule' });
        fireEvent.click(scheduleButtons[scheduleButtons.length - 1]);
        fireEvent.change(getByLabelText('Date'), { target: { value: '2026-08-26' } });
        fireEvent.change(getByLabelText('Time'), { target: { value: '14:30' } });
        const confirmButtons = getAllByRole('button', { name: 'Schedule' });
        fireEvent.click(confirmButtons[confirmButtons.length - 1]);

        expect(updateTask).toHaveBeenCalledWith('ready', {
            scheduledAt: new Date('2026-08-26T14:30').toISOString(),
        });
    });

    it('clears both explicit and timed legacy schedule fields when unscheduling', () => {
        const updateTask = vi.fn().mockResolvedValue({ success: true });
        const tasks = [task('scheduled', 'Legacy office hours', {
            scheduledAt: todayAt(13),
            startTime: todayAt(12),
            relativeStartOffset: { amount: -1, unit: 'day' },
        })];
        useTaskStore.setState({ tasks, _allTasks: tasks, updateTask });
        const { getByRole } = renderView();

        fireEvent.click(getByRole('button', { name: 'Remove from calendar' }));

        expect(updateTask).toHaveBeenCalledWith('scheduled', {
            scheduledAt: undefined,
            startTime: undefined,
            relativeStartOffset: undefined,
        });
    });

    it('offers an explicit way to reveal every Ready task after the first twelve', () => {
        const tasks = Array.from({ length: 13 }, (_, index) => (
            task(`ready-${index + 1}`, `Ready task ${index + 1}`)
        ));
        useTaskStore.setState({ tasks, _allTasks: tasks });
        const { getByRole, getByText, queryByText } = renderView();

        expect(queryByText('Ready task 13')).not.toBeInTheDocument();
        fireEvent.click(getByRole('button', { name: 'View all 13 Ready tasks' }));
        expect(getByText('Ready task 13')).toBeInTheDocument();
        expect(getByRole('button', { name: 'Show fewer Ready tasks' })).toBeInTheDocument();
    });
});
