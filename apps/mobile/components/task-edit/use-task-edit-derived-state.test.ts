import React from 'react';
import renderer from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import type { AppData, Task } from '@mindwtr/core';
import { createTaskDraft, setTaskDraftField } from '@mindwtr/core/task-draft';

import { DEFAULT_TASK_EDITOR_ORDER } from './task-edit-modal.utils';
import { useTaskEditDerivedState } from './use-task-edit-derived-state';

const baseTask: Task = {
    id: 'task-1',
    title: 'Monthly check',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
};

describe('useTaskEditDerivedState', () => {
    it('hides status when the task editor layout disables it even for non-inbox tasks', () => {
        let derived: ReturnType<typeof useTaskEditDerivedState> | undefined;
        const settings: AppData['settings'] = {
            gtd: {
                taskEditor: {
                    hidden: ['status'],
                },
            },
        };

        function Probe() {
            derived = useTaskEditDerivedState({
                task: baseTask,
                checklist: baseTask.checklist,
                draft: createTaskDraft(baseTask),
                settings,
                projects: [],
                sections: [],
                prioritiesEnabled: true,
                timeEstimatesEnabled: true,
                contextInputDraft: '',
                descriptionDraft: '',
                tagInputDraft: '',
                visibleAttachmentsLength: 0,
                t: (key) => key,
            });
            return null;
        }

        renderer.act(() => {
            renderer.create(React.createElement(Probe));
        });

        expect(derived?.basicFields).not.toContain('status');
        expect(derived?.showStatusField).toBe(false);
    });

    it('hides every configured field when hidden fields have no task content', () => {
        let derived: ReturnType<typeof useTaskEditDerivedState> | undefined;
        const settings: AppData['settings'] = {
            gtd: {
                taskEditor: {
                    hidden: [...DEFAULT_TASK_EDITOR_ORDER],
                },
            },
        };

        function Probe() {
            derived = useTaskEditDerivedState({
                task: baseTask,
                checklist: baseTask.checklist,
                draft: createTaskDraft(baseTask),
                settings,
                projects: [],
                sections: [],
                prioritiesEnabled: true,
                timeEstimatesEnabled: true,
                contextInputDraft: '',
                descriptionDraft: '',
                tagInputDraft: '',
                visibleAttachmentsLength: 0,
                t: (key) => key,
            });
            return null;
        }

        renderer.act(() => {
            renderer.create(React.createElement(Probe));
        });

        expect(derived?.basicFields).toEqual([]);
        expect(derived?.schedulingFields).toEqual([]);
        expect(derived?.organizationFields).toEqual([]);
        expect(derived?.detailsFields).toEqual([]);
        expect(derived?.showStatusField).toBe(false);
    });

    it('does not resurrect task values that were cleared in the draft', () => {
        let derived: ReturnType<typeof useTaskEditDerivedState> | undefined;
        const task: Task = {
            ...baseTask,
            projectId: 'project-1',
            areaId: 'area-1',
            sectionId: 'section-1',
            priority: 'high',
            energyLevel: 'high',
            assignedTo: 'Morgan',
            location: 'Office',
            timeEstimate: '1hr',
            startTime: '2026-06-04T09:00',
            dueDate: '2026-06-05T17:00',
            reviewAt: '2026-06-06T09:00',
            recurrence: { rule: 'daily' },
        };
        let draft = createTaskDraft(task);
        draft = setTaskDraftField(draft, 'projectId', '');
        draft = setTaskDraftField(draft, 'sectionId', '');
        draft = setTaskDraftField(draft, 'areaId', '');
        draft = setTaskDraftField(draft, 'priority', '');
        draft = setTaskDraftField(draft, 'energyLevel', '');
        draft = setTaskDraftField(draft, 'assignedTo', '');
        draft = setTaskDraftField(draft, 'location', '');
        draft = setTaskDraftField(draft, 'timeEstimate', '');
        draft = setTaskDraftField(draft, 'startTime', '');
        draft = setTaskDraftField(draft, 'availableAt', '');
        draft = setTaskDraftField(draft, 'scheduledAt', '');
        draft = setTaskDraftField(draft, 'dueDate', '');
        draft = setTaskDraftField(draft, 'reviewAt', '');
        draft = setTaskDraftField(draft, 'recurrence', '');

        function Probe() {
            derived = useTaskEditDerivedState({
                task,
                checklist: task.checklist,
                draft,
                settings: {
                    gtd: {
                        taskEditor: {
                            hidden: [...DEFAULT_TASK_EDITOR_ORDER],
                        },
                    },
                },
                projects: [],
                sections: [],
                prioritiesEnabled: true,
                timeEstimatesEnabled: true,
                contextInputDraft: '',
                descriptionDraft: '',
                tagInputDraft: '',
                visibleAttachmentsLength: 0,
                t: (key) => key,
            });
            return null;
        }

        renderer.act(() => {
            renderer.create(React.createElement(Probe));
        });

        expect(derived?.activeProjectId).toBe('');
        expect(derived?.projectFilterAreaId).toBe('');
        expect(derived?.basicFields).toEqual([]);
        expect(derived?.schedulingFields).toEqual([]);
        expect(derived?.organizationFields).toEqual([]);
        expect(derived?.detailsFields).toEqual([]);
    });
});
