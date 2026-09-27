import { flushPendingSave, taskPlacementUpdates, useTaskStore, type Task, type TaskDropPosition } from '@mindwtr/core';
import { ensurePlannerBackup } from './lifecycle-actions';
import { registerUndoableAction } from './undo-registry';
import { useUiStore } from '../store/ui-store';

export async function moveTaskWithUndo(taskId: string, parentTaskId: string | undefined, zh: boolean) {
    return placeTaskWithUndo(taskId, parentTaskId, 'inside', zh);
}

/** Parent and sibling order are saved/undone together, never as two visible intermediate moves. */
export async function placeTaskWithUndo(taskId: string, targetId: string | undefined, position: TaskDropPosition, zh: boolean) {
    await ensurePlannerBackup();
    const state = useTaskStore.getState();
    const changes = taskPlacementUpdates(state._allTasks, taskId, targetId, position);
    if (!changes.length) return;
    const byId = new Map(state._allTasks.map(task => [task.id, task]));
    const previous = changes.map(({ id, updates }) => ({
        id,
        updates: Object.fromEntries(Object.keys(updates).map(key => [key, byId.get(id)![key as keyof Task]])) as Partial<Task>,
    }));
    const placedParents = new Map(changes.map(({ id, updates }) => [id, { ...byId.get(id)!, ...updates }.parentTaskId]));
    const result = await state.batchUpdateTasks(changes);
    if (!result.success) throw new Error(result.error || 'Could not save this move.');
    await flushPendingSave();
    const undo = registerUndoableAction(() => {
        void (async () => {
            await ensurePlannerBackup();
            const latest = useTaskStore.getState();
            const currentById = new Map(latest._allTasks.map(task => [task.id, task]));
            for (const { id, updates } of changes) {
                const task = currentById.get(id);
                if (!task || task.deletedAt || task.purgedAt || task.parentTaskId !== placedParents.get(id)
                    || Object.entries(updates).some(([key, value]) => task[key as keyof Task] !== value)) {
                    throw new Error(zh ? '任务顺序或归属已再次改变，未覆盖较新的修改。' : 'Task order or placement changed again. The newer changes were kept.');
                }
            }
            const restored = await latest.batchUpdateTasks(previous);
            if (!restored.success) throw new Error(restored.error || 'Could not undo this move.');
            await flushPendingSave();
        })().catch(error => useUiStore.getState().showToast(error instanceof Error ? error.message : String(error), 'error'));
    });
    const target = byId.get(targetId ?? '');
    const message = position !== 'inside'
        ? (zh ? '顺序已保存，时间与内容保留。' : 'Order saved. Dates and content kept.')
        : target
            ? (zh ? `已移入「${target.title}」，时间与内容保留。` : `Moved into “${target.title}”. Dates and content kept.`)
            : (zh ? '已移出为顶层任务。' : 'Moved out to the top level.');
    useUiStore.getState().showToast(message, 'success', 12000, { label: zh ? '撤销' : 'Undo', onClick: undo });
}
