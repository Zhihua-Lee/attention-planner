import { useTaskStore, type ChecklistItem, type Task } from '@mindwtr/core';
import { editTask } from './lifecycle-actions';
import { registerUndoableAction } from './undo-registry';
import { useUiStore } from '../store/ui-store';

/**
 * In-place edits commit one field or one checklist item at a time, against the latest stored task.
 * A text field only overwrites the value it started from; if another device changed it meanwhile,
 * a FieldConflict is raised so the editor can ask which version to keep.
 */
export class FieldConflict extends Error {
    constructor(readonly latest: string) { super('This field was changed elsewhere.'); }
}
type TextField = 'title' | 'description';
const normalize = (key: TextField, value: string) => key === 'description' ? (value.trim() ? value : undefined) : value.trim();

export async function commitTaskText(taskId: string, key: TextField, base: string, next: string, force = false) {
    if (key === 'title' && !next.trim()) throw new Error('A task needs a name.');
    await editTask(taskId, latest => {
        const current = latest[key] ?? '', value = normalize(key, next);
        if (current === (value ?? '')) return {};
        if (!force && current !== base) throw new FieldConflict(current);
        return { [key]: value } as Partial<Task>;
    });
}

const items = (task: Task): ChecklistItem[] => task.checklist ?? [];

export async function renameChecklistItem(taskId: string, itemId: string, base: string, next: string, force = false) {
    await editTask(taskId, latest => {
        const item = items(latest).find(entry => entry.id === itemId);
        if (!item) throw new Error('This step no longer exists.');
        if (item.title === next) return {};
        if (!force && item.title !== base) throw new FieldConflict(item.title);
        return { checklist: items(latest).map(entry => entry.id === itemId ? { ...entry, title: next } : entry) };
    });
}

/** Inserts after `afterId` (or first when null). The caller's id is kept so focus can stay on the row. */
export async function insertChecklistItem(taskId: string, afterId: string | null, item: { id: string; title: string }) {
    await editTask(taskId, latest => {
        const list = items(latest);
        if (list.some(entry => entry.id === item.id)) return {};
        const index = afterId === null ? 0 : list.findIndex(entry => entry.id === afterId) + 1;
        const next = [...list];
        next.splice(index > 0 || afterId === null ? index : list.length, 0, { id: item.id, title: item.title, isCompleted: false });
        return { checklist: next };
    });
}

export async function moveChecklistItem(taskId: string, itemId: string, toIndex: number) {
    await editTask(taskId, latest => {
        const list = [...items(latest)], from = list.findIndex(entry => entry.id === itemId);
        if (from < 0) throw new Error('This step no longer exists.');
        const target = Math.max(0, Math.min(list.length - 1, toIndex));
        if (from === target) return {};
        const [item] = list.splice(from, 1);
        list.splice(target, 0, item);
        return { checklist: list };
    });
}

/** Removes a step with an undo that restores it at its position, unless it was re-added meanwhile. */
export async function removeChecklistItem(taskId: string, itemId: string, zh: boolean) {
    let removed: { item: ChecklistItem; afterId: string | null } | undefined;
    await editTask(taskId, latest => {
        const list = items(latest), index = list.findIndex(entry => entry.id === itemId);
        if (index < 0) return {};
        removed = { item: list[index], afterId: index > 0 ? list[index - 1].id : null };
        const rest = list.filter(entry => entry.id !== itemId);
        return { checklist: rest.length ? rest : undefined };
    });
    if (!removed) return;
    const { item, afterId } = removed;
    const undo = registerUndoableAction(() => {
        void editTask(taskId, latest => {
            const list = items(latest);
            if (list.some(entry => entry.id === item.id)) return {};
            const index = afterId === null ? 0 : list.findIndex(entry => entry.id === afterId) + 1;
            const next = [...list];
            next.splice(index > 0 || afterId === null ? index : list.length, 0, item);
            return { checklist: next };
        }).catch(error => useUiStore.getState().showToast(error instanceof Error ? error.message : String(error), 'error'));
    });
    if (useTaskStore.getState().settings.undoNotificationsEnabled !== false) {
        useUiStore.getState().showToast(zh ? '已删除步骤' : 'Step deleted', 'info', 8000, { label: zh ? '撤销' : 'Undo', onClick: undo });
    }
}
