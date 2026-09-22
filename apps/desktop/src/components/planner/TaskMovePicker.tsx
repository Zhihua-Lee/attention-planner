import { useEffect, useMemo, useRef, useState } from 'react';
import { taskParentError, useTaskStore } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { useVisibleViewport } from '../../hooks/use-visible-viewport';
import { isInputComposition } from '../../lib/input-method';
import { moveTaskWithUndo } from '../../lib/move-task-with-undo';
import { ModalPortal } from '../ModalPortal';
import { useDialogHistory } from './useDialogHistory';

export function TaskMovePicker({ taskId, onClose }: { taskId: string; onClose: () => void }) {
    const tasks = useTaskStore(state => state._allTasks);
    const task = tasks.find(item => item.id === taskId);
    const { language } = useLanguage(), zh = language.startsWith('zh');
    const l = (en: string, cn: string) => zh ? cn : en;
    const [query, setQuery] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const lock = useRef(false), panel = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
    const viewport = useVisibleViewport();
    const close = useDialogHistory(true, () => { if (lock.current) return false; onClose(); return true; });
    const candidates = useMemo(() => tasks.filter(candidate => !candidate.deletedAt && !candidate.purgedAt
        && !taskParentError(tasks, taskId, candidate.id)), [tasks, taskId]);
    const visible = candidates.filter(candidate => candidate.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        search.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, []);
    const move = async (parentTaskId?: string) => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError('');
        try { await moveTaskWithUndo(taskId, parentTaskId, zh); lock.current = false; close(); }
        catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { lock.current = false; setBusy(false); }
    };
    const button = 'min-h-11 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-40';
    return <ModalPortal><div style={viewport} className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-2 sm:items-center sm:p-6" onClick={event => { if (event.target === event.currentTarget) close(); }}>
        <div ref={panel} role="dialog" aria-modal="true" aria-label={l('Move task', '移动任务')} data-planner-form className="flex max-h-full w-full max-w-lg flex-col rounded-xl border border-border bg-card p-4 text-foreground shadow-xl" onKeyDown={event => {
            event.stopPropagation();
            if (isInputComposition(event.nativeEvent)) return;
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key === 'Tab') {
                const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
                const first = controls[0], last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        }}>
            <header className="mb-3 flex shrink-0 items-center justify-between gap-2"><h2 className="min-w-0 break-words font-semibold">{l('Move', '移动')}：{task?.title}</h2><button className={button} disabled={busy} onClick={() => close()}>{l('Cancel', '取消')}</button></header>
            <p className="mb-3 text-xs text-muted-foreground">{l('Only the parent changes. Content, dates, reminders and completion stay independent.', '只改变父子归属，正文、日期、提醒和完成状态保持独立。')}</p>
            <input ref={search} className="mb-3 min-h-11 w-full shrink-0 rounded-lg border border-border bg-background px-3" aria-label={l('Find parent task', '搜索父任务')} placeholder={l('Find a task…', '搜索任务…')} value={query} onChange={event => setQuery(event.target.value)} disabled={busy} />
            {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
            <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
                {task?.parentTaskId && <button className={`${button} w-full`} disabled={busy} onClick={() => move()}>{l('Move out · top-level task', '移出 · 成为顶层任务')}</button>}
                {visible.map(candidate => <button key={candidate.id} className={`${button} block w-full break-words`} disabled={busy || candidate.id === task?.parentTaskId} onClick={() => move(candidate.id)}>{candidate.title}{candidate.id === task?.parentTaskId ? l(' · current parent', ' · 当前父任务') : ''}</button>)}
                {!visible.length && <p className="py-4 text-sm text-muted-foreground">{l('No matching parent. A task cannot contain itself or its ancestors.', '没有匹配的父任务，不能移入自己或自己的子孙任务。')}</p>}
            </div>
        </div>
    </div></ModalPortal>;
}
