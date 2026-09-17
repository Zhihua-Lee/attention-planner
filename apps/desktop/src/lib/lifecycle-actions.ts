import { activeWorkBlocks, assertReservationFree, blockEnd, flushPendingSave, getInMemoryAppDataSnapshot, getStorageAdapter, useTaskStore, type Task, type PlannerClock } from '@mindwtr/core';
import { isTauriRuntime } from './runtime';

export const TASK_OPEN_EVENT = 'attention-planner:open-task';
export const WORK_CHANGED_EVENT = 'attention-planner:current-work';
export function openTaskDetails(taskId: string, blockId?: string) {
    window.dispatchEvent(new CustomEvent(TASK_OPEN_EVENT, { detail: { taskId, blockId } }));
}
export function plannerClock(): PlannerClock {
    return { now: new Date(), deviceId: useTaskStore.getState().settings.deviceId || 'local' };
}
let backupPromise: Promise<void> | null = null;
/** Backup is verified before the first write using the new planner schema. */
export function ensurePlannerBackup(): Promise<void> {
    if (backupPromise) return backupPromise;
    backupPromise = (async () => {
        const key = 'attention-planner:pre-planner-v1';
        if (localStorage.getItem(key)) return;
        await flushPendingSave();
        if (isTauriRuntime()) {
            const { createDesktopRecoverySnapshot } = await import('./data-transfer');
            const name = await createDesktopRecoverySnapshot();
            if (!name) throw new Error('Could not create the pre-upgrade backup. No planner data was changed.');
            localStorage.setItem(key, JSON.stringify({ snapshot: name }));
        } else {
            const data = await getStorageAdapter().getData();
            const encoded = JSON.stringify({ createdAt: new Date().toISOString(), data });
            localStorage.setItem(key,encoded);
            if (localStorage.getItem(key) !== encoded) throw new Error('Could not verify the pre-upgrade backup.');
        }
    })().catch(error => { backupPromise = null; throw error; });
    return backupPromise;
}
/** Re-read after asynchronous preconditions, and build the patch from that state. */
export async function editTask(id: string, build: (task: Task, clock: PlannerClock) => Partial<Task>): Promise<void> {
    await ensurePlannerBackup();
    const state = useTaskStore.getState();
    const task = state._allTasks.find(t => t.id === id);
    if (!task || task.deletedAt) throw new Error('This task is no longer available.');
    const patch = build(task,plannerClock());
    if (!Object.keys(patch).length) return;
    const result = await state.updateTask(id,patch);
    if (!result.success) throw new Error(result.error || 'Could not save this task.');
    await flushPendingSave();
}
export function downloadPlannerBackup() {
    const encoded = JSON.stringify(getInMemoryAppDataSnapshot(), null, 2);
    const url = URL.createObjectURL(new Blob([encoded], { type:'application/json' }));
    const link = document.createElement('a'); link.href=url; link.download=`attention-planner-${new Date().toISOString().slice(0,10)}.json`; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function setCurrentWork(taskId: string | null) {
    if (taskId) localStorage.setItem('attention-planner:current-work',taskId);
    else localStorage.removeItem('attention-planner:current-work');
    window.dispatchEvent(new Event(WORK_CHANGED_EVENT));
}

export function checkReservation(taskId: string, blockId: string, startAt: string, durationMinutes: number, events: Array<{start:string;end:string}>, trusted: boolean) {
    const busy = [...events, ...useTaskStore.getState().tasks.flatMap(task => activeWorkBlocks(task)
        .filter(block => task.id !== taskId || block.id !== blockId)
        .map(block => ({start:block.startAt, end:new Date(blockEnd(block)).toISOString()})))];
    assertReservationFree({startAt,durationMinutes},busy,trusted);
}
