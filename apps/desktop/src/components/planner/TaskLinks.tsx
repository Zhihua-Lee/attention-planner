import { useState } from 'react';
import { useTaskStore, type Task } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { placeTaskWithUndo } from '../../lib/move-task-with-undo';
import { TaskMovePicker } from './TaskMovePicker';

/**
 * A task link is only a pointer to another task (any project or area). It groups the two
 * visually in flat lists and nothing else: no creation inside, no shared dates, completion or planning.
 */
export function TaskLinks({ task, onOpenTask, onBusyChange }: { task: Task; onOpenTask: (id: string) => void; onBusyChange: (busy: boolean) => void }) {
    const tasks = useTaskStore(state => state.tasks);
    const { language } = useLanguage(), zh = language.startsWith('zh');
    const l = (en: string, cn: string) => zh ? cn : en;
    const target = task.parentTaskId ? tasks.find(candidate => candidate.id === task.parentTaskId) : undefined;
    const linkedHere = tasks.filter(candidate => candidate.parentTaskId === task.id && candidate.id !== task.id);
    const [picking, setPicking] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const unlink = async () => {
        setBusy(true); onBusyChange(true); setError('');
        try { await placeTaskWithUndo(task.id, undefined, 'inside', zh); }
        catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { setBusy(false); onBusyChange(false); }
    };
    const button = 'min-h-11 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40';
    return <section aria-label={l('Linked tasks', '关联任务')} className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{l('Linked to', '关联到')}</span>
            {task.parentTaskId
                ? target ? <button className="min-h-11 min-w-0 break-words text-left underline" onClick={() => onOpenTask(target.id)}>{target.title}</button>
                    : <span className="text-muted-foreground">{l('Unavailable', '已不可用')}</span>
                : <span className="text-muted-foreground">{l('None', '无')}</span>}
            <span className="ml-auto flex gap-2">
                <button className={button} disabled={busy || !!task.deletedAt} onClick={() => setPicking(true)}>{task.parentTaskId ? l('Change…', '更改…') : l('Link to a task…', '关联到任务…')}</button>
                {task.parentTaskId && <button className={button} disabled={busy} onClick={() => void unlink()}>{l('Remove link', '取消关联')}</button>}
            </span>
        </div>
        {!!linkedHere.length && <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{l('Linked here', '关联到这里的任务')}</p>
            <ul className="flex flex-wrap gap-2">{linkedHere.map(other => <li key={other.id}><button className={`${button} break-words text-left ${other.status === 'done' ? 'text-muted-foreground line-through' : ''}`} onClick={() => onOpenTask(other.id)}>{other.title}</button></li>)}</ul>
        </div>}
        <p className="text-xs text-muted-foreground">{l('A link only places the tasks together in lists. Content, dates, completion and planning stay independent.', '关联只让两个任务在列表里排在一起；正文、时间、完成和推荐各自独立。')}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {picking && <TaskMovePicker taskId={task.id} onClose={() => setPicking(false)} />}
    </section>;
}
