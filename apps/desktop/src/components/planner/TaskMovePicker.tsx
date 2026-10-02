import { useEffect, useMemo, useRef, useState } from 'react';
import { taskParentError, useTaskStore, type TaskDropPosition } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { useVisibleViewport } from '../../hooks/use-visible-viewport';
import { isInputComposition } from '../../lib/input-method';
import { placeTaskWithUndo } from '../../lib/move-task-with-undo';
import { ModalPortal } from '../ModalPortal';
import { InfoTip } from '../ui/InfoTip';
import { useDialogHistory } from './useDialogHistory';

export function TaskMovePicker({ taskId, onClose, previousTaskId, nextTaskId }: {
    taskId: string; onClose: () => void; previousTaskId?: string; nextTaskId?: string;
}) {
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
    const move = async (targetId?: string, position: TaskDropPosition = 'inside') => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError('');
        try { await placeTaskWithUndo(taskId, targetId, position, zh); lock.current = false; close(); }
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
            <header className="mb-3 flex shrink-0 items-center justify-between gap-2"><h2 className="min-w-0 break-words font-semibold">{l('Move or link', '移动或关联')}：{task?.title} <InfoTip label={l('About links', '关于关联')}>{l('Change the order, or link this task to another one so they sit together in lists. Content, dates and completion stay independent.', '调整顺序，或关联到另一个任务，让两者在列表中排在一起；正文、时间和完成状态各自独立。')}</InfoTip></h2><button className={button} disabled={busy} onClick={() => close()}>{l('Cancel', '取消')}</button></header>
            {(previousTaskId || nextTaskId) && <div role="group" aria-label={l('Task order', '任务顺序')} className="mb-4 flex gap-2">
                <button className={`${button} flex-1`} disabled={busy || !previousTaskId} onClick={() => move(previousTaskId, 'before')}>{l('Move up', '上移')}</button>
                <button className={`${button} flex-1`} disabled={busy || !nextTaskId} onClick={() => move(nextTaskId, 'after')}>{l('Move down', '下移')}</button>
            </div>}
            <input ref={search} className="mb-3 min-h-11 w-full shrink-0 rounded-lg border border-border bg-background px-3" aria-label={l('Find a task to link', '搜索要关联的任务')} placeholder={l('Find a task…', '搜索任务…')} value={query} onChange={event => setQuery(event.target.value)} disabled={busy} />
            {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
            <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
                {task?.parentTaskId && <button className={`${button} w-full`} disabled={busy} onClick={() => move()}>{l('Remove link', '取消关联')}</button>}
                {visible.map(candidate => <button key={candidate.id} className={`${button} block w-full break-words`} disabled={busy || candidate.id === task?.parentTaskId} onClick={() => move(candidate.id)}>{candidate.title}{candidate.id === task?.parentTaskId ? l(' · current link', ' · 当前关联') : ''}</button>)}
                {!visible.length && <p className="py-4 text-sm text-muted-foreground">{l('No matching task. A task cannot link to itself or form a loop.', '没有匹配的任务；不能关联到自己或形成循环。')}</p>}
            </div>
        </div>
    </div></ModalPortal>;
}
