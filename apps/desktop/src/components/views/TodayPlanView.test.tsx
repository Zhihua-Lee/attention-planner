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
        expect(queryByRole('button', { name: /^Filters$/i })).not.toBeInTheDocument();
        expect(queryByText(/Pomodoro/i)).not.toBeInTheDocument();
        expect(queryByText(/Review Due/i)).not.toBeInTheDocument();
        expect(queryByText(/Attention rules/i)).not.toBeInTheDocument();
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
});
