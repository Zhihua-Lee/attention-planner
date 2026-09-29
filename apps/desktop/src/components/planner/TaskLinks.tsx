import { useState } from 'react';
import { X } from 'lucide-react';
import { useTaskStore, type Task } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { placeTaskWithUndo } from '../../lib/move-task-with-undo';
import { TaskMovePicker } from './TaskMovePicker';

/**
 * A task link is only a pointer to another task (any project or area). It groups the two
 * visually in flat lists and nothing else: no shared dates, completion or planning.
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
    const small = 'min-h-9 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';
    return <div aria-label={l('Linked tasks', '关联任务')} role="group" className="w-full space-y-1">
        <div className="flex flex-wrap items-center gap-1">
            {task.parentTaskId && (target
                ? <span className="inline-flex min-h-9 items-center rounded-md bg-muted text-sm">
                    <button className="min-h-9 min-w-0 break-words rounded-l-md px-2 text-left hover:underline" onClick={() => onOpenTask(target.id)}>{target.title}</button>
                    <button className="flex min-h-9 items-center rounded-r-md px-1.5 hover:bg-background" aria-label={l('Remove link', '取消关联')} disabled={busy} onClick={() => void unlink()}><X className="h-3.5 w-3.5" /></button>
                </span>
                : <span className="text-sm text-muted-foreground">{l('Unavailable', '已不可用')}</span>)}
            <button className={small} disabled={busy || !!task.deletedAt} onClick={() => setPicking(true)}>{task.parentTaskId ? l('Change…', '更改…') : l('Link to a task…', '关联到任务…')}</button>
        </div>
        {!!linkedHere.length && <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">{l('Linked here', '关联到这里的任务')}</span>
            {linkedHere.map(other => <button key={other.id} className={`min-h-9 rounded-md bg-muted/60 px-2 text-sm hover:bg-muted ${other.status === 'done' ? 'text-muted-foreground line-through' : ''}`} onClick={() => onOpenTask(other.id)}>{other.title}</button>)}
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {picking && <TaskMovePicker taskId={task.id} onClose={() => setPicking(false)} />}
    </div>;
}
