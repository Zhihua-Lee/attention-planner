import { useRef, useState } from 'react';
import { checklistHistory, checklistItemState, checklistWallTime, flushPendingSave, useTaskStore, type Task } from '@mindwtr/core';
import { checklistDelayLabel } from '../../lib/checklist-refresh-text';
import { useLanguage } from '../../contexts/language-context';
import { setChecklistCompletion } from '../../lib/checklist-refresh-actions';
import { usePlannerEnvironment } from './usePlannerEnvironment';

/** Only the checkbox completes a step; its text opens it for editing (when `onEditStep` is given). */
export function ChecklistProgress({ task, closed = false, allowPromote = false, onBusyChange, onEditStep }: {
    task: Task; closed?: boolean; allowPromote?: boolean; onBusyChange?: (busy: boolean) => void; onEditStep?: (stepId: string) => void;
}) {
    const tasks = [task], { now } = usePlannerEnvironment();
    const { language } = useLanguage(), zh = language.startsWith('zh'), l = (en: string, cn: string) => zh ? cn : en;
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), lock = useRef(false);
    const run = async (action: () => Promise<unknown>) => {
        if (lock.current) return;
        lock.current = true; setBusy(true); onBusyChange?.(true); setError('');
        try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
    };
    return <section aria-label={l('Steps', '步骤')} className="space-y-2" data-testid="checklist-progress">
        {task.checklist?.map(step => {
            const state = checklistItemState(task, step, tasks, now);
            const history = state.recurring || task.planner?.checklistRefresh?.marks[step.id]
                ? checklistHistory(task, step, tasks, now) : [];
            return <div key={step.id} className="rounded-lg border border-border p-3" data-checklist-item={step.id}>
                <div className="flex items-start gap-2">
                    <div className="flex min-h-11 min-w-0 flex-1 items-start gap-1">
                        <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-muted">
                            <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={step.title}
                                checked={state.completed} disabled={busy || closed || state.recurring && !state.cycle}
                                onChange={event => void run(() => setChecklistCompletion(task.id, [{ itemId: step.id, completed: event.target.checked, cycleId: state.cycle?.id }], zh))} />
                        </label>
                        {onEditStep
                            ? <button type="button" data-step-text={step.id} title={l('Click to edit', '点击编辑')} onClick={() => onEditStep(step.id)}
                                className={`min-h-11 min-w-0 flex-1 cursor-text break-words rounded-lg px-1 py-2 text-left text-sm hover:bg-muted/60 ${state.completed ? 'text-muted-foreground line-through' : ''}`}>{step.title}</button>
                            : <span className={`min-w-0 flex-1 break-words py-3 text-sm ${state.completed ? 'text-muted-foreground line-through' : ''}`}>{step.title}</span>}
                    </div>
                    {allowPromote && !state.completed && !closed && <button type="button" className="min-h-11 shrink-0 rounded-lg px-2 text-xs text-primary hover:bg-muted" disabled={busy}
                        aria-label={`${l('Move step to Inbox', '提升为独立任务')}: ${step.title}`} onClick={() => void run(async () => {
                            const result = await useTaskStore.getState().promoteChecklistItem(task.id, step.id);
                            if (!result.success) throw new Error(result.error);
                            await flushPendingSave();
                        })}>{l('Make task', '独立成任务')}</button>}
                </div>
                {state.recurring && <p className="ml-12 text-xs leading-5 text-muted-foreground" data-checklist-cycle={state.cycle?.id ?? 'pending'}>
                    {state.cycle ? l(`Round ${state.cycle.day}`, `本轮 ${state.cycle.day}`) : l('First round not started', '首轮尚未开始')}
                    {state.paused ? l(' · paused', ' · 已暂停') : state.ended ? l(' · ended', ' · 已结束刷新')
                        : state.next ? l(` · Next ${checklistWallTime(state.next.dueAt, state.schedule!.timeZone)}`, ` · 下次 ${checklistWallTime(state.next.dueAt, state.schedule!.timeZone)}`)
                        : state.cycle && state.schedule!.anchor === 'completion' ? l(` · refreshes ${checklistDelayLabel(state.schedule!, zh)}`, ` · ${checklistDelayLabel(state.schedule!, zh)}刷新`) : ''}
                    {` · ${state.schedule!.timeZone}`}
                </p>}
                {!!history.length && <details className="ml-12 mt-1 text-xs"><summary className="min-h-11 cursor-pointer content-center text-muted-foreground">{l('Completion history', '完成历史')}</summary>
                    <div className="space-y-1 pb-2">{history.map(round => <p key={round.id}>{round.day} · {round.completed ? l('Completed', '已完成') : round.current ? l('Current · pending', '本轮待办') : l('Not completed', '未完成')}</p>)}</div>
                </details>}
            </div>;
        })}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>;
}
