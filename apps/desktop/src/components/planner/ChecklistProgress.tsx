import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUpRight, GripVertical, Plus, Repeat2, Trash2 } from 'lucide-react';
import { checklistHistory, checklistItemState, checklistTargetPolicy, checklistWallTime, flushPendingSave, generateUUID, useTaskStore, type ChecklistItem, type Task } from '@mindwtr/core';
import { checklistDelayLabel } from '../../lib/checklist-refresh-text';
import { useLanguage } from '../../contexts/language-context';
import { setChecklistCompletion, setStepRepeat, type RepeatSession } from '../../lib/checklist-refresh-actions';
import { deviceTimeZone, ruleLabel, stepRepeat, type StepRepeat } from '../../lib/repeat-rules';
import { RepeatMenu } from './RepeatMenu';
import { insertChecklistItem, moveChecklistItem, removeChecklistItem, renameChecklistItem } from '../../lib/task-field-edits';
import { usePlannerEnvironment } from './usePlannerEnvironment';
import { InlineText, SaveTrackerContext, type InlineTextHandle } from './InlineText';

type Row = { item: ChecklistItem; draft: boolean };

/**
 * One checklist for display and editing. Only the checkbox completes a step. With `editable`,
 * step text is edited in place (Enter: next step, Shift+Enter: line break, Backspace on empty: delete);
 * otherwise clicking the text calls `onEditStep` (e.g. NOW opens the task on that step).
 */
export function ChecklistProgress({ task, closed = false, allowPromote = false, onBusyChange, onEditStep, editable = false, focusStepId }: {
    task: Task; closed?: boolean; allowPromote?: boolean; onBusyChange?: (busy: boolean) => void; onEditStep?: (stepId: string) => void;
    editable?: boolean; focusStepId?: string;
}) {
    const tasks = [task], { now } = usePlannerEnvironment();
    const { language } = useLanguage(), zh = language.startsWith('zh'), l = (en: string, cn: string) => zh ? cn : en;
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), lock = useRef(false), { track } = useContext(SaveTrackerContext);
    // Unsaved new steps: they get their final id up front, so focus stays on the row once stored.
    const [drafts, setDrafts] = useState<Array<{ id: string; afterId: string | null }>>([]);
    const handles = useRef(new Map<string, InlineTextHandle>());
    const pendingFocus = useRef<{ id: string; at: 'start' | 'end' } | null>(focusStepId ? { id: focusStepId, at: 'end' } : null);
    const stored = task.checklist ?? [];
    // One step's repeat menu at a time; its session keeps a schedule version stable while editing.
    const [repeatFor, setRepeatFor] = useState<string | null>(null), [session, setSession] = useState<RepeatSession>({ id: '' });
    const toggleRepeat = (id: string) => {
        if (repeatFor === id) { setRepeatFor(null); return; }
        setSession({ id: generateUUID(), initial: checklistTargetPolicy(task, id)?.schedule }); setRepeatFor(id);
    };
    useEffect(() => { setDrafts(current => current.filter(draft => !stored.some(item => item.id === draft.id))); }, [task.checklist]);
    const rows: Row[] = [];
    for (const draft of drafts.filter(d => d.afterId === null)) rows.push({ item: { id: draft.id, title: '', isCompleted: false }, draft: true });
    for (const item of stored) {
        rows.push({ item, draft: false });
        for (const draft of drafts.filter(d => d.afterId === item.id)) rows.push({ item: { id: draft.id, title: '', isCompleted: false }, draft: true });
    }
    for (const draft of drafts.filter(d => d.afterId !== null && !stored.some(item => item.id === d.afterId))) rows.push({ item: { id: draft.id, title: '', isCompleted: false }, draft: true });
    useEffect(() => {
        const target = pendingFocus.current;
        if (target && handles.current.has(target.id)) { handles.current.get(target.id)!.focus(target.at); pendingFocus.current = null; }
    });
    const focusRow = (id: string | undefined, at: 'start' | 'end' = 'end') => { if (id) { pendingFocus.current = { id, at }; handles.current.get(id)?.focus(at); } };
    const run = async (action: () => Promise<unknown>) => {
        if (lock.current) return;
        lock.current = true; setBusy(true); onBusyChange?.(true); setError('');
        try { await track(action()); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
    };
    const addAfter = (afterId: string | null) => {
        const id = generateUUID();
        setDrafts(current => [...current, { id, afterId }]);
        pendingFocus.current = { id, at: 'start' };
    };
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    const dragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const to = stored.findIndex(item => item.id === over.id);
        if (to >= 0) void run(() => moveChecklistItem(task.id, String(active.id), to));
    };
    const body = rows.map((row, index) => {
        const step = row.item, state = row.draft ? undefined : checklistItemState(task, step, tasks, now);
        const history = state && (state.recurring || task.planner?.checklistRefresh?.marks[step.id]) ? checklistHistory(task, step, tasks, now) : [];
        const previous = rows[index - 1]?.item.id, next = rows[index + 1]?.item.id;
        const completed = !!state?.completed;
        const text = editable
            ? <InlineText ref={handle => { if (handle) handles.current.set(step.id, handle); else handles.current.delete(step.id); }}
                value={step.title} ariaLabel={l('Step', '步骤')} placeholder={l('Step…', '写一个步骤…')} disabled={!!task.deletedAt}
                dataAttributes={{ 'data-checklist-input': step.id }}
                className={`py-2 text-sm leading-6 ${completed ? 'text-muted-foreground line-through' : ''}`}
                // A step emptied while typing is not written; leaving it empty removes it (as blank steps never persist).
                onCommit={async (title, base, force) => {
                    if (!title.trim()) return;
                    if (row.draft) await insertChecklistItem(task.id, drafts.find(d => d.id === step.id)?.afterId ?? null, { id: step.id, title });
                    else await renameChecklistItem(task.id, step.id, base, title, force);
                }}
                onBlurEmpty={() => {
                    if (row.draft) setDrafts(current => current.filter(d => d.id !== step.id));
                    else void run(() => removeChecklistItem(task.id, step.id, zh));
                }}
                onKey={(event, api) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (!api.text.trim()) return true;
                        void api.commit().then(() => addAfter(step.id), () => undefined);
                        return true;
                    }
                    if (event.key === 'Backspace' && !api.text && api.caret === 0) {
                        event.preventDefault();
                        if (row.draft) setDrafts(current => current.filter(d => d.id !== step.id));
                        else void run(() => removeChecklistItem(task.id, step.id, zh));
                        focusRow(previous ?? next);
                        return true;
                    }
                    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !row.draft) {
                        event.preventDefault();
                        const at = stored.findIndex(item => item.id === step.id) + (event.key === 'ArrowUp' ? -1 : 1);
                        void run(() => moveChecklistItem(task.id, step.id, at)).then(() => focusRow(step.id));
                        return true;
                    }
                    if (event.key === 'ArrowUp' && api.caret === 0 && previous) { event.preventDefault(); focusRow(previous); return true; }
                    if (event.key === 'ArrowDown' && api.caret === api.text.length && next) { event.preventDefault(); focusRow(next, 'start'); return true; }
                }} />
            : onEditStep
                ? <button type="button" data-step-text={step.id} title={l('Click to edit', '点击编辑')} onClick={() => onEditStep(step.id)}
                    className={`min-h-11 min-w-0 flex-1 cursor-text whitespace-pre-wrap break-words rounded-lg px-1 py-2 text-left text-sm hover:bg-muted/60 ${completed ? 'text-muted-foreground line-through' : ''}`}>{step.title}</button>
                : <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words py-3 text-sm ${completed ? 'text-muted-foreground line-through' : ''}`}>{step.title}</span>;
        const checkbox = <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-muted">
            <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={step.title || l('New step', '新步骤')}
                checked={completed} disabled={row.draft || busy || closed || !!state?.recurring && !state.cycle}
                onChange={event => void run(() => setChecklistCompletion(task.id, [{ itemId: step.id, completed: event.target.checked, cycleId: state?.cycle?.id }], zh))} />
        </label>;
        const own = editable && !row.draft ? stepRepeat(task, step.id) : undefined;
        // On the task page a step that follows the task shows no round line: the task's Repeat row has it.
        const meta = state && (!editable || own?.kind === 'own') && <>
            {state.recurring && <p className="ml-11 text-xs leading-5 text-muted-foreground" data-checklist-cycle={state.cycle?.id ?? 'pending'}>
                {state.cycle ? l(`Round ${state.cycle.day}`, `本轮 ${state.cycle.day}`) : l('First round not started', '首轮尚未开始')}
                {state.paused ? l(' · paused', ' · 已暂停') : state.ended ? l(' · ended', ' · 已结束')
                    : state.next ? l(` · Next ${checklistWallTime(state.next.dueAt, state.schedule!.timeZone)}`, ` · 下次 ${checklistWallTime(state.next.dueAt, state.schedule!.timeZone)}`)
                    : state.cycle && state.schedule!.anchor === 'completion' ? l(` · refreshes ${checklistDelayLabel(state.schedule!, zh)}`, ` · ${checklistDelayLabel(state.schedule!, zh)}刷新`) : ''}
                {state.schedule!.timeZone !== deviceTimeZone() && ` · ${state.schedule!.timeZone}`}
            </p>}
            {!!history.length && <details className="ml-11 text-xs"><summary className="min-h-9 cursor-pointer content-center text-muted-foreground">{l('Completion history', '完成历史')}</summary>
                <div className="space-y-1 pb-2">{history.map(round => <p key={round.id}>{round.day} · {round.completed ? l('Completed', '已完成') : round.current ? l('Current · pending', '本轮待办') : l('Not completed', '未完成')}</p>)}</div>
            </details>}
        </>;
        const repeatChip = own && own.kind !== 'follow' && <button type="button" className="ml-11 inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            data-step-repeat={step.id} onClick={() => toggleRepeat(step.id)}><Repeat2 className="h-3.5 w-3.5" />{own.kind === 'own' ? ruleLabel(own.rule, zh, true) : l('No repeat', '不重复')}</button>;
        const repeatMenu = editable && repeatFor === step.id && own && <div className="ml-11 mt-1"><RepeatMenu scope="step" value={own} disabled={busy}
            onChange={next => void run(() => setStepRepeat(task.id, step.id, next as StepRepeat, session))} /></div>;
        const tools = !row.draft && <>
            {editable && <button type="button" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" disabled={busy}
                title={l('Repeat', '重复')} aria-label={`${l('Repeat', '重复')}: ${step.title}`} aria-expanded={repeatFor === step.id} onClick={() => toggleRepeat(step.id)}><Repeat2 className="h-4 w-4" /></button>}
            {allowPromote && !completed && !closed && <button type="button" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-primary" disabled={busy}
                title={l('Make task', '独立成任务')} aria-label={`${l('Move step to Inbox', '提升为独立任务')}: ${step.title}`} onClick={() => void run(async () => {
                    const result = await useTaskStore.getState().promoteChecklistItem(task.id, step.id);
                    if (!result.success) throw new Error(result.error);
                    await flushPendingSave();
                })}>{editable ? <ArrowUpRight className="h-4 w-4" /> : <span className="px-1 text-xs text-primary">{l('Make task', '独立成任务')}</span>}</button>}
            {editable && <button type="button" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive" disabled={busy}
                title={l('Delete step', '删除步骤')} aria-label={`${l('Delete step', '删除步骤')}: ${step.title}`} onClick={() => void run(() => removeChecklistItem(task.id, step.id, zh))}><Trash2 className="h-4 w-4" /></button>}
        </>;
        return editable
            ? <SortableStep key={step.id} id={step.id} disabled={row.draft || busy} label={l('Drag to reorder', '拖动排序')}>{handle => <>
                <div className="flex items-start">{checkbox}{text}<span className="flex opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">{tools}{!row.draft && handle}</span></div>{repeatChip}{meta}{repeatMenu}
            </>}</SortableStep>
            : <div key={step.id} className="rounded-lg border border-border p-3" data-checklist-item={step.id}>
                <div className="flex items-start gap-2"><div className="flex min-h-11 min-w-0 flex-1 items-start gap-1">{checkbox}{text}</div>{tools}</div>{meta}
            </div>;
    });
    const count = stored.length ? `${stored.filter(item => checklistItemState(task, item, tasks, now).completed).length}/${stored.length}` : '';
    return <section aria-label={l('Steps', '步骤')} className="space-y-1" data-testid="checklist-progress">
        {editable && <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{l('Checklist', '清单')}</h2>{count && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}</div>}
        {editable
            ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
                <SortableContext items={stored.map(item => item.id)} strategy={verticalListSortingStrategy}><div className="space-y-0.5">{body}</div></SortableContext>
            </DndContext>
            : body}
        {editable && !task.deletedAt && <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-muted-foreground hover:bg-muted/60"
            onClick={() => addAfter(stored[stored.length - 1]?.id ?? null)}><Plus className="h-4 w-4" />{l('Add a step', '添加步骤')}</button>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>;
}

/** The drag handle stays in the row's flow: touch layouts widen buttons, so it must never overlay the checkbox. */
function SortableStep({ id, disabled, label, children }: { id: string; disabled: boolean; label: string; children: (handle: ReactNode) => ReactNode }) {
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
    return <div ref={setNodeRef} data-checklist-item={id} style={{ transform: CSS.Transform.toString(transform), transition }}
        className={`group relative rounded-lg hover:bg-muted/30 ${isDragging ? 'z-10 bg-card opacity-80 shadow-md' : ''}`}>
        {children(<button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={label} title={label}
            className="flex min-h-11 min-w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><GripVertical className="h-4 w-4" /></button>)}
    </div>;
}
