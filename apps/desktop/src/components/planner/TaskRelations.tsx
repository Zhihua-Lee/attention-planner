import { useEffect, useRef, useState } from 'react';
import { flushPendingSave, useTaskStore, type Task } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { ensurePlannerBackup } from '../../lib/lifecycle-actions';
import { isInputComposition } from '../../lib/input-method';
import { TaskMovePicker } from './TaskMovePicker';

export function TaskRelations({ task, onOpenTask, onBusyChange }: { task: Task; onOpenTask: (id: string) => void; onBusyChange: (busy: boolean) => void }) {
    const tasks = useTaskStore(state => state.tasks);
    const { language } = useLanguage(), zh = language.startsWith('zh');
    const l = (en: string, cn: string) => zh ? cn : en;
    const parent = tasks.find(candidate => candidate.id === task.parentTaskId);
    const children = tasks.filter(candidate => candidate.parentTaskId === task.id && candidate.id !== task.id);
    const draftKey = `attention-planner:subtask-draft:v1:${task.id}`;
    const [restored] = useState<{ title: string; pendingId?: string }>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
            return saved && typeof saved.title === 'string' ? saved : { title: '' };
        } catch { return { title: '' }; }
    });
    const [moving, setMoving] = useState(false), [adding, setAdding] = useState(!!restored.title), [title, setTitle] = useState(restored.title), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const lock = useRef(false), pending = useRef<string | null>(restored.pendingId ?? null);
    useEffect(() => {
        try {
            if (title) localStorage.setItem(draftKey, JSON.stringify({ title, pendingId: pending.current }));
            else localStorage.removeItem(draftKey);
        } catch { setError(l('Draft could not be saved locally. Keep this view open.', '无法保存本地草稿，请保持当前页面打开。')); }
    }, [title, draftKey]);
    const add = async () => {
        if (lock.current || !title.trim()) return;
        lock.current = true; setBusy(true); onBusyChange(true); setError('');
        try {
            await ensurePlannerBackup();
            if (pending.current && !useTaskStore.getState().tasks.some(item => item.id === pending.current)) throw new Error(l('The pending subtask is unavailable. Clear the draft explicitly before creating a replacement.', '待保存子任务已不可用。如需重新创建，请先明确清除草稿。'));
            const result = pending.current ? { success: true, id: pending.current } : await useTaskStore.getState().addTask(title, { parentTaskId: task.id, status: 'inbox' });
            if (!result.success || !result.id) throw new Error('error' in result ? result.error : 'Could not add task.');
            pending.current = result.id;
            localStorage.setItem(draftKey, JSON.stringify({ title, pendingId: result.id }));
            await flushPendingSave();
            localStorage.removeItem(draftKey);
            setTitle(''); setAdding(false); pending.current = null;
            onOpenTask(result.id);
        } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { lock.current = false; setBusy(false); onBusyChange(false); }
    };
    const button = 'min-h-11 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40';
    return <section aria-label={l('Independent subtasks', '独立子任务')} className="space-y-3 rounded-lg border border-border p-3">
        {task.parentTaskId && <p className="text-sm">{l('Parent', '父任务')}：{parent ? <button className="min-h-11 break-words text-left underline" onClick={() => onOpenTask(parent.id)}>{parent.title}</button> : l('Unavailable · this task remains independent', '已不可用 · 当前任务仍独立保留')}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">{l('Independent subtasks', '独立子任务')}{children.length > 0 && ` · ${children.filter(child => child.status === 'done').length}/${children.length}`}</h2><button className={button} onClick={() => setMoving(true)}>{l('Move task…', '移动任务…')}</button></div>
        <p className="text-xs text-muted-foreground">{l('Each subtask has its own content, dates and completion. No project required; parent dates do not cascade.', '每个子任务都有自己的正文、时间和完成状态。不必建立项目，也不会继承父任务日期。')}</p>
        {!!children.length && <ul className="space-y-2">{children.map(child => <li key={child.id}><button className={`${button} flex w-full flex-col items-start gap-1 text-left`} onClick={() => onOpenTask(child.id)}><span className={`break-words ${child.status === 'done' ? 'text-muted-foreground line-through' : ''}`}>{child.title}</span><span className="text-xs text-muted-foreground">{child.status === 'done' ? l('Completed', '已完成') : l('Open · view / arrange', '未完成 · 查看／安排')}{child.dueDate && ` · ${l('Due', '截止')} ${child.dueDate}`}</span></button></li>)}</ul>}
        {!task.deletedAt && (adding ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void add(); }}>
            <label className="block text-sm">{l('Subtask name', '子任务名称')}<input autoFocus className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-3" value={title} disabled={busy || !!pending.current} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (isInputComposition(event.nativeEvent) && event.key === 'Enter') event.preventDefault(); }} /></label>
            <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !title.trim()}>{l('Add and open', '添加并打开')}</button><button className={button} type="button" disabled={busy || !!pending.current} onClick={() => setAdding(false)}>{l('Cancel', '取消')}</button></div>
        </form> : <button className={button} onClick={() => setAdding(true)}>{l('Add subtask', '添加子任务')}</button>)}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {pending.current && !tasks.some(item => item.id === pending.current) && <button className={button} disabled={busy} onClick={() => { pending.current = null; setTitle(''); setError(''); }}>{l('Clear unavailable draft', '清除不可用的草稿')}</button>}
        {moving && <TaskMovePicker taskId={task.id} onClose={() => setMoving(false)} />}
    </section>;
}
