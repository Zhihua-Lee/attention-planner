import { changeChecklistCompletion, checklistDraftState, checklistEndImpact, checklistEndUpdates, checklistFreezeUpdates, checklistItemState, checklistRefreshData, checklistTargetPolicy,
    flushPendingSave, hasActiveChecklistRound, makeChecklistPolicy, taskPlanner, updateChecklistPolicy, useTaskStore,
    type Task, type ChecklistRefreshEnd, type ChecklistRefreshPolicy, type ChecklistRefreshTarget, type checklistEndPreview } from '@mindwtr/core';
import { editTask, ensurePlannerBackup } from './lifecycle-actions';
import { registerUndoableAction } from './undo-registry';
import { useUiStore } from '../store/ui-store';

type Completion = { itemId: string; completed: boolean; cycleId?: string };
function completionPatch(task: Task, changed: ReturnType<typeof changeChecklistCompletion>): Partial<Task> {
    return { checklist: changed.checklist, ...(JSON.stringify(changed.refresh) !== JSON.stringify(checklistRefreshData(task))
        ? { planner: { ...taskPlanner(task), checklistRefresh: changed.refresh } } : {}) };
}
const fail = (error: unknown) => useUiStore.getState().showToast(error instanceof Error ? error.message : String(error), 'error');
export async function setChecklistCompletion(taskId: string, changes: Completion[], zh: boolean) {
    let previous: Completion[] = [];
    let expected: ReturnType<typeof checklistDraftState> = {};
    await editTask(taskId, (task, clock) => {
        if (['done', 'archived', 'reference'].includes(task.status)) throw new Error(zh ? '先重新打开清单。' : 'Reopen the checklist first.');
        const tasks = useTaskStore.getState()._allTasks;
        const before = checklistDraftState(task, tasks, clock.now);
        // Validate all expected cycle identities even when the desired checkbox already matches.
        const changed = changeChecklistCompletion(task, tasks, changes, clock.now, clock.deviceId);
        previous = changes.filter(change => before[change.itemId]?.completed !== change.completed)
            .map(change => ({ ...change, completed: before[change.itemId].completed }));
        if (!previous.length) return {};
        const patch = completionPatch(task, changed);
        expected = checklistDraftState({ ...task, ...patch }, tasks, clock.now);
        return patch;
    });
    if (!previous.length) return;
    const undo = registerUndoableAction(() => {
        void editTask(taskId, (task, clock) => {
            const tasks = useTaskStore.getState()._allTasks, current = checklistDraftState(task, tasks, clock.now);
            for (const change of previous) {
                if (!current[change.itemId] || JSON.stringify(current[change.itemId]) !== JSON.stringify(expected[change.itemId])) {
                    throw new Error(zh ? '周期或勾选状态已变化，未覆盖较新的记录。' : 'The period or completion changed. Newer records were kept.');
                }
            }
            const changed = changeChecklistCompletion(task, tasks, previous, clock.now, clock.deviceId);
            return completionPatch(task, changed);
        }).catch(fail);
    });
    if (useTaskStore.getState().settings.undoNotificationsEnabled !== false) {
        useUiStore.getState().showToast(zh ? '已更新清单' : 'Checklist updated', 'info', 10000, { label: zh ? '撤销' : 'Undo', onClick: undo });
    }
}
export async function setChecklistRoundCompletion(taskId: string, completed: boolean, zh: boolean) {
    const state = useTaskStore.getState(), task = state._allTasks.find(t => t.id === taskId), now = new Date();
    if (!task || !hasActiveChecklistRound(task, state._allTasks, now)) throw new Error(zh ? '清单刷新规则已改变。' : 'The checklist refresh rule changed.');
    // A round covers only refreshing items; one-time steps keep their own permanent checkbox.
    const changes = (task.checklist ?? []).flatMap(item => {
        const period = checklistItemState(task, item, state._allTasks, now);
        return period.recurring && period.cycle ? [{ itemId: item.id, completed, cycleId: period.cycle.id }] : [];
    });
    if (!changes.length) throw new Error(zh ? '首轮尚未开始。' : 'The first period has not started yet.');
    await setChecklistCompletion(taskId, changes, zh);
}
export async function saveChecklistPolicy(target: ChecklistRefreshTarget, expectedPolicy: ChecklistRefreshPolicy | undefined,
    values: Pick<ChecklistRefreshPolicy, 'mode' | 'schedule' | 'end'> & { paused: boolean }) {
    await ensurePlannerBackup();
    const state = useTaskStore.getState(), task = state._allTasks.find(t => t.id === target.taskId), now = new Date();
    if (!task || task.deletedAt || task.purgedAt) throw new Error('This task is no longer available.');
    const old = checklistTargetPolicy(task, target.itemId);
    if (JSON.stringify(old) !== JSON.stringify(expectedPolicy)) throw new Error('This rule changed on another device. Reopen the settings before saving.');
    const policy = makeChecklistPolicy(old, values, now, state.settings.deviceId || 'local');
    const planner = { ...taskPlanner(task), checklistRefresh: updateChecklistPolicy(task, target.itemId, policy) };
    const nextTask = { ...task, planner }, nextTasks = state._allTasks.map(t => t.id === task.id ? nextTask : t);
    const updates: Array<{ id: string; updates: Partial<Task> }> = [{ id: task.id, updates: { planner } }];
    for (const [id, checklist] of checklistFreezeUpdates(state._allTasks, nextTasks, [task.id], now)) {
        if (id === task.id) updates[0].updates.checklist = checklist;
        else updates.push({ id, updates: { checklist } });
    }
    const result = await state.batchUpdateTasks(updates);
    if (!result.success) throw new Error(result.error || 'Could not save refresh settings.');
    await flushPendingSave();
}
export async function syncChecklistEnd(preview: ReturnType<typeof checklistEndPreview>, end: ChecklistRefreshEnd, expectedImpact: ReturnType<typeof checklistEndImpact>) {
    await ensurePlannerBackup();
    const state = useTaskStore.getState();
    const impact = checklistEndImpact(state._allTasks, preview, end);
    if (JSON.stringify(impact) !== JSON.stringify(expectedImpact)) throw new Error('The affected lists changed after the preview. Review the selection again.');
    const changed = checklistEndUpdates(state._allTasks, preview, end, new Date(), state.settings.deviceId || 'local');
    const updates = [...changed].map(([id, checklistRefresh]) => ({ id,
        updates: { planner: { ...taskPlanner(state._allTasks.find(task => task.id === id)!), checklistRefresh } },
    }));
    const result = await state.batchUpdateTasks(updates);
    if (!result.success) throw new Error(result.error || 'Could not save end dates.');
    await flushPendingSave();
}
