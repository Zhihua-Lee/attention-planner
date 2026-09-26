import type { Task } from '@mindwtr/core';
import { editTask } from './lifecycle-actions';
import { registerUndoableAction } from './undo-registry';
import { useUiStore } from '../store/ui-store';

/** Workflow only: never cancel reservations or discard content when clarifying again. */
export async function returnTaskToInbox(taskId: string, zh: boolean) {
    let previous: Task['status'] = 'next';
    await editTask(taskId, task => {
        if (['done', 'archived', 'reference'].includes(task.status)) throw new Error(zh ? '请先重新打开任务。' : 'Reopen this task first.');
        previous = task.status;
        return { status: 'inbox' };
    });
    const undo = registerUndoableAction(() => {
        void editTask(taskId, latest => {
            if (latest.status !== 'inbox') throw new Error(zh ? '任务状态已改变，未覆盖较新的修改。' : 'The task status changed again. Your newer change was kept.');
            return { status: previous };
        }).catch(error => useUiStore.getState().showToast(String(error), 'error'));
    });
    useUiStore.getState().showToast(zh ? '已移回收集箱。原安排保留，可在详情中取消。' : 'Moved to Inbox. Existing plans kept; cancel them in task details.', 'info', 12000, { label: zh ? '撤销' : 'Undo', onClick: undo });
}
