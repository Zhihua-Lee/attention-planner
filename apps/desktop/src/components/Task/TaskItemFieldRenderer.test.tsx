import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { createTaskDraft, setTaskDraftField, taskDraftToUpdatePatch, type Task, type TaskDraft } from '@mindwtr/core';

import {
    TaskItemFieldRenderer,
    type TaskEditorEnv,
    type TaskEditorOptionLists,
} from './TaskItemFieldRenderer';
import { LanguageProvider } from '../../contexts/language-context';

const baseTask: Task = {
    id: 'task-1',
    title: 'Test task',
    status: 'inbox',
    tags: [],
    contexts: [],
    createdAt: '2026-04-13T00:00:00.000Z',
    updatedAt: '2026-04-13T00:00:00.000Z',
};

const t = (key: string) => {
    const labels: Record<string, string> = {
        'common.clear': 'Clear',
        'common.none': 'None',
        'nav.calendar': 'Calendar',
        'calendar.prevMonth': 'Previous month',
        'calendar.nextMonth': 'Next month',
        'task.aria.status': 'Task status',
        'taskEdit.startDateLabel': 'Start Date',
        'taskEdit.dueDateLabel': 'Due Date',
        'taskEdit.reviewDateLabel': 'Review Date',
        'taskEdit.dateOnly': 'Date only',
        'taskEdit.startModeLabel': 'Start mode',
        'taskEdit.startModeAbsolute': 'Absolute',
        'taskEdit.startModeRelative': 'Relative',
        'taskEdit.relativeStartAmount': 'Start lead time',
        'taskEdit.relativeStartUnit': 'Start lead time unit',
        'taskEdit.relativeStartMinutes': 'minutes before due',
        'taskEdit.relativeStartHours': 'hours before due',
        'taskEdit.relativeStartDays': 'days before due',
        'taskEdit.relativeStartWeeks': 'weeks before due',
        'taskEdit.statusLabel': 'Status',
        'taskEdit.priorityLabel': 'Priority',
        'taskEdit.energyLevel': 'Energy Level',
        'taskEdit.contextsLabel': 'Contexts',
        'taskEdit.contextsPlaceholder': 'Add contexts',
        'taskEdit.tagsLabel': 'Tags',
        'taskEdit.tagsPlaceholder': 'Add tags',
        'taskEdit.assignedTo': 'Assigned to',
        'taskEdit.assignedToPlaceholder': 'Delegate to...',
        'people.new': 'New Person',
        'task.aria.startDate': 'Start date',
        'task.aria.startTime': 'Start time',
        'task.aria.dueDate': 'Due date',
        'task.aria.dueTime': 'Due time',
        'task.aria.reviewDate': 'Review date',
        'task.aria.reviewTime': 'Review time',
        'task.aria.contexts': 'Contexts',
        'task.aria.tags': 'Tags',
        'task.aria.description': 'Description',
        'task.aria.location': 'Location',
        'task.aria.recurrence': 'Recurrence',
        'task.dateIssue.startAfterDue': 'Starts after due date',
        'taskEdit.descriptionLabel': 'Description',
        'taskEdit.descriptionPlaceholder': 'Add notes...',
        'taskEdit.locationLabel': 'Location',
        'taskEdit.locationPlaceholder': 'Add location',
        'taskEdit.recurrenceLabel': 'Recurrence',
        'taskEdit.repeatReminderLabel': 'Repeat reminder',
        'taskEdit.repeatReminderOff': 'Off',
        'taskEdit.repeatReminderEveryMinutes': 'Every {count} min',
        'taskEdit.repeatReminderMinutesShort': '{count} min',
        'taskEdit.checklist': 'Checklist',
        'attachments.title': 'Attachments',
        'recurrence.none': 'None',
        'recurrence.daily': 'Daily',
        'recurrence.weekly': 'Weekly',
        'recurrence.monthly': 'Monthly',
        'recurrence.yearly': 'Yearly',
        'recurrence.repeatEvery': 'Repeat every',
        'recurrence.repeatOn': 'Repeat on',
        'recurrence.dayUnit': 'day(s)',
        'recurrence.weekUnit': 'week(s)',
        'recurrence.afterCompletion': 'Repeat after completion',
        'recurrence.yearUnit': 'year(s)',
        'recurrence.endsLabel': 'Ends',
        'recurrence.endsNever': 'Never',
        'recurrence.endsOnDate': 'On date',
        'recurrence.endsAfterCount': 'After',
        'recurrence.occurrenceUnit': 'occurrence(s)',
        'recurrence.monthlyOnDay': 'Monthly on same day',
        'recurrence.custom': 'Custom...',
        'status.inbox': 'Inbox',
        'status.next': 'Next',
        'status.waiting': 'Waiting',
        'status.someday': 'Someday',
        'status.reference': 'Reference',
        'status.done': 'Done',
        'status.archived': 'Archived',
        'priority.low': 'Low',
        'priority.medium': 'Medium',
        'priority.high': 'High',
        'priority.urgent': 'Urgent',
        'energyLevel.low': 'Low energy',
        'energyLevel.medium': 'Medium energy',
        'energyLevel.high': 'High energy',
        'markdown.preview': 'Preview',
        'markdown.edit': 'Edit',
        'markdown.expand': 'Expand',
        'taskEdit.timeSpentLabel': 'Time Spent',
    };
    return labels[key] ?? key;
};

const baseEnv: TaskEditorEnv = {
    t,
    language: 'en',
    dateFormatSetting: 'system',
    nativeDateInputLocale: 'en-US',
    defaultScheduleTime: '',
    timeSpentEnabled: true,
    showObsidianNoteAttachment: true,
};

const baseOptions: TaskEditorOptionLists = {
    allContextOptions: [],
    allTagOptions: [],
    popularContextOptions: [],
    popularTagOptions: [],
    assignedToOptions: [],
};

type RendererProps = Parameters<typeof TaskItemFieldRenderer>[0];

type FixtureOverrides = {
    task?: Task;
    draft?: Partial<TaskDraft>;
    env?: Partial<TaskEditorEnv>;
    options?: Partial<TaskEditorOptionLists>;
    showDescriptionPreview?: boolean;
    descriptionPreview?: Partial<RendererProps['descriptionPreview']>;
    attachments?: Partial<RendererProps['attachments']>;
    actions?: Partial<RendererProps['actions']>;
    setField?: RendererProps['setField'];
};

const createProps = (overrides: FixtureOverrides = {}): Omit<RendererProps, 'fieldId'> => {
    const task = overrides.task ?? baseTask;
    return {
        task,
        draft: { ...createTaskDraft(task), ...overrides.draft },
        setField: overrides.setField ?? vi.fn(),
        monthlyRecurrence: { pattern: 'date', interval: 1 },
        descriptionPreview: {
            visible: overrides.showDescriptionPreview ?? false,
            toggle: vi.fn(),
            editSource: vi.fn(),
            ...overrides.descriptionPreview,
        },
        env: { ...baseEnv, ...overrides.env },
        options: { ...baseOptions, ...overrides.options },
        attachments: {
            attachmentError: null,
            visibleEditAttachments: [],
            addFileAttachment: vi.fn(),
            addLinkAttachment: vi.fn(),
            addObsidianNoteAttachment: vi.fn(),
            editLinkAttachment: vi.fn(),
            openAttachment: vi.fn(),
            removeAttachment: vi.fn(),
            ...overrides.attachments,
        },
        actions: {
            openCustomRecurrence: vi.fn(),
            createAssignedToPerson: vi.fn(),
            updateTask: vi.fn(),
            resetTaskChecklist: vi.fn(),
            ...overrides.actions,
        },
    };
};

/** Field harness with a live draft: setField writes through the core reducer. */
function DraftFieldHarness({
    fieldId,
    initialDraft = {},
    options = {},
}: {
    fieldId: RendererProps['fieldId'];
    initialDraft?: Partial<TaskDraft>;
    options?: Partial<TaskEditorOptionLists>;
}) {
    const [draft, setDraft] = useState<TaskDraft>(() => ({ ...createTaskDraft(baseTask), ...initialDraft }));

    return (
        <TaskItemFieldRenderer
            fieldId={fieldId}
            {...createProps({ options })}
            draft={draft}
            setField={(field, value) => setDraft((current) => setTaskDraftField(current, field, value))}
        />
    );
}

function DescriptionHarness() {
    return <DraftFieldHarness fieldId="description" />;
}

function DescriptionPreviewHarness() {
    const [showDescriptionPreview, setShowDescriptionPreview] = useState(true);

    return (
        <TaskItemFieldRenderer
            fieldId="description"
            {...createProps({
                draft: { description: '**Project notes**' },
                showDescriptionPreview,
                descriptionPreview: {
                    editSource: () => setShowDescriptionPreview(false),
                },
            })}
        />
    );
}

function ContextAutocompleteHarness({
    initialValue = '',
    allContextOptions = ['@computer', '@phone'],
    popularContextOptions = [],
}: {
    initialValue?: string;
    allContextOptions?: string[];
    popularContextOptions?: string[];
} = {}) {
    return (
        <DraftFieldHarness
            fieldId="contexts"
            initialDraft={{ contexts: initialValue }}
            options={{ allContextOptions, popularContextOptions }}
        />
    );
}

function TagAutocompleteHarness() {
    return (
        <DraftFieldHarness
            fieldId="tags"
            options={{ allTagOptions: ['#music', '#mindwtr'], popularTagOptions: [] }}
        />
    );
}

const selectTextareaRange = (textarea: HTMLTextAreaElement, start: number, end: number) => {
    fireEvent.focus(textarea);
    textarea.setSelectionRange(start, end);
};

function AssignedToAutocompleteHarness() {
    return (
        <DraftFieldHarness
            fieldId="assignedTo"
            options={{ assignedToOptions: ['Alex', 'Jordan'] }}
        />
    );
}

describe('TaskItemFieldRenderer date clear buttons', () => {
    afterEach(() => {
        cleanup();
    });

    it('R2: edits the explicit reservation independently from availability and legacy start', () => {
        const setField = vi.fn();
        const { getByLabelText } = render(<TaskItemFieldRenderer fieldId="startTime" {...createProps({
            task: { ...baseTask, availableAt: '2026-09-07', scheduledAt: '2026-09-07T11:00:00', startTime: '2026-09-07T09:00:00' },
            setField,
        })} />);
        const input = getByLabelText('Time block');
        expect(input).toHaveValue('2026-09-07T11:00');
        fireEvent.change(input, { target: { value: '2026-09-07T13:00' } });
        expect(setField).toHaveBeenCalledWith('scheduledAt', '2026-09-07T13:00');
        expect(setField).not.toHaveBeenCalledWith('startTime', expect.anything());
        expect(setField).not.toHaveBeenCalledWith('availableAt', expect.anything());
    });

    it('edits the location field through the configurable renderer', () => {
        const setField = vi.fn();

        const { getByLabelText } = render(
            <TaskItemFieldRenderer
                fieldId="location"
                {...createProps({ draft: { location: 'Office' }, setField })}
            />
        );

        const input = getByLabelText('Location');
        expect(input).toHaveValue('Office');

        fireEvent.change(input, { target: { value: 'Home' } });

        expect(setField).toHaveBeenCalledWith('location', 'Home');
    });

    it.each([
        ['dueDate' as const, 'Due Date'],
        ['status' as const, 'Status'],
        ['description' as const, 'Description'],
        ['recurrence' as const, 'Recurrence'],
        ['attachments' as const, 'Attachments'],
        ['checklist' as const, 'Checklist'],
        ['location' as const, 'Location'],
    ])('uses stronger weight for the %s field label without changing label size', (fieldId, label) => {
        const { getByText } = render(
            <TaskItemFieldRenderer
                fieldId={fieldId}
                {...createProps()}
            />
        );

        expect(getByText(label)).toHaveClass('text-xs', 'font-semibold');
        expect(getByText(label)).not.toHaveClass('font-medium');
    });

    it('shows a date-coherence note on conflicting start and due date fields', () => {
        const props = createProps({
            draft: {
                availableAt: '2026-04-25',
                dueDate: '2026-04-24',
            },
        });

        const { getByText, rerender } = render(
            <TaskItemFieldRenderer
                fieldId="startTime"
                {...props}
            />
        );

        expect(getByText('Starts after due date')).toBeInTheDocument();

        rerender(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...props}
            />
        );

        expect(getByText('Starts after due date')).toBeInTheDocument();
    });

    it.each([
        {
            fieldId: 'startTime' as const,
            draftValue: { availableAt: '2026-04-18T09:30' },
            clearLabel: 'Clear Available from',
            draftKey: 'availableAt' as const,
        },
        {
            fieldId: 'dueDate' as const,
            draftValue: { dueDate: '2026-04-19T11:45' },
            clearLabel: 'Clear Due Date',
            draftKey: 'dueDate' as const,
        },
        {
            fieldId: 'reviewAt' as const,
            draftValue: { reviewAt: '2026-04-20T14:15' },
            clearLabel: 'Clear Review Date',
            draftKey: 'reviewAt' as const,
        },
    ])('clears $fieldId when the clear button is clicked', ({ fieldId, draftValue, clearLabel, draftKey }) => {
        const setField = vi.fn();

        const { getByRole } = render(
            <TaskItemFieldRenderer
                fieldId={fieldId}
                {...createProps({ draft: draftValue, setField })}
            />
        );

        fireEvent.click(getByRole('button', { name: clearLabel }));

        expect(setField).toHaveBeenCalledWith(draftKey, '');
    });

    it('hides the clear button when the date field is empty', () => {
        const { queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps()}
            />
        );

        expect(queryByRole('button', { name: 'Clear Due Date' })).toBeNull();
    });

    it.each([
        {
            fieldId: 'startTime' as const,
            draftValue: { availableAt: '2026-04-18T09:30' },
            dateOnlyLabel: 'Date only: Available from',
            draftKey: 'availableAt' as const,
            expected: '2026-04-18',
        },
        {
            fieldId: 'dueDate' as const,
            draftValue: { dueDate: '2026-04-19T11:45' },
            dateOnlyLabel: 'Date only: Due Date',
            draftKey: 'dueDate' as const,
            expected: '2026-04-19',
        },
        {
            fieldId: 'reviewAt' as const,
            draftValue: { reviewAt: '2026-04-20T14:15' },
            dateOnlyLabel: 'Date only: Review Date',
            draftKey: 'reviewAt' as const,
            expected: '2026-04-20',
        },
    ])('strips the time from $fieldId when the date-only button is clicked', ({ fieldId, draftValue, dateOnlyLabel, draftKey, expected }) => {
        const setField = vi.fn();

        const { getByRole } = render(
            <TaskItemFieldRenderer
                fieldId={fieldId}
                {...createProps({ draft: draftValue, setField })}
            />
        );

        fireEvent.click(getByRole('button', { name: dateOnlyLabel }));

        expect(setField).toHaveBeenCalledWith(draftKey, expected);
    });

    it('hides the date-only button when the due date has no time component', () => {
        const { queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps({ draft: { dueDate: '2026-04-19' } })}
            />
        );

        expect(queryByRole('button', { name: 'Date only: Due Date' })).toBeNull();
    });

    it('collapses due-date repeat reminder options until the compact row is opened', () => {
        const setField = vi.fn();

        const { getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps({ draft: { dueDate: '2026-04-19T11:45' }, setField })}
            />
        );

        expect(queryByRole('combobox', { name: 'Repeat reminder' })).toBeNull();
        const collapsedRow = getByRole('button', { name: 'Repeat reminder: Off' });

        fireEvent.click(collapsedRow);
        fireEvent.click(getByRole('button', { name: '10 min' }));

        expect(setField).toHaveBeenCalledWith('repeatReminderMinutes', 10);
    });

    it('applies the configured locale to native date and time inputs', () => {
        const { getByLabelText } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps({
                    draft: { dueDate: '2026-04-19T11:45' },
                    env: { nativeDateInputLocale: 'en-CA-u-hc-h23-fw-mon' },
                })}
            />
        );

        expect(getByLabelText('Due date')).toHaveAttribute('lang', 'en-CA-u-hc-h23-fw-mon');
        expect(getByLabelText('Due time')).toHaveAttribute('lang', 'en-CA-u-hc-h23-fw-mon');
    });

    it('applies the default schedule time when a due date is selected without an existing time', () => {
        const setField = vi.fn();

        const { getByLabelText } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps({ env: { defaultScheduleTime: '09:00' }, setField })}
            />
        );

        fireEvent.change(getByLabelText('Due date'), { target: { value: '2026-04-19' } });

        expect(setField).toHaveBeenCalledWith('dueDate', '2026-04-19T09:00');
    });

    it.each([
        {
            dateFormatSetting: 'dmy',
            nativeDateInputLocale: 'en-GB-u-fw-mon',
            initialDisplay: '19/04/2026',
            nextDisplay: '20/04/2026',
            expectedDate: '2026-04-20',
        },
        {
            dateFormatSetting: 'mdy',
            nativeDateInputLocale: 'en-US-u-fw-sun',
            initialDisplay: '04/19/2026',
            nextDisplay: '04/20/2026',
            expectedDate: '2026-04-20',
        },
        {
            dateFormatSetting: 'ymd',
            nativeDateInputLocale: 'en-CA-u-fw-mon',
            initialDisplay: '2026-04-19',
            nextDisplay: '2026-04-20',
            expectedDate: '2026-04-20',
        },
    ])(
        'formats and parses date text using the $dateFormatSetting date format setting',
        ({ dateFormatSetting, nativeDateInputLocale, initialDisplay, nextDisplay, expectedDate }) => {
            const setField = vi.fn();

            const { getByLabelText } = render(
                <TaskItemFieldRenderer
                    fieldId="dueDate"
                    {...createProps({
                        draft: { dueDate: '2026-04-19' },
                        env: { dateFormatSetting, nativeDateInputLocale },
                        setField,
                    })}
                />
            );

            const input = getByLabelText('Due date') as HTMLInputElement;

            expect(input.value).toBe(initialDisplay);

            fireEvent.change(input, { target: { value: nextDisplay } });

            expect(setField).toHaveBeenCalledWith('dueDate', expectedDate);
        }
    );

    it.each([
        {
            fieldId: 'startTime' as const,
            draftValue: { availableAt: '2026-04-18' },
            inputLabel: 'Start date',
            dialogLabel: 'Available from Calendar',
        },
        {
            fieldId: 'dueDate' as const,
            draftValue: { dueDate: '2026-04-19' },
            inputLabel: 'Due date',
            dialogLabel: 'Due Date Calendar',
        },
        {
            fieldId: 'reviewAt' as const,
            draftValue: { reviewAt: '2026-04-20' },
            inputLabel: 'Review date',
            dialogLabel: 'Review Date Calendar',
        },
    ])('closes the $fieldId mini calendar when clicking outside', ({ fieldId, draftValue, dialogLabel }) => {
        const { getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId={fieldId}
                {...createProps({ draft: draftValue })}
            />
        );

        fireEvent.click(getByRole('button', { name: dialogLabel }));
        expect(getByRole('dialog', { name: dialogLabel })).toBeInTheDocument();

        fireEvent.mouseDown(document.body);

        expect(queryByRole('dialog', { name: dialogLabel })).not.toBeInTheDocument();
    });

    it('sets the date and closes the mini calendar when a day is selected', () => {
        const setField = vi.fn();

        const { getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps({ draft: { dueDate: '2026-04-12' }, setField })}
            />
        );

        fireEvent.click(getByRole('button', { name: 'Due Date Calendar' }));
        const dialog = getByRole('dialog', { name: 'Due Date Calendar' });

        fireEvent.click(within(dialog).getByRole('button', { name: /April 19, 2026/i }));

        expect(setField).toHaveBeenCalledWith('dueDate', '2026-04-19');
        expect(queryByRole('dialog', { name: 'Due Date Calendar' })).not.toBeInTheDocument();
        expect(dialog).not.toBeInTheDocument();
    });

    it('does not render quick-date suggestions when the date input receives focus', () => {
        const { getByLabelText, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps({ draft: { dueDate: '2026-04-12' } })}
            />
        );

        fireEvent.focus(getByLabelText('Due date'));

        // Suggestions now live only inside the fixed calendar popover, so focusing
        // the field must not mount anything that shifts the editor layout (#901).
        expect(queryByRole('dialog', { name: 'Due Date Calendar' })).not.toBeInTheDocument();
        expect(queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
        expect(queryByRole('button', { name: 'Next month' })).not.toBeInTheDocument();
    });

    // The calendar glyph is a small target, so clicking the text part of the field
    // opens the popover too (#896). Focus alone still must not — see the test above,
    // which keeps tabbing through the editor from popping calendars open.
    it('opens the calendar popover when the date input itself is clicked', () => {
        const { getByLabelText, getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps({ draft: { dueDate: '2026-04-12' } })}
            />
        );

        expect(queryByRole('dialog', { name: 'Due Date Calendar' })).not.toBeInTheDocument();

        fireEvent.click(getByLabelText('Due date'));

        expect(getByRole('dialog', { name: 'Due Date Calendar' })).toBeInTheDocument();
    });

    // step=5 made the browser report stepMismatch for any minute count off the
    // grid, so entering 7 minutes was flagged invalid (#896).
    it('accepts a Time Spent value that is not a multiple of five', () => {
        // The live-draft harness is required here: with a no-op setField the
        // controlled input never actually holds 7, and an empty value reports no
        // stepMismatch, so the assertion would pass no matter what step is set to.
        const { getByLabelText } = render(<DraftFieldHarness fieldId="timeEstimate" />);

        const input = getByLabelText('Time Spent') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '7' } });
        expect(input.value).toBe('7');

        expect(input.validity.stepMismatch).toBe(false);
        expect(input.validity.valid).toBe(true);
    });

    it('shows the quick-date suggestions inside the calendar popover', () => {
        const { getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps({ draft: { dueDate: '2026-04-12' } })}
            />
        );

        expect(queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();

        fireEvent.click(getByRole('button', { name: 'Due Date Calendar' }));

        const dialog = getByRole('dialog', { name: 'Due Date Calendar' });
        expect(within(dialog).getByRole('button', { name: 'Today' })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: '+2 days' })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Next month' })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'No date' })).toBeInTheDocument();
    });

    it('keeps the mini calendar closed after selecting a date from another month', async () => {
        const setField = vi.fn();

        const { getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps({ draft: { dueDate: '2026-04-12' }, setField })}
            />
        );

        fireEvent.click(getByRole('button', { name: 'Due Date Calendar' }));
        const dialog = getByRole('dialog', { name: 'Due Date Calendar' });
        const nextMonthButton = within(dialog).getByRole('button', { name: 'Calendar: Next month' });
        fireEvent.click(nextMonthButton);

        const updatedDialog = getByRole('dialog', { name: 'Due Date Calendar' });
        fireEvent.click(
            within(updatedDialog).getByRole('button', { name: /May 19, 2026/i })
        );
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        expect(setField).toHaveBeenCalledWith('dueDate', '2026-05-19');
        await waitFor(() => {
            expect(queryByRole('dialog', { name: 'Due Date Calendar' })).not.toBeInTheDocument();
        });
    });

    it.each([
        {
            fieldId: 'startTime' as const,
            calendarLabel: 'Available from',
            draftKey: 'availableAt' as const,
        },
        {
            fieldId: 'dueDate' as const,
            calendarLabel: 'Due Date',
            draftKey: 'dueDate' as const,
        },
        {
            fieldId: 'reviewAt' as const,
            calendarLabel: 'Review Date',
            draftKey: 'reviewAt' as const,
        },
    ])('applies the Tomorrow suggestion from the $fieldId popover and closes it', ({ fieldId, calendarLabel, draftKey }) => {
        const setField = vi.fn();

        const { getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId={fieldId}
                {...createProps({ setField })}
            />
        );

        fireEvent.click(getByRole('button', { name: `${calendarLabel} Calendar` }));
        const dialog = getByRole('dialog', { name: `${calendarLabel} Calendar` });
        const tomorrowButton = within(dialog).getByRole('button', { name: 'Tomorrow' });
        fireEvent.mouseDown(tomorrowButton);
        fireEvent.click(tomorrowButton);

        const tomorrow = new Date();
        tomorrow.setHours(0, 0, 0, 0);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const pad = (value: number) => String(value).padStart(2, '0');
        const expected = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

        expect(setField).toHaveBeenCalledWith(draftKey, expected);
        expect(queryByRole('dialog', { name: `${calendarLabel} Calendar` })).not.toBeInTheDocument();
    });

    it('clears the date when the No date suggestion is chosen from the popover', () => {
        const setField = vi.fn();

        const { getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps({ draft: { dueDate: '2026-04-12' }, setField })}
            />
        );

        fireEvent.click(getByRole('button', { name: 'Due Date Calendar' }));
        const dialog = getByRole('dialog', { name: 'Due Date Calendar' });
        const noDateButton = within(dialog).getByRole('button', { name: 'No date' });
        fireEvent.mouseDown(noDateButton);
        fireEvent.click(noDateButton);

        expect(setField).toHaveBeenCalledWith('dueDate', '');
        expect(queryByRole('dialog', { name: 'Due Date Calendar' })).not.toBeInTheDocument();
    });

    it('closes the calendar popover when a pointer press lands outside the field', async () => {
        const { getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps()}
            />
        );

        fireEvent.click(getByRole('button', { name: 'Due Date Calendar' }));
        expect(getByRole('dialog', { name: 'Due Date Calendar' })).toBeInTheDocument();

        act(() => {
            document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        });

        await waitFor(() => {
            expect(queryByRole('dialog', { name: 'Due Date Calendar' })).not.toBeInTheDocument();
        });
    });

    it('closes the calendar popover on a keyboard blur', async () => {
        const { getByLabelText, getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="dueDate"
                {...createProps()}
            />
        );

        fireEvent.focus(getByLabelText('Due date'));
        fireEvent.keyDown(getByLabelText('Due date'), { key: 'ArrowDown' });
        expect(getByRole('dialog', { name: 'Due Date Calendar' })).toBeInTheDocument();

        // No pointer press is in flight, so the teardown runs on the next-tick
        // timeout rather than waiting for a pointerup that will never come.
        fireEvent.blur(getByLabelText('Due date'));
        await waitFor(() => {
            expect(queryByRole('dialog', { name: 'Due Date Calendar' })).not.toBeInTheDocument();
        });
    });

    it('renders status choices as pills and keeps archived available', () => {
        const setField = vi.fn();

        const { getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="status"
                {...createProps({ setField })}
            />
        );

        expect(queryByRole('combobox', { name: 'Task status' })).toBeNull();
        expect(getByRole('group', { name: 'Task status' })).toBeInTheDocument();
        const selectedStatus = getByRole('button', { name: 'Inbox' });
        expect(selectedStatus).toHaveAttribute('aria-pressed', 'true');
        expect(selectedStatus).toHaveClass('bg-primary', 'text-primary-foreground');
        expect(getByRole('button', { name: 'Archived' })).toBeInTheDocument();

        fireEvent.click(getByRole('button', { name: 'Waiting' }));

        expect(setField).toHaveBeenCalledWith('status', 'waiting');
    });

    it('changes status pill choices with arrow keys', () => {
        const setField = vi.fn();

        const { getByRole } = render(
            <TaskItemFieldRenderer
                fieldId="status"
                {...createProps({ setField })}
            />
        );

        const inboxButton = getByRole('button', { name: 'Inbox' });
        inboxButton.focus();
        fireEvent.keyDown(inboxButton, { key: 'ArrowDown' });

        expect(getByRole('button', { name: 'Next' })).toHaveFocus();
        expect(setField).toHaveBeenCalledWith('status', 'next');
    });

    it('requests a completion time when the Done status pill is right-clicked', () => {
        const setField = vi.fn();
        const requestBackdatedComplete = vi.fn();
        const { getByRole } = render(
            <TaskItemFieldRenderer
                fieldId="status"
                {...createProps({
                    setField,
                    actions: { requestBackdatedComplete },
                })}
            />
        );

        fireEvent.contextMenu(getByRole('button', { name: 'Done' }));

        expect(requestBackdatedComplete).toHaveBeenCalledTimes(1);
        expect(setField).not.toHaveBeenCalled();
    });

    it('renders priority choices as pills including None', () => {
        const setField = vi.fn();

        const { getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="priority"
                {...createProps({ draft: { priority: 'low' }, setField })}
            />
        );

        expect(queryByRole('combobox', { name: 'Priority' })).toBeNull();
        expect(getByRole('group', { name: 'Priority' })).toBeInTheDocument();
        const selectedPriority = getByRole('button', { name: 'Low' });
        expect(selectedPriority).toHaveAttribute('aria-pressed', 'true');
        expect(selectedPriority).toHaveClass('bg-primary', 'text-primary-foreground');

        fireEvent.click(getByRole('button', { name: 'None' }));

        expect(setField).toHaveBeenCalledWith('priority', '');
    });

    it('renders energy level choices as pills including None', () => {
        const setField = vi.fn();

        const { getByRole, queryByRole } = render(
            <TaskItemFieldRenderer
                fieldId="energyLevel"
                {...createProps({ draft: { energyLevel: 'medium' }, setField })}
            />
        );

        expect(queryByRole('combobox', { name: 'Energy Level' })).toBeNull();
        expect(getByRole('group', { name: 'Energy Level' })).toBeInTheDocument();
        const selectedEnergyLevel = getByRole('button', { name: 'Medium energy' });
        expect(selectedEnergyLevel).toHaveAttribute('aria-pressed', 'true');
        expect(selectedEnergyLevel).toHaveClass('bg-primary', 'text-primary-foreground');

        fireEvent.click(getByRole('button', { name: 'High energy' }));

        expect(setField).toHaveBeenCalledWith('energyLevel', 'high');
    });

    it('emphasizes selected context tokens', () => {
        const setField = vi.fn();

        const { getByRole } = render(
            <TaskItemFieldRenderer
                fieldId="contexts"
                {...createProps({
                    draft: { contexts: 'Home' },
                    options: { popularContextOptions: ['Home', 'Office'] },
                    setField,
                })}
            />
        );

        expect(getByRole('button', { name: 'Home' })).toHaveClass('bg-primary', 'text-primary-foreground');

        fireEvent.click(getByRole('button', { name: 'Office' }));

        expect(setField).toHaveBeenCalledWith('contexts', 'Home, Office');
    });

    it('emphasizes selected tag tokens', () => {
        const setField = vi.fn();

        const { getByRole } = render(
            <TaskItemFieldRenderer
                fieldId="tags"
                {...createProps({
                    draft: { tags: 'Launch' },
                    options: { popularTagOptions: ['Launch', 'Follow-up'] },
                    setField,
                })}
            />
        );

        expect(getByRole('button', { name: 'Launch' })).toHaveClass('bg-primary', 'text-primary-foreground');

        fireEvent.click(getByRole('button', { name: 'Follow-up' }));

        expect(setField).toHaveBeenCalledWith('tags', 'Launch, Follow-up');
    });

    it('suggests existing contexts while typing without requiring @', async () => {
        const { findByRole, getByRole } = render(<ContextAutocompleteHarness />);
        const input = getByRole('textbox', { name: 'Contexts' });

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'computer' } });

        expect(await findByRole('option', { name: '@computer' })).toBeInTheDocument();

        fireEvent.keyDown(input, { key: 'Enter' });

        expect(input).toHaveValue('@computer');
    });

    it('suggests visible context chips after a comma when the full option list is empty', async () => {
        const { findByRole, getByRole } = render(
            <ContextAutocompleteHarness
                initialValue="@health, com"
                allContextOptions={[]}
                popularContextOptions={['@computer']}
            />
        );
        const input = getByRole('textbox', { name: 'Contexts' }) as HTMLInputElement;
        input.setSelectionRange(input.value.length, input.value.length);

        fireEvent.focus(input);

        expect(await findByRole('option', { name: '@computer' })).toBeInTheDocument();

        fireEvent.keyDown(input, { key: 'Enter' });

        expect(input).toHaveValue('@health, @computer');
    });

    it('treats a space after a completed prefixed context as a new token query', async () => {
        const { findByRole, getByRole } = render(
            <ContextAutocompleteHarness initialValue="@health comp" />
        );
        const input = getByRole('textbox', { name: 'Contexts' }) as HTMLInputElement;
        input.setSelectionRange(input.value.length, input.value.length);

        fireEvent.focus(input);

        expect(await findByRole('option', { name: '@computer' })).toBeInTheDocument();

        fireEvent.keyDown(input, { key: 'Enter' });

        expect(input).toHaveValue('@health, @computer');
    });

    it('lets keyboard navigation choose between existing tag suggestions', async () => {
        const { findByRole, getByRole } = render(<TagAutocompleteHarness />);
        const input = getByRole('textbox', { name: 'Tags' });

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'm' } });

        expect(await findByRole('option', { name: '#music' })).toBeInTheDocument();
        expect(await findByRole('option', { name: '#mindwtr' })).toBeInTheDocument();

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(input).toHaveValue('#mindwtr');
    });

    it('suggests existing assignees in the assigned-to field', async () => {
        const { findByRole, getByRole } = render(<AssignedToAutocompleteHarness />);
        const input = getByRole('textbox', { name: 'Assigned to' });

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'ale' } });

        expect(await findByRole('option', { name: 'Alex' })).toBeInTheDocument();

        fireEvent.keyDown(input, { key: 'Enter' });

        expect(input).toHaveValue('Alex');
    });

    it('offers to create an assignee from an unmatched assigned-to value', async () => {
        const createAssignedToPerson = vi.fn();
        const { findByRole, getByRole } = render(
            <TaskItemFieldRenderer
                fieldId="assignedTo"
                {...createProps({
                    draft: { assignedTo: 'Morgan' },
                    options: { assignedToOptions: ['Alex'] },
                    actions: { createAssignedToPerson },
                })}
            />
        );

        const input = getByRole('textbox', { name: 'Assigned to' });
        fireEvent.focus(input);

        fireEvent.click(await findByRole('option', { name: 'New Person: Morgan' }));

        expect(createAssignedToPerson).toHaveBeenCalledWith('Morgan');
    });

    it('updates weekly recurrence intervals without dropping selected weekdays', () => {
        const setField = vi.fn();
        const { container, getByRole } = render(
            <LanguageProvider>
                <TaskItemFieldRenderer
                    fieldId="recurrence"
                    {...createProps({
                        draft: {
                            recurrence: 'weekly',
                            recurrenceRRule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
                        },
                        setField,
                    })}
                />
            </LanguageProvider>
        );
        const input = container.querySelector('input[type="number"]') as HTMLInputElement | null;

        expect(input).toBeTruthy();
        fireEvent.change(input!, { target: { value: '78' } });

        expect(setField).toHaveBeenCalledWith('recurrenceRRule', 'FREQ=WEEKLY;INTERVAL=78;BYDAY=TU');

        fireEvent.click(getByRole('button', { name: 'Wed' }));

        expect(setField).toHaveBeenCalledWith('recurrenceRRule', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,WE');
    });

    it('updates yearly recurrence intervals', () => {
        const setField = vi.fn();
        const { container } = render(
            <LanguageProvider>
                <TaskItemFieldRenderer
                    fieldId="recurrence"
                    {...createProps({
                        draft: {
                            recurrence: 'yearly',
                            recurrenceRRule: 'FREQ=YEARLY',
                        },
                        setField,
                    })}
                />
            </LanguageProvider>
        );
        const input = container.querySelector('input[type="number"]') as HTMLInputElement | null;

        expect(input).toBeTruthy();
        fireEvent.change(input!, { target: { value: '2' } });

        expect(setField).toHaveBeenCalledWith('recurrenceRRule', 'FREQ=YEARLY;INTERVAL=2');
    });

    it('updates monthly recurrence intervals from the monthly recurrence controls', () => {
        const setField = vi.fn();
        const { container } = render(
            <LanguageProvider>
                <TaskItemFieldRenderer
                    fieldId="recurrence"
                    {...createProps({
                        draft: {
                            recurrence: 'monthly',
                            recurrenceRRule: 'FREQ=MONTHLY;BYMONTHDAY=15',
                        },
                        setField,
                    })}
                />
            </LanguageProvider>
        );
        const input = container.querySelector('input[type="number"]') as HTMLInputElement | null;

        expect(input).toBeTruthy();
        fireEvent.change(input!, { target: { value: '3' } });

        expect(setField).toHaveBeenCalledWith('recurrenceRRule', 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15');
    });

    it('undoes markdown description edits with Ctrl+Z', async () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;

        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        fireEvent.change(textarea, { target: { value: 'First draft' } });

        expect(textarea.value).toBe('First draft');

        fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });

        await waitFor(() => {
            expect(textarea.value).toBe('');
        });
    });

    it('restores the description caret after Ctrl+Z undo', async () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;
        const original = 'Line one\nLine two\nLine three';
        const insertionPoint = original.indexOf('Line three');

        fireEvent.change(textarea, {
            target: {
                value: original,
                selectionStart: insertionPoint,
                selectionEnd: insertionPoint,
            },
        });
        fireEvent.change(textarea, {
            target: {
                value: `${original.slice(0, insertionPoint)}extra ${original.slice(insertionPoint)}`,
                selectionStart: insertionPoint + 'extra '.length,
                selectionEnd: insertionPoint + 'extra '.length,
            },
        });
        const selectionSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange');

        try {
            fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });

            await waitFor(() => {
                expect(textarea).toHaveValue(original);
                expect(selectionSpy).toHaveBeenCalledWith(insertionPoint, insertionPoint);
            });
        } finally {
            selectionSpy.mockRestore();
        }
    });

    it('keeps the description textarea height stable when focused', () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;
        Object.defineProperty(textarea, 'scrollHeight', {
            configurable: true,
            value: 80,
        });

        fireEvent.focus(textarea);

        expect(textarea.style.height).toBe('112px');
    });

    it('enables native spell checking for inline description edits', () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' });

        expect(textarea).toHaveAttribute('spellcheck', 'true');
    });

    it('wraps selected description text when a backtick key press is intercepted', async () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;

        fireEvent.change(textarea, { target: { value: 'run tests' } });
        selectTextareaRange(textarea, 0, 9);
        fireEvent.keyDown(textarea, { key: '`' });

        await waitFor(() => {
            expect(textarea).toHaveValue('`run tests`');
            expect(textarea.selectionStart).toBe(1);
            expect(textarea.selectionEnd).toBe(10);
        });
    });

    it('keeps repeated description backticks on the selected text when the textarea selection briefly collapses', async () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;

        fireEvent.change(textarea, { target: { value: 'run tests' } });
        selectTextareaRange(textarea, 0, 9);
        fireEvent.keyDown(textarea, { key: '`' });

        await waitFor(() => {
            expect(textarea).toHaveValue('`run tests`');
        });

        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        fireEvent.keyDown(textarea, { key: '`' });

        await waitFor(() => {
            expect(textarea).toHaveValue('``run tests``');
        });

        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        fireEvent.keyDown(textarea, { key: '`' });

        await waitFor(() => {
            expect(textarea).toHaveValue('```\nrun tests\n```');
            expect(textarea.selectionStart).toBe(4);
            expect(textarea.selectionEnd).toBe(13);
        });
    });

    it('wraps selected description text when a tilde key press is intercepted', async () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;

        fireEvent.change(textarea, { target: { value: 'drop this' } });
        selectTextareaRange(textarea, 0, 9);
        fireEvent.keyDown(textarea, { key: '~' });

        await waitFor(() => {
            expect(textarea).toHaveValue('~~drop this~~');
            expect(textarea.selectionStart).toBe(2);
            expect(textarea.selectionEnd).toBe(11);
        });
    });

    it('wraps selected description text when native input replaces it with a backtick', async () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;

        fireEvent.change(textarea, {
            target: { value: 'run tests', selectionStart: 0, selectionEnd: 9 },
        });
        fireEvent.change(textarea, { target: { value: '`' } });

        await waitFor(() => {
            expect(textarea).toHaveValue('`run tests`');
            expect(textarea.selectionStart).toBe(1);
            expect(textarea.selectionEnd).toBe(10);
        });
    });

    it('wraps selected description text when native input replaces it with a tilde', async () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;

        fireEvent.change(textarea, {
            target: { value: 'drop this', selectionStart: 0, selectionEnd: 9 },
        });
        fireEvent.change(textarea, { target: { value: '~' } });

        await waitFor(() => {
            expect(textarea).toHaveValue('~~drop this~~');
            expect(textarea.selectionStart).toBe(2);
            expect(textarea.selectionEnd).toBe(11);
        });
    });

    it('wraps selected description text in a fenced code block when triple backticks replace it', async () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;

        fireEvent.change(textarea, {
            target: { value: 'run tests', selectionStart: 0, selectionEnd: 9 },
        });
        fireEvent.change(textarea, { target: { value: '```' } });

        await waitFor(() => {
            expect(textarea).toHaveValue('```\nrun tests\n```');
            expect(textarea.selectionStart).toBe(4);
            expect(textarea.selectionEnd).toBe(13);
        });
    });

    it('creates a fenced code block when three backticks are typed in an empty description', async () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;

        fireEvent.keyDown(textarea, { key: '`' });

        await waitFor(() => {
            expect(textarea).toHaveValue('``');
            expect(textarea.selectionStart).toBe(1);
            expect(textarea.selectionEnd).toBe(1);
        });

        fireEvent.keyDown(textarea, { key: '`' });

        await waitFor(() => {
            expect(textarea).toHaveValue('``');
            expect(textarea.selectionStart).toBe(2);
            expect(textarea.selectionEnd).toBe(2);
        });

        fireEvent.keyDown(textarea, { key: '`' });

        await waitFor(() => {
            expect(textarea).toHaveValue('```\n\n```');
            expect(textarea.selectionStart).toBe(4);
            expect(textarea.selectionEnd).toBe(4);
        });
    });

    it('keeps focus and selection in the expanded description editor after continuing a list', async () => {
        const { getByRole } = render(<DescriptionHarness />);
        const collapsedTextarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;

        fireEvent.change(collapsedTextarea, { target: { value: '- item' } });
        fireEvent.click(getByRole('button', { name: 'Expand' }));

        const dialog = getByRole('dialog');
        const expandedTextarea = within(dialog).getByRole('textbox') as HTMLTextAreaElement;

        await waitFor(() => {
            expect(expandedTextarea).toHaveFocus();
        });

        expandedTextarea.setSelectionRange(expandedTextarea.value.length, expandedTextarea.value.length);
        fireEvent.keyDown(expandedTextarea, { key: 'Enter' });

        await waitFor(() => {
            expect(expandedTextarea).toHaveValue('- item\n- ');
            expect(expandedTextarea).toHaveFocus();
            expect(expandedTextarea.selectionStart).toBe(9);
            expect(expandedTextarea.selectionEnd).toBe(9);
        });
        expect(collapsedTextarea).not.toHaveFocus();
    });

    it('scrolls the description textarea to keep a continued list marker visible', async () => {
        const { getByRole } = render(<DescriptionHarness />);
        const textarea = getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;
        const list = Array.from({ length: 20 }, (_, index) => `- item ${index + 1}`).join('\n');

        Object.defineProperty(textarea, 'clientHeight', {
            configurable: true,
            value: 48,
        });
        Object.defineProperty(textarea, 'scrollHeight', {
            configurable: true,
            value: 600,
        });
        textarea.scrollTop = 360;

        fireEvent.change(textarea, { target: { value: list } });
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        fireEvent.keyDown(textarea, { key: 'Enter' });

        await waitFor(() => {
            expect(textarea).toHaveValue(`${list}\n- `);
            expect(textarea.scrollTop).toBeGreaterThan(360);
        });
    });

    it('switches the description preview back to focused editing when clicked', async () => {
        const { getByRole, queryByRole } = render(<DescriptionPreviewHarness />);

        expect(queryByRole('textbox', { name: 'Description' })).toBeNull();

        fireEvent.click(getByRole('button', { name: 'Edit Description' }));

        await waitFor(() => {
            expect(getByRole('textbox', { name: 'Description' })).toHaveFocus();
        });
    });

    it('does not force preview-to-edit clicks to the end of the description', async () => {
        const selectionSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange').mockImplementation(() => {});
        try {
            const { getByRole } = render(<DescriptionPreviewHarness />);

            fireEvent.click(getByRole('button', { name: 'Edit Description' }));

            await waitFor(() => {
                expect(getByRole('textbox', { name: 'Description' })).toHaveFocus();
            });
            expect(selectionSpy).not.toHaveBeenCalled();
        } finally {
            selectionSpy.mockRestore();
        }
    });
});

describe('TaskItemFieldRenderer skip-reminders toggle', () => {
    afterEach(cleanup);

    const timedTask: Task = { ...baseTask, dueDate: '2026-04-19T11:45' };

    it('reflects the persisted suppressMindwtrReminders state and toggles it (#885)', () => {
        const { getByRole } = render(
            <DraftFieldHarness fieldId="dueDate" initialDraft={{ dueDate: '2026-04-19T11:45' }} />
        );

        const toggle = getByRole('checkbox') as HTMLInputElement;
        // Off by default: the field is absent on a fresh task.
        expect(toggle.checked).toBe(false);

        fireEvent.click(toggle);
        // Round-trip: the draft update re-renders the checkbox as checked.
        expect((getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    });

    it('only appears once the due date carries a time (nothing to suppress otherwise)', () => {
        const { queryByRole, rerender } = render(
            <TaskItemFieldRenderer fieldId="dueDate" {...createProps({ draft: { dueDate: '2026-04-19' } })} />
        );
        expect(queryByRole('checkbox')).toBeNull();

        rerender(
            <TaskItemFieldRenderer fieldId="dueDate" {...createProps({ draft: { dueDate: '2026-04-19T11:45' } })} />
        );
        expect(queryByRole('checkbox')).not.toBeNull();
    });

    it('serializes on -> true and off -> undefined in the saved patch (#835/#836)', () => {
        const on = setTaskDraftField(createTaskDraft(timedTask), 'suppressMindwtrReminders', true);
        expect(taskDraftToUpdatePatch(on, timedTask)).toMatchObject({ suppressMindwtrReminders: true });

        const suppressed: Task = { ...timedTask, suppressMindwtrReminders: true };
        const off = setTaskDraftField(createTaskDraft(suppressed), 'suppressMindwtrReminders', false);
        const offPatch = taskDraftToUpdatePatch(off, suppressed);
        expect(offPatch).not.toBeNull();
        expect(offPatch?.suppressMindwtrReminders).toBeUndefined();
        expect('suppressMindwtrReminders' in (offPatch ?? {})).toBe(true);
    });
});

describe('TaskItemFieldRenderer quick-add token hints (#918)', () => {
    afterEach(cleanup);

    it.each([
        ['dueDate' as const, '/due:'],
        ['reviewAt' as const, '/review:'],
        ['energyLevel' as const, '/energy:'],
        ['assignedTo' as const, '%Name'],
        ['contexts' as const, '@context'],
        ['tags' as const, '#tag'],
        ['description' as const, '/note:'],
        ['attachments' as const, '/link:'],
    ])('shows the %s field quick-add token as a quiet badge', (fieldId, token) => {
        const { getByTitle } = render(
            <TaskItemFieldRenderer fieldId={fieldId} {...createProps()} />
        );

        expect(getByTitle(`Quick add: ${token}`)).toHaveTextContent(token);
    });

    it.each(['startTime' as const, 'status' as const, 'priority' as const, 'location' as const])(
        'leaves the %s field without a token badge',
        (fieldId) => {
            const { queryByTitle } = render(
                <TaskItemFieldRenderer fieldId={fieldId} {...createProps()} />
            );

            expect(queryByTitle(/^Quick add:/)).not.toBeInTheDocument();
        },
    );
});
