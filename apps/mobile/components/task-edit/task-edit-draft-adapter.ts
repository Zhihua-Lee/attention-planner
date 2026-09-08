import type { Attachment, Task } from '@mindwtr/core';
import {
    areDraftAttachmentsDirty,
    createTaskDraft,
    isTaskDraftDirty,
    setTaskDraftField,
    taskDraftToUpdatePatch,
    type TaskDraft,
} from '@mindwtr/core/task-draft';
import { areTaskFieldValuesEqual } from './task-edit-modal.helpers';

/**
 * Mobile keeps checklist and attachment buffers beside the shared TaskDraft:
 * both have their own editing lifecycle and deliberately do not live in the
 * scalar field table (ADR 0022 and attachment soft-delete semantics).
 */
export type TaskEditDraft = {
    draft: TaskDraft;
    checklist: Task['checklist'];
    attachments: Attachment[] | undefined;
};

export function createTaskEditDraft(task: Task): TaskEditDraft {
    return {
        draft: createTaskDraft(task),
        checklist: task.checklist,
        attachments: task.attachments,
    };
}

const areChecklistsDirty = (state: TaskEditDraft, task: Task) => (
    JSON.stringify(state.checklist ?? null) !== JSON.stringify(task.checklist ?? null)
);

export function isTaskEditDraftDirty(state: TaskEditDraft, task: Task): boolean {
    return isTaskDraftDirty(state.draft, task)
        || areChecklistsDirty(state, task)
        || areDraftAttachmentsDirty(state.attachments, task);
}

export type TaskEditDraftOverrides = {
    title?: string;
    description?: string;
    contexts?: string[];
    tags?: string[];
};

const RAW_CONTAINER_FIELDS = new Set<keyof Task>(['projectId', 'sectionId', 'areaId']);

const applyDraftOverrides = (
    state: TaskEditDraft,
    overrides: TaskEditDraftOverrides,
): TaskEditDraft => {
    if (Object.keys(overrides).length === 0) return state;
    let draft = state.draft;
    if (overrides.title !== undefined) draft = setTaskDraftField(draft, 'title', overrides.title);
    if (overrides.description !== undefined) draft = setTaskDraftField(draft, 'description', overrides.description);
    if (overrides.contexts !== undefined) draft = setTaskDraftField(draft, 'contexts', overrides.contexts.join(', '));
    if (overrides.tags !== undefined) draft = setTaskDraftField(draft, 'tags', overrides.tags.join(', '));
    return draft === state.draft ? state : { ...state, draft };
};

/** Serialize a narrow update patch while comparing against TaskDraft's own
 * normalized baseline. This prevents an unrelated edit from rewriting dates
 * merely because the draft uses datetime-local values internally. */
export function buildTaskEditUpdatePatch(
    state: TaskEditDraft,
    task: Task,
    overrides: TaskEditDraftOverrides = {},
): Partial<Task> | null {
    const finalState = applyDraftOverrides(state, overrides);
    const patch = taskDraftToUpdatePatch(finalState.draft, task, {
        attachments: finalState.attachments,
    });
    if (!patch) return null;

    const baseline = taskDraftToUpdatePatch(createTaskDraft(task), task, {
        attachments: task.attachments,
    }) ?? {};
    const narrowed: Partial<Task> = { ...patch };
    for (const key of Object.keys(narrowed) as (keyof Task)[]) {
        const baselineValue = RAW_CONTAINER_FIELDS.has(key) || !Object.prototype.hasOwnProperty.call(baseline, key)
            ? task[key] : baseline[key];
        if (areTaskFieldValuesEqual(narrowed[key], baselineValue)) {
            delete narrowed[key];
        }
    }
    if (areChecklistsDirty(finalState, task)) {
        narrowed.checklist = finalState.checklist;
    }
    return narrowed;
}
