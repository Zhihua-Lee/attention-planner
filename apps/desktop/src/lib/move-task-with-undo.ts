import { useTaskStore } from '@mindwtr/core';
import { editTask } from './lifecycle-actions';
import { registerUndoableAction } from './undo-registry';
import { useUiStore } from '../store/ui-store';

export async function moveTaskWithUndo(taskId: string, parentTaskId: string | undefined, zh: boolean) {
    let previous: string | undefined;
    let changed = false;
    await editTask(taskId, latest => {
        previous = latest.parentTaskId;
        changed = previous !== parentTaskId;
        return changed ? { parentTaskId } : {};
    });
    if (!changed) return;
    const undo = registerUndoableAction(() => {
        void editTask(taskId, latest => {
            if (latest.parentTaskId !== parentTaskId) throw new Error(zh ? '任务已再次移动，未覆盖较新的修改。' : 'This task was moved again. The newer move was kept.');
            return { parentTaskId: previous };
        }).catch(error => useUiStore.getState().showToast(error instanceof Error ? error.message : String(error), 'error'));
    });
    const parent = useTaskStore.getState().tasks.find(task => task.id === parentTaskId);
    useUiStore.getState().showToast(parent
        ? (zh ? `已移入「${parent.title}」，时间与内容保留。` : `Moved into “${parent.title}”. Dates and content kept.`)
        : (zh ? '已移出为顶层任务。' : 'Moved out to the top level.'), 'success', 12000, { label: zh ? '撤销' : 'Undo', onClick: undo });
}
