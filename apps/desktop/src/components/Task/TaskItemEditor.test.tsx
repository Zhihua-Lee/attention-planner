import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createTaskDraft, type Task } from '@mindwtr/core';

import { TaskItemEditor } from './TaskItemEditor';

const baseTask: Task = {
    id: 'task-1',
    title: 'Reserve acupuncture',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
};

const translations: Record<string, string> = {
    'taskEdit.scheduling': 'Scheduling',
    'taskEdit.organization': 'Organization',
    'taskEdit.details': 'Details',
    'taskEdit.schedulingEmpty': 'No scheduling fields',
    'taskEdit.organizationEmpty': 'No organization fields',
    'taskEdit.detailsEmpty': 'No details fields',
    'areas.create': 'Create area',
    'areas.search': 'Search areas',
    'common.noMatches': 'No matches',
    'projects.addSection': 'Add section',
    'projects.create': 'Create project',
    'projects.search': 'Search projects',
    'projects.title': 'Projects',
    'sections.search': 'Search sections',
    'taskEdit.areaLabel': 'Area',
    'taskEdit.locationLabel': 'Location',
    'taskEdit.noAreaOption': 'No Area',
    'taskEdit.noProjectOption': 'No Project',
    'taskEdit.noSectionOption': 'No Section',
    'taskEdit.sectionLabel': 'Section',
    'taskEdit.titleLabel': 'Task title',
    'taskEdit.editorLayoutHelpLabel': 'Editor layout help',
    'taskEdit.editorLayoutHelpText': 'You can customize which fields appear here in Settings -> GTD -> Task Editor Layout.',
    'task.aria.location': 'Location',
    'taskEdit.locationPlaceholder': 'Add location',
    'taskEdit.duplicateTask': 'Duplicate task',
    'taskEdit.aiAssistant': 'AI assistant',
    'ai.working': 'Working...',
    'common.delete': 'Delete',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'status.done': 'Done',
};

const t = (key: string) => translations[key] ?? key;

// jsdom has no scrollIntoView; the reveal effect calls it after expanding
// the section holding Attachments.
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
});

const createDataTransfer = (types: string[], files: File[] = []) =>
    ({ types, files }) as unknown as DataTransfer;

const baseProps: Parameters<typeof TaskItemEditor>[0] = {
    t,
    draft: createTaskDraft(baseTask),
    setField: vi.fn(),
    autoFocusTitle: false,
    resetCopilotDraft: vi.fn(),
    aiEnabled: false,
    isAIWorking: false,
    handleAIClarify: vi.fn(),
    handleAIBreakdown: vi.fn(),
    copilotSuggestion: null,
    copilotApplied: false,
    applyCopilotSuggestion: vi.fn(),
    copilotContext: undefined,
    copilotEstimate: undefined,
    copilotTags: [],
    timeEstimatesEnabled: false,
    aiError: null,
    aiBreakdownSteps: null,
    onAddBreakdownSteps: vi.fn(),
    onDismissBreakdown: vi.fn(),
    aiClarifyResponse: null,
    onSelectClarifyOption: vi.fn(),
    onApplyAISuggestion: vi.fn(),
    onDismissClarify: vi.fn(),
    projects: [],
    sections: [],
    areas: [],
    onCreateProject: vi.fn().mockResolvedValue(null),
    onCreateArea: vi.fn().mockResolvedValue(null),
    onCreateSection: vi.fn().mockResolvedValue(null),
    organizerFields: [],
    basicFieldsBeforeOrganizers: [],
    basicFieldsAfterOrganizers: [],
    schedulingFields: ['recurrence'],
    organizationFields: ['contexts'],
    detailsFields: ['attachments'],
    sectionCounts: {
        scheduling: 1,
        organization: 1,
        details: 1,
    },
    sectionOpenDefaults: {
        basic: true,
        scheduling: false,
        organization: false,
        details: false,
    },
    renderField: (fieldId) => <div>{`field:${fieldId}`}</div>,
    language: 'en',
    inputContexts: [],
    onDuplicateTask: vi.fn(),
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
};

describe('TaskItemEditor', () => {
    it('keeps optional sections collapsed when their defaults are off', () => {
        const { getByRole, queryByText } = render(<TaskItemEditor {...baseProps} />);

        expect(getByRole('button', { name: /Scheduling/i })).toHaveAttribute('aria-expanded', 'false');
        expect(getByRole('button', { name: /Organization/i })).toHaveAttribute('aria-expanded', 'false');
        expect(getByRole('button', { name: /Details/i })).toHaveAttribute('aria-expanded', 'false');

        expect(queryByText('field:recurrence')).not.toBeInTheDocument();
        expect(queryByText('field:contexts')).not.toBeInTheDocument();
        expect(queryByText('field:description')).toBeVisible();
        expect(queryByText('field:checklist')).not.toBeVisible();
        expect(queryByText('field:attachments')).not.toBeInTheDocument();
        expect(queryByText('Location')).not.toBeInTheDocument();
    });

    it('does not render optional sections that have no fields', () => {
        const { getByRole, queryByRole } = render(
            <TaskItemEditor
                {...baseProps}
                schedulingFields={[]}
                organizationFields={['contexts']}
                detailsFields={[]}
                sectionCounts={{ scheduling: 0, organization: 0, details: 0 }}
            />
        );

        expect(queryByRole('button', { name: /Scheduling/i })).not.toBeInTheDocument();
        expect(getByRole('button', { name: /Organization/i })).toBeInTheDocument();
        expect(queryByRole('button', { name: /Details/i })).not.toBeInTheDocument();
    });

    it('shows a visible loading label while AI is working', () => {
        const { getByRole, getByText } = render(
            <TaskItemEditor
                {...baseProps}
                aiEnabled
                isAIWorking
            />
        );

        expect(getByRole('button', { name: 'AI assistant' })).toBeDisabled();
        expect(getByText('Working...')).toBeInTheDocument();
    });

    it('calls the edit-mode delete action when provided', () => {
        const onDeleteTask = vi.fn();
        const { getByRole } = render(
            <TaskItemEditor
                {...baseProps}
                onDeleteTask={onDeleteTask}
            />
        );

        fireEvent.click(getByRole('button', { name: 'Delete' }));

        expect(onDeleteTask).toHaveBeenCalledTimes(1);
    });

    it('calls the title-row done action when provided', () => {
        const onMarkDone = vi.fn();
        const { getByRole } = render(
            <TaskItemEditor
                {...baseProps}
                onMarkDone={onMarkDone}
            />
        );

        const doneButton = getByRole('button', { name: 'Done' });
        expect(doneButton).toHaveAttribute('aria-pressed', 'false');
        expect(doneButton).toHaveClass('focus-visible:ring-2');
        expect(doneButton).not.toHaveClass('focus:ring-2');
        fireEvent.click(doneButton);

        expect(onMarkDone).toHaveBeenCalledTimes(1);
    });

    it('requests a completion time when the title-row done action is right-clicked', () => {
        const onMarkDone = vi.fn();
        const onRequestBackdatedComplete = vi.fn();
        const { getByRole } = render(
            <TaskItemEditor
                {...baseProps}
                onMarkDone={onMarkDone}
                onRequestBackdatedComplete={onRequestBackdatedComplete}
            />
        );

        fireEvent.contextMenu(getByRole('button', { name: 'Done' }));

        expect(onRequestBackdatedComplete).toHaveBeenCalledTimes(1);
        expect(onMarkDone).not.toHaveBeenCalled();
    });

    it('emphasizes the task title field in the editor header', () => {
        const { getByRole } = render(<TaskItemEditor {...baseProps} />);

        expect(getByRole('combobox', { name: 'Task title' })).toHaveClass(
            'text-lg',
            'font-semibold',
            'text-foreground',
            'focus-visible:ring-2'
        );
    });

    it('shows task editor layout help in an inline popover', () => {
        const { getByRole, getByText, queryByText } = render(<TaskItemEditor {...baseProps} />);

        fireEvent.click(getByRole('button', { name: 'Editor layout help' }));

        expect(getByText('You can customize which fields appear here in Settings -> GTD -> Task Editor Layout.')).toBeInTheDocument();

        fireEvent.click(getByRole('button', { name: 'Editor layout help' }));

        expect(queryByText('You can customize which fields appear here in Settings -> GTD -> Task Editor Layout.')).not.toBeInTheDocument();
    });

    it('uses stronger weight for organization field labels without changing label size', () => {
        const { getByText } = render(
            <TaskItemEditor
                {...baseProps}
                organizerFields={['area', 'project', 'section']}
            />
        );

        ['Area', 'Projects', 'Section'].forEach((label) => {
            expect(getByText(label)).toHaveClass('text-xs', 'font-semibold');
            expect(getByText(label)).not.toHaveClass('font-medium');
        });
    });

    it('does not show a delete action without an edit-mode delete handler', () => {
        const { queryByRole } = render(<TaskItemEditor {...baseProps} />);

        expect(queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });
});

describe('TaskItemEditor file drop', () => {
    it('ignores a task drag (non-Files dataTransfer types) so calendar/sidebar dragging still works', () => {
        const onFilesDropped = vi.fn();
        const { container } = render(<TaskItemEditor {...baseProps} onFilesDropped={onFilesDropped} />);
        const form = container.querySelector('form')!;

        const dataTransfer = createDataTransfer(['application/x-mindwtr-task']);
        fireEvent.dragOver(form, { dataTransfer });
        fireEvent.drop(form, { dataTransfer });

        expect(onFilesDropped).not.toHaveBeenCalled();
    });

    it('attaches OS files dropped anywhere on the editor', () => {
        const onFilesDropped = vi.fn();
        const file = new File(['hi'], 'a.txt');
        const { container } = render(<TaskItemEditor {...baseProps} onFilesDropped={onFilesDropped} />);
        const form = container.querySelector('form')!;

        const dataTransfer = createDataTransfer(['Files'], [file]);
        fireEvent.dragOver(form, { dataTransfer });
        fireEvent.drop(form, { dataTransfer });

        expect(onFilesDropped).toHaveBeenCalledWith([file]);
    });

    it('opens the section holding Attachments on drop, wherever the user assigned it', () => {
        const onFilesDropped = vi.fn();
        const file = new File(['hi'], 'a.txt');
        const { container, getByRole, getByText } = render(
            <TaskItemEditor
                {...baseProps}
                organizationFields={['attachments']}
                onFilesDropped={onFilesDropped}
            />
        );
        const form = container.querySelector('form')!;
        expect(getByRole('button', { name: /Organization/i })).toHaveAttribute('aria-expanded', 'false');

        const dataTransfer = createDataTransfer(['Files'], [file]);
        fireEvent.dragOver(form, { dataTransfer });
        fireEvent.drop(form, { dataTransfer });

        expect(onFilesDropped).toHaveBeenCalledWith([file]);
        expect(getByRole('button', { name: /Organization/i })).toHaveAttribute('aria-expanded', 'true');
        expect(getByText('field:attachments')).toBeInTheDocument();
    });
});
