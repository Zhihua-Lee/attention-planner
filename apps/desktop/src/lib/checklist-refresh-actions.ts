import { changeChecklistCompletion, checklistDraftState, checklistFreezeUpdates, checklistItemState, checklistRefreshData, checklistTargetPolicy, checklistTaskRoundItem,
    generateUUID, hasActiveChecklistRound, makeChecklistPolicy, taskPlanner, TASK_ROUND_ID, updateChecklistPolicy, useTaskStore,
    type ChecklistRefreshData, type ChecklistRefreshEnd, type ChecklistRefreshSchedule, type Task } from '@mindwtr/core';
import { editTask } from './lifecycle-actions';
import { registerUndoableAction } from './undo-registry';
import { useUiStore } from '../store/ui-store';
import { recurrenceFromRule, sameCadence, scheduleFromRule, type RepeatRule, type StepRepeat, type TaskRepeat } from './repeat-rules';

type Completion = { itemId: string; completed: boolean; cycleId?: string };
function completionPatch(task: Task, changed: ReturnType<typeof changeChecklistCompletion>): Partial<Task> {
    return { checklist: changed.checklist, ...(JSON.stringify(changed.refresh) !== JSON.stringify(checklistRefreshData(task))
        ? { planner: { ...taskPlanner(task), checklistRefresh: changed.refresh } } : {}) };
}
/** Per-step period state plus the task's own round, so undo guards cover both. */
function roundStates(task: Task, tasks: readonly Task[], now: Date): ReturnType<typeof checklistDraftState> {
    const states = checklistDraftState(task, tasks, now), own = checklistItemState(task, checklistTaskRoundItem(task), tasks, now);
    if (own.recurring) states[TASK_ROUND_ID] = { completed: own.completed, recurring: true, cycleId: own.cycle?.id,
        mark: own.cycle ? checklistRefreshData(task).marks[TASK_ROUND_ID]?.[own.cycle.id] : undefined };
    return states;
}
const fail = (error: unknown) => useUiStore.getState().showToast(error instanceof Error ? error.message : String(error), 'error');
export async function setChecklistCompletion(taskId: string, changes: Completion[], zh: boolean) {
    let previous: Completion[] = [];
    let expected: ReturnType<typeof checklistDraftState> = {};
    await editTask(taskId, (task, clock) => {
        if (['done', 'archived', 'reference'].includes(task.status)) throw new Error(zh ? '先重新打开任务。' : 'Reopen the task first.');
        const tasks = useTaskStore.getState()._allTasks;
        const before = roundStates(task, tasks, clock.now);
        // Validate all expected cycle identities even when the desired checkbox already matches.
        const changed = changeChecklistCompletion(task, tasks, changes, clock.now, clock.deviceId);
        previous = changes.filter(change => before[change.itemId] && before[change.itemId].completed !== change.completed)
            .map(change => ({ ...change, completed: before[change.itemId].completed }));
        if (!previous.length) return {};
        const patch = completionPatch(task, changed);
        expected = roundStates({ ...task, ...patch }, tasks, clock.now);
        return patch;
    });
    if (!previous.length) return;
    const undo = registerUndoableAction(() => {
        void editTask(taskId, (task, clock) => {
            const tasks = useTaskStore.getState()._allTasks, current = roundStates(task, tasks, clock.now);
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
        useUiStore.getState().showToast(zh ? '已更新' : 'Updated', 'info', 10000, { label: zh ? '撤销' : 'Undo', onClick: undo });
    }
}
/** Completes (or reopens) the current round: every repeating step plus the task's own round. One-time steps are untouched. */
export async function setChecklistRoundCompletion(taskId: string, completed: boolean, zh: boolean) {
    const state = useTaskStore.getState(), task = state._allTasks.find(t => t.id === taskId), now = new Date();
    if (!task || !hasActiveChecklistRound(task, state._allTasks, now)) throw new Error(zh ? '重复规则已改变。' : 'The repeat rule changed.');
    const changes = [checklistTaskRoundItem(task), ...(task.checklist ?? [])].flatMap(item => {
        const period = checklistItemState(task, item, state._allTasks, now);
        return period.recurring && period.cycle ? [{ itemId: item.id, completed, cycleId: period.cycle.id }] : [];
    });
    if (!changes.length) throw new Error(zh ? '首轮尚未开始。' : 'The first round has not started yet.');
    await setChecklistCompletion(taskId, changes, zh);
}

/**
 * While a repeat editor stays open, cadence edits share one schedule version (`id`), and returning to the
 * cadence it opened with (`initial`) restores that version, so this round's checkmarks are not lost.
 */
export type RepeatSession = { id: string; initial?: ChecklistRefreshSchedule };
const versionFor = (candidate: ChecklistRefreshSchedule, latest: ChecklistRefreshSchedule | undefined, session: RepeatSession) =>
    sameCadence(latest, candidate) ? latest!.id : sameCadence(session.initial, candidate) ? session.initial!.id : session.id;
const endOf = (rule: RepeatRule, empty: ChecklistRefreshEnd['mode']): ChecklistRefreshEnd => rule.end ? { mode: 'date', date: rule.end } : { mode: empty };

/** Writes a task's repeat in one edit. Leaving "reopen in place" freezes this round's checkmarks as ordinary ones. */
export async function setTaskRepeat(taskId: string, next: TaskRepeat, session: RepeatSession) {
    await editTask(taskId, (latest, clock) => {
        const tasks = useTaskStore.getState()._allTasks, old = checklistTargetPolicy(latest);
        const patch: Partial<Task> = {};
        let policy = old;
        if (next.kind === 'reopen') {
            const candidate = scheduleFromRule(next.rule, '');
            const schedule = { ...candidate, id: versionFor(candidate, old?.schedule, session) };
            policy = makeChecklistPolicy(old, { mode: 'custom', schedule, end: endOf(next.rule, 'never'), paused: next.paused }, clock.now, clock.deviceId);
        } else if (old && old.mode !== 'off') {
            policy = makeChecklistPolicy(old, { mode: 'off', schedule: undefined, end: { mode: 'never' }, paused: false }, clock.now, clock.deviceId);
        }
        if (policy !== old) patch.planner = { ...taskPlanner(latest), checklistRefresh: updateChecklistPolicy(latest, undefined, policy!) };
        if (next.kind === 'copy') patch.recurrence = recurrenceFromRule(next.rule, latest.recurrence);
        else if (latest.recurrence) patch.recurrence = undefined;
        const after = { ...latest, ...patch };
        const frozen = checklistFreezeUpdates(tasks, tasks.map(t => t.id === latest.id ? after : t), [latest.id], clock.now).get(latest.id);
        if (frozen) patch.checklist = frozen;
        return patch;
    });
}

/** The checklist refresh a new task starts with when it reopens in place. */
export function newTaskRefresh(next: TaskRepeat, now: Date, deviceId: string): ChecklistRefreshData | undefined {
    if (next.kind !== 'reopen') return undefined;
    const defaults = makeChecklistPolicy(undefined, { mode: 'custom', schedule: scheduleFromRule(next.rule, generateUUID()), end: endOf(next.rule, 'never'), paused: next.paused }, now, deviceId);
    return { version: 1, defaults, items: {}, marks: {} };
}

/** A step follows the task's rule, has its own, or does not repeat. */
export async function setStepRepeat(taskId: string, itemId: string, next: StepRepeat, session: RepeatSession) {
    await editTask(taskId, (latest, clock) => {
        const tasks = useTaskStore.getState()._allTasks, old = checklistTargetPolicy(latest, itemId);
        let values: Parameters<typeof makeChecklistPolicy>[1];
        if (next.kind === 'own') {
            const candidate = scheduleFromRule(next.rule, '');
            values = { mode: 'custom', schedule: { ...candidate, id: versionFor(candidate, old?.schedule, session) }, end: endOf(next.rule, 'never'), paused: false };
        } else values = { mode: next.kind === 'none' ? 'off' : 'inherit', schedule: undefined, end: { mode: 'inherit' }, paused: false };
        const policy = makeChecklistPolicy(old, values, clock.now, clock.deviceId);
        const patch: Partial<Task> = { planner: { ...taskPlanner(latest), checklistRefresh: updateChecklistPolicy(latest, itemId, policy) } };
        const after = { ...latest, ...patch };
        const frozen = checklistFreezeUpdates(tasks, tasks.map(t => t.id === latest.id ? after : t), [latest.id], clock.now).get(latest.id);
        if (frozen) patch.checklist = frozen;
        return patch;
    });
}
