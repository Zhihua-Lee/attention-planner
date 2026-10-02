import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X, ArrowLeft, Check, AlertCircle, Loader2, Undo2 } from 'lucide-react';
import { createPlanningPolicy, hasActiveChecklistRound, useTaskStore } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { editTask, setCurrentWork, TASK_OPEN_EVENT, type TaskDetailFocus } from '../../lib/lifecycle-actions';
import { changedParts, editLabel, undoPatch, type EditKey, type TaskEdit } from '../../lib/task-edit-history';
import { completeTaskWithUndo } from '../../lib/complete-task-with-undo';
import { commitTaskText } from '../../lib/task-field-edits';
import { requestSave } from '../../lib/save-shortcut';
import { useUiStore } from '../../store/ui-store';
import { ModalPortal } from '../ModalPortal';
import { RichMarkdown } from '../RichMarkdown';
import { useDialogHistory } from './useDialogHistory';
import { usePlannerEnvironment } from './usePlannerEnvironment';
import { ChecklistProgress } from './ChecklistProgress';
import { InlineText, SaveTrackerContext, type InlineTextHandle, type SaveTracker } from './InlineText';
import { TaskProperties } from './TaskProperties';
import { useVisibleViewport } from '../../hooks/use-visible-viewport';
import { isInputComposition } from '../../lib/input-method';

export function TaskDetailHost() {
  const [stack, setStack] = useState<Array<{ taskId: string; blockId?: string; focus?: TaskDetailFocus }>>([]);
  const selection = stack[stack.length - 1];
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.taskId) setStack(current => current.length ? current : [detail]);
    };
    window.addEventListener(TASK_OPEN_EVENT, receive);
    const taskId = new URLSearchParams(location.search).get('task');
    if (taskId) setStack([{ taskId }]);
    return () => window.removeEventListener(TASK_OPEN_EVENT, receive);
  }, []);
  return selection ? <TaskDetail key={selection.taskId} {...selection} onClose={() => setStack(current => current.slice(0, -1))} onOpenTask={taskId => setStack(current => {
    const index = current.findIndex(item => item.taskId === taskId);
    return index >= 0 ? current.slice(0, index + 1) : [...current, { taskId }];
  })} /> : null;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * A task is one page, edited where it is shown (no separate edit mode): the title, properties,
 * note and checklist each save themselves after a pause, on blur, or with Ctrl/Cmd+S.
 */
function TaskDetail({ taskId, blockId, focus, onClose, onOpenTask }: {
  taskId: string; blockId?: string; focus?: TaskDetailFocus; onClose: () => void; onOpenTask: (taskId: string) => void;
}) {
  const viewport = useVisibleViewport();
  const task = useTaskStore(s => s._allTasks.find(t => t.id === taskId));
  const projects = useTaskStore(s => s.projects), areas = useTaskStore(s => s.areas), tasks = useTaskStore(s => s.tasks);
  const { now } = usePlannerEnvironment();
  const { language, t } = useLanguage(), zh = language.startsWith('zh'), l = (a: string, b: string) => zh ? b : a;
  const panel = useRef<HTMLDivElement>(null), title = useRef<InlineTextHandle>(null), lock = useRef(false);
  const [busy, setBusy] = useState(false), [relationBusy, setRelationBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle'), inFlight = useRef(0);
  // Every save made on this page is remembered as the stored task before and after it, so it can be undone.
  const history = useRef<TaskEdit[]>([]), [undoable, setUndoable] = useState<TaskEdit | undefined>();
  const stored = () => { const found = useTaskStore.getState()._allTasks.find(t => t.id === taskId); return found && structuredClone(found); };
  const tracker = useMemo<SaveTracker>(() => ({
    track: async work => {
      const before = stored();
      inFlight.current++; setSaveState('saving');
      try {
        const result = await work, after = stored();
        if (before && after && changedParts(before, after).length) { history.current.push({ before, after }); setUndoable(history.current[history.current.length - 1]); }
        if (--inFlight.current === 0) setSaveState('saved');
        return result;
      }
      catch (failure) { inFlight.current--; setSaveState('error'); throw failure; }
    },
  }), []);
  const undo = async () => {
    if (lock.current) return;
    // Text still being typed is committed first, so Undo reverts exactly what was just written.
    await requestSave('leave');
    const edit = history.current.pop();
    setUndoable(history.current[history.current.length - 1]);
    if (!edit) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      let conflicts: EditKey[] = [];
      await editTask(taskId, latest => {
        const result = undoPatch(latest, edit);
        conflicts = result.conflicts;
        if (!Object.keys(result.patch).length) throw new Error(l('This change was already changed again, so it was kept.', '这处修改之后又被改过，已保留较新的内容。'));
        return result.patch;
      });
      const label = editLabel(changedParts(edit.before, edit.after), zh);
      useUiStore.getState().showToast(conflicts.length
        ? l(`Undid ${label}; ${editLabel(conflicts, zh)} changed again and was kept.`, `已撤销：${label}；${editLabel(conflicts, zh)}之后又被改过，已保留。`)
        : l(`Undid ${label}.`, `已撤销：${label}`), conflicts.length ? 'info' : 'success', 4000);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  // Leaving commits whatever is still being typed; a failed commit keeps the page open with its message.
  const close = useDialogHistory(true, force => {
    if (force) { onClose(); return true; }
    if (lock.current || relationBusy) return false;
    void requestSave('leave').then(({ ok }) => { if (ok) close(true); else setError(l('Some changes could not be saved. Review the messages before leaving.', '有修改未能保存，请查看提示后再离开。')); });
    return false;
  }, taskId);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (focus === 'title') title.current?.focus(); else if (!focus) panel.current?.focus();
    // Drafts from the former separate edit mode are no longer used.
    try { localStorage.removeItem(`attention-planner:task-draft:v1:${taskId}`); } catch { /* storage unavailable */ }
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (blockId) document.getElementById(`work-${blockId}`)?.scrollIntoView({ block: 'nearest' });
  }, [blockId]);
  /** `tracked: false` for actions with their own undo (completion), so the page history does not duplicate it. */
  const run = async (action: () => Promise<unknown>, success?: string, tracked = true) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await (tracked ? tracker.track(action()) : action()); if (success) useUiStore.getState().showToast(success, 'success'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  const policy = useMemo(() => createPlanningPolicy(tasks, projects, now), [tasks, projects, now]);
  const reason = task ? policy.executionBlock(task) : 'lifecycle';
  const closed = !task || ['done', 'archived', 'reference'].includes(task.status) || !!task.deletedAt;
  const recurringChecklist = !!task && hasActiveChecklistRound(task, [task], now);
  const project = projects.find(p => p.id === task?.projectId), area = areas.find(a => a.id === (project?.areaId || task?.areaId));
  const button = 'min-h-11 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40';
  const status: Record<SaveState, ReactNode> = {
    idle: <span className="text-xs text-muted-foreground">{l('Changes save automatically', '修改自动保存')}</span>,
    saving: <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{l('Saving…', '保存中…')}</span>,
    saved: <span className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" />{l('Saved', '已保存')}</span>,
    error: <span className="flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5" />{l('Not saved', '未能保存')}</span>,
  };
  return <ModalPortal><SaveTrackerContext.Provider value={tracker}><div style={viewport} className="fixed inset-0 z-[65] flex justify-end bg-black/45" onClick={e => {
      if (e.target === e.currentTarget) close();
    }}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={l('Task details', '任务详情')} data-testid="task-details" data-planner-form className="flex h-full w-full max-w-2xl flex-col bg-card text-foreground shadow-2xl outline-none" onKeyDown={e => {
      if (isInputComposition(e.nativeEvent)) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      // Inside a text field Ctrl/Cmd+Z stays the field's own typing undo.
      const inField = (e.target as HTMLElement).closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]');
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); e.stopPropagation(); void undo(); }
      if (e.key === 'Tab') {
        const f = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary') ?? []).filter(x => x.getClientRects().length);
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <button className={button} onClick={() => close()} disabled={busy || relationBusy}><ArrowLeft className="mr-1 inline h-4 w-4" />{l('Back', '返回')}</button>
        <span className="flex items-center gap-2">
          <span role="status" aria-live="polite">{status[saveState]}</span>
          <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            disabled={!undoable || busy} onClick={() => void undo()}
            title={undoable ? l(`Undo ${editLabel(changedParts(undoable.before, undoable.after), false)} (Ctrl/Cmd+Z)`, `撤销：${editLabel(changedParts(undoable.before, undoable.after), true)}（Ctrl/Cmd+Z）`) : l('Nothing to undo', '没有可撤销的修改')}>
            <Undo2 className="h-4 w-4" />{l('Undo', '撤销')}
          </button>
        </span>
        <button className={button} aria-label={l('Close', '关闭')} onClick={() => close()} disabled={busy || relationBusy}><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-16 pt-5 sm:px-8">
        {!task ? <p>{l('Task not found. Close this view to continue.', '任务不存在，返回即可继续。')}</p> : <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{[area?.name, project?.title].filter(Boolean).join(' / ') || l('Unassigned', '未分类')}</p>
            <h1 className="text-2xl font-semibold leading-tight">
              <InlineText ref={title} kind="title" singleLine value={task.title} ariaLabel={l('Task name', '任务名称')} placeholder={l('Untitled', '无标题')} disabled={!!task.deletedAt}
                className="text-2xl font-semibold leading-tight" onCommit={(next, base, force) => commitTaskText(task.id, 'title', base, next, force)} />
            </h1>
            {!closed && <div className="flex flex-wrap gap-2">
              <button className={`${button} bg-primary text-primary-foreground`} disabled={busy || !!reason} onClick={() => setCurrentWork(task.id)}>{l('Start / continue', '开始／继续')}</button>
              <button className={button} disabled={busy} onClick={() => run(async () => {
                if (!(await completeTaskWithUndo(task.id, t))) throw new Error(l('Completion failed.', '完成操作未保存。'));
                setCurrentWork(null);
              }, undefined, false)}>{recurringChecklist ? l('Complete current round', '完成本轮') : task.recurrence ? l('Complete this occurrence', '完成本次') : l('Complete task', '完成任务')}</button>
            </div>}
          </div>
          <TaskProperties task={task} reason={reason} closed={closed} blockId={blockId} run={run} busy={busy} onOpenTask={onOpenTask} onBusyChange={setRelationBusy} />
          <NoteBlock taskId={task.id} value={task.description ?? ''} disabled={!!task.deletedAt} startEditing={focus === 'description'} />
          <ChecklistProgress task={task} editable closed={busy || closed || relationBusy} allowPromote onBusyChange={setRelationBusy}
            focusStepId={focus?.startsWith('step:') ? focus.slice(5) : undefined} />
          {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p>}
        </div>}
      </div>
    </div>
  </div></SaveTrackerContext.Provider></ModalPortal>;
}

/** The note reads as rendered Markdown; clicking it (not a link) edits the same spot in place. */
function NoteBlock({ taskId, value, disabled, startEditing }: { taskId: string; value: string; disabled: boolean; startEditing: boolean }) {
  const { language } = useLanguage(), zh = language.startsWith('zh'), l = (a: string, b: string) => zh ? b : a;
  const [editing, setEditing] = useState(startEditing), [holding, setHolding] = useState(false), editor = useRef<InlineTextHandle>(null);
  useEffect(() => { if (editing) editor.current?.focus(); }, [editing]);
  // Leaving the note re-renders it as Markdown, which changes its height. Wait until the pointer
  // action that moved focus is over, so the button being clicked does not move under the pointer.
  const leave = () => {
    setHolding(true); setEditing(false);
    const release = () => { window.removeEventListener('pointerup', release, true); window.clearTimeout(timer); requestAnimationFrame(() => setHolding(false)); };
    const timer = window.setTimeout(release, 600);
    window.addEventListener('pointerup', release, true);
  };
  return <section aria-label={l('Note', '正文')} className="min-w-0">
    {editing || holding || !value
      ? <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) leave(); }}>
        <InlineText ref={editor} value={value} disabled={disabled} ariaLabel={l('Note', '正文')} placeholder={l('Add a note… (Markdown, links and indented lists work)', '添加正文…（支持 Markdown、链接和缩进列表）')}
          className="min-h-[1.75rem] text-sm leading-7" onCommit={(next, base, force) => commitTaskText(taskId, 'description', base, next, force)} />
      </div>
      : <div className="cursor-text rounded-md hover:bg-muted/40" title={l('Click to edit', '点击编辑')} data-description-view onClick={e => {
        if (!disabled && !(e.target as HTMLElement).closest('a, button, input, summary, label')) setEditing(true);
      }}><RichMarkdown markdown={value} /></div>}
  </section>;
}
