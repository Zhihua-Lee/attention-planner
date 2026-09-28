import type { Task } from './types';
import { contentDraftPatch, taskPlanner } from './planner';
import { changeChecklistCompletion, checklistItemState, checklistRefreshData, type ChecklistDraftState } from './checklist-refresh';

/** A content draft may outlive a refresh boundary; never apply its checkbox to a different round. */
export function checklistContentDraftPatch(base: Partial<Task>, draft: Partial<Task>, latest: Task,
    tasks: readonly Task[], snapshot: ChecklistDraftState, now: Date, deviceId: string): Partial<Task> {
    const mask = (items: Task['checklist']) => items?.map(item => snapshot[item.id]?.recurring ? { ...item, isCompleted: false } : item);
    const patch = contentDraftPatch({ ...base, checklist: mask(base.checklist) }, { ...draft, checklist: mask(draft.checklist) }, { ...latest, checklist: mask(latest.checklist) });
    if (Object.prototype.hasOwnProperty.call(patch, 'checklist')) {
        patch.checklist = patch.checklist?.map(item => snapshot[item.id]?.recurring
            ? { ...item, isCompleted: latest.checklist?.find(old => old.id === item.id)?.isCompleted ?? false } : item);
    }
    const task = { ...latest, ...patch };
    const changes: Array<{ itemId: string; completed: boolean; cycleId?: string }> = [];
    for (const item of draft.checklist ?? []) {
        if (!item.title.trim() || !task.checklist?.some(old => old.id === item.id)) continue;
        const before = snapshot[item.id], state = checklistItemState(task, item, tasks, now);
        if (before && item.isCompleted === before.completed) continue;
        if (!before && base.checklist?.some(old => old.id === item.id)) {
            if (state.recurring && item.isCompleted !== latest.checklist?.find(old => old.id === item.id)?.isCompleted) {
                throw new Error('This older draft has no period snapshot. Reopen the current checklist before changing its checkboxes.');
            }
            continue;
        }
        if (!state.recurring && !before?.recurring) continue;
        if (before && (before.recurring !== state.recurring || before.cycleId !== state.cycle?.id)) throw new Error('The checklist period changed while editing. Your text draft is kept; reopen the current round before changing completion.');
        if (!before && !item.isCompleted) continue;
        const mark = state.cycle ? checklistRefreshData(latest).marks[item.id]?.[state.cycle.id] : undefined;
        if (before && JSON.stringify(mark) !== JSON.stringify(before.mark) && state.completed !== item.isCompleted) throw new Error('This checkbox changed on another device. Review the latest completion before saving.');
        changes.push({ itemId: item.id, completed: item.isCompleted, cycleId: state.cycle?.id });
    }
    if (changes.length) {
        const changed = changeChecklistCompletion(task, tasks, changes, now, deviceId);
        patch.planner = { ...taskPlanner(latest), checklistRefresh: changed.refresh };
        // Period completion lives in the ledger; the raw flag of a refreshing item keeps its stored (or default) value.
        const recurring = new Set(changes.filter(change => change.cycleId).map(change => change.itemId));
        if (Object.prototype.hasOwnProperty.call(patch, 'checklist')) patch.checklist = changed.checklist.map(item => recurring.has(item.id)
            ? { ...item, isCompleted: latest.checklist?.find(old => old.id === item.id)?.isCompleted ?? false } : item);
    }
    return patch;
}
