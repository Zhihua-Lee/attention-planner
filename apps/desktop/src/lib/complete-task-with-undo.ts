import { flushPendingSave, restoreCompletedWork, translateWithFallback, undoTaskCompletion, useTaskStore } from '@mindwtr/core';
import { useUiStore } from '../store/ui-store';
import { registerUndoableAction } from './undo-registry';
import { reportError } from './report-error';

type TranslateFn = (key: string) => string;

export function formatTaskMarkedDoneMessage(t: TranslateFn, title: string): string {
    return translateWithFallback(t, 'task.markedDone', '{title} marked Done').replace('{title}', title);
}

// Completion controls outside TaskItem must offer the same recovery as a row.
// Capture only the state completion changes; undo must not overwrite newer edits.
export async function completeTaskWithUndo(taskId: string, t: TranslateFn): Promise<boolean> {
    const state = useTaskStore.getState();
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.deletedAt || ['done', 'archived', 'reference'].includes(task.status)) return false;
    try {
        const result = await state.updateTask(taskId, { status: 'done', ...(!task.planner ? { isFocusedToday: false } : {}) });
        if (!result.success) throw new Error(result.error || 'Failed to complete task');
        await flushPendingSave();
        const undo = registerUndoableAction(() => {
            void undoTaskCompletion(taskId, task.status, task.isFocusedToday === true && !task.planner)
                .then(async () => { const store=useTaskStore.getState();const latest=store._allTasks.find(item=>item.id===taskId);if(latest&&latest.status===task.status){const patch=restoreCompletedWork(task,latest,{now:new Date(),deviceId:store.settings.deviceId||'local'});if(Object.keys(patch).length)await store.updateTask(taskId,patch);await flushPendingSave();} })
                .catch((error) => reportError('Failed to undo task completion', error));
        });
        if (useTaskStore.getState().settings.undoNotificationsEnabled !== false) {
            useUiStore.getState().showToast(formatTaskMarkedDoneMessage(t, task.title), 'info', 12000, {
                label: translateWithFallback(t, 'common.undo', 'Undo'),
                onClick: undo,
            });
        }
        return true;
    } catch (error) {
        reportError('Failed to complete task', error);
        useUiStore.getState().showToast(translateWithFallback(t, 'task.completionFailed', 'Could not complete the task. Please try again.'), 'error');
        return false;
    }
}
