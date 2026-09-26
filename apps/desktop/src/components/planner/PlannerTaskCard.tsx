import { useRef, useState } from 'react';
import { ArrowRight, Inbox, Trash2 } from 'lucide-react';
import { flushPendingSave, useTaskStore, type Task } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { editTask, openTaskDetails } from '../../lib/lifecycle-actions';
import { completeTaskWithUndo } from '../../lib/complete-task-with-undo';
import { returnTaskToInbox } from '../../lib/return-task-to-inbox';
import { registerUndoableAction } from '../../lib/undo-registry';
import { useUiStore } from '../../store/ui-store';

export function PlannerTaskCard({ task, blocked }: { task: Task; blocked: boolean }) {
    const { language, t } = useLanguage(), zh = language.startsWith('zh');
    const l = (en: string, cn: string) => zh ? cn : en;
    const lock = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const run = async (action: () => Promise<unknown>) => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError('');
        try { await action(); } catch (failure) { setError(String(failure)); }
        finally { lock.current = false; setBusy(false); }
    };
    const iconButton = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40';
    const trash = async () => {
        const result = await useTaskStore.getState().deleteTask(task.id);
        if (!result.success) throw new Error(result.error);
        await flushPendingSave();
        const deletedAt = useTaskStore.getState()._allTasks.find(item => item.id === task.id)?.deletedAt;
        const undo = registerUndoableAction(() => { void (async () => {
                const latest = useTaskStore.getState()._allTasks.find(item => item.id === task.id);
                if (!latest || latest.purgedAt || !deletedAt || latest.deletedAt !== deletedAt) throw new Error(l('Task changed since deletion; the newer state was kept.', '删除后任务又有变化，未覆盖较新的状态。'));
                const result = await useTaskStore.getState().restoreTask(task.id);
                if (!result.success) throw new Error(result.error);
                await flushPendingSave();
            })().catch(failure => useUiStore.getState().showToast(String(failure), 'error')); });
        useUiStore.getState().showToast(l('Moved to Trash', '已移到回收站'), 'info', 12000, {
            label: l('Undo', '撤销'), onClick: undo,
        });
    };
    return <article data-task-id={task.id} className="min-w-0 rounded-lg border border-border bg-card p-2 sm:p-3">
        <div className="flex items-start gap-1 pr-11">
            <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md hover:bg-muted">
                <input type="checkbox" checked={task.status === 'done'} disabled={busy}
                    aria-label={task.status === 'done' ? l('Reopen task', '重新打开任务') : l('Complete task', '完成任务')}
                    className="h-5 w-5 cursor-pointer accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    onChange={() => void run(async () => {
                        if (task.status === 'done') await editTask(task.id, () => ({ status: 'next' }));
                        else if (!(await completeTaskWithUndo(task.id, t))) throw new Error(l('Could not save completion.', '未能保存完成操作。'));
                    })} />
            </label>
            <button className={`min-h-11 min-w-0 flex-1 break-words py-2 text-left text-sm font-medium [overflow-wrap:anywhere] hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${task.status === 'done' ? 'text-muted-foreground line-through' : ''}`} onClick={() => openTaskDetails(task.id)}>{task.title}</button>
        </div>
        <div className="ml-12 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {task.availableAt && <span>{l('Available', '可做起始')} {task.availableAt}</span>}
            {task.dueDate && <span>{l('Due', '截止')} {task.dueDate}</span>}
            {!!task.checklist?.length && <span>{l('Steps', '步骤')} {task.checklist.filter(step => step.isCompleted).length}/{task.checklist.length}</span>}
            {blocked && task.status !== 'inbox' && <span>{l('Not executable yet; plan kept', '目前不可执行，计划保留')}</span>}
        </div>
        <div className="ml-12 flex items-center justify-between gap-1">
            {task.status === 'inbox' ? <button disabled={busy} className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40" onClick={() => void run(() => editTask(task.id, () => ({ status: 'next' })))}>{l('Ready to plan', '加入待办')}<ArrowRight aria-hidden="true" className="h-4 w-4" /></button> : <span />}
            <div className="flex shrink-0">
                {!['inbox', 'done', 'archived', 'reference'].includes(task.status) && <button disabled={busy} className={iconButton} aria-label={l('Move to Inbox', '移回收集箱')} title={l('Move to Inbox · keep existing plans', '移回收集箱 · 保留原安排')} onClick={() => void run(() => returnTaskToInbox(task.id, zh))}><Inbox aria-hidden="true" className="h-4 w-4" /></button>}
                <button disabled={busy} className={`${iconButton} hover:text-destructive`} aria-label={l('Delete task', '删除任务')} title={l('Move to Trash', '移到回收站')} onClick={() => void run(trash)}><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
            </div>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </article>;
}
