import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowLeft } from 'lucide-react';
import { flushPendingSave, changeWork, commitToDay, contentDraftPatch, createNextRecurringTask, createPlanningPolicy, estimateMinutes, isCommittedOn, localPlanDate, localPlanInput, planDatePart, planTimePart, planDateValue, plannerTimeZone, scheduleWork, skipRecurringWork, taskPlanner, useTaskStore, type Task, type WorkBlock } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { checkReservation, editTask, setCurrentWork, TASK_OPEN_EVENT } from '../../lib/lifecycle-actions';
import { completeTaskWithUndo } from '../../lib/complete-task-with-undo';
import { useUiStore } from '../../store/ui-store';
import { ModalPortal } from '../ModalPortal';
import { CaptureContentFields } from '../Task/CaptureContentFields';
import { RichMarkdown } from '../RichMarkdown';
import { RepeatPicker } from './RepeatPicker';
import { useDialogHistory } from './useDialogHistory';
import { usePlannerEnvironment } from './usePlannerEnvironment';
export function TaskDetailHost() {
  const [selection, setSelection] = useState<{
    taskId: string;
    blockId?: string;
  } | null>(null);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.taskId) setSelection(current => current ?? detail);
    };
    window.addEventListener(TASK_OPEN_EVENT, receive);
    const taskId = new URLSearchParams(location.search).get('task');
    if (taskId) setSelection({
      taskId
    });
    return () => window.removeEventListener(TASK_OPEN_EVENT, receive);
  }, []);
  return selection ? <TaskDetail key={selection.taskId} {...selection} onClose={() => setSelection(null)} /> : null;
}
function TaskDetail({
  taskId,
  blockId,
  onClose
}: {
  taskId: string;
  blockId?: string;
  onClose: () => void;
}) {
  const task = useTaskStore(s => s._allTasks.find(t => t.id === taskId));
  const projects = useTaskStore(s => s.projects),
    areas = useTaskStore(s => s.areas),
    tasks = useTaskStore(s => s.tasks);
  const {
    now,
    events,
    loaded,
    calendarError,
    showDate
  } = usePlannerEnvironment();
  const {
      language,
      t
    } = useLanguage(),
    zh = language.startsWith('zh');
  const l = (a: string, b: string) => zh ? b : a;
  const draftKey = `attention-planner:task-draft:v1:${taskId}`;
  const [restored] = useState<{
    base: Task;
    draft: Partial<Task>;
  } | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey) || 'null');
      return value?.base?.id === taskId && typeof value?.draft?.title === 'string' ? value : null;
    } catch {
      return null;
    }
  });
  const [base, setBase] = useState<Task | null>(restored?.base ?? null),
    [draft, setDraft] = useState<Partial<Task>>(restored?.draft ?? {});
  const [exit, setExit] = useState(false),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [day, setDay] = useState(() => localPlanDate(now));
  const [reservation, setReservation] = useState<{
    id: string;
    start: string;
    duration: number;
  } | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  useEffect(() => {
    if (reservation?.start) showDate(reservation.start.slice(0, 10));
  }, [reservation?.start, showDate]);
  const panel = useRef<HTMLDivElement>(null),
    lock = useRef(false);
  const editing = !!base,
    dirty = editing && JSON.stringify(draft) !== JSON.stringify(base);
  const close = useDialogHistory(true, force => {
    if (lock.current) return false;
    if (dirty && !force) {
      setExit(true);
      return false;
    }
    localStorage.removeItem(draftKey);
    onClose();
    return true;
  }, taskId);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (blockId) document.getElementById(`work-${blockId}`)?.scrollIntoView({
      block: 'nearest'
    });
  }, [blockId]);
  useEffect(() => {
    if (!base) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        base,
        draft
      }));
    } catch {
      setError(l('This browser cannot back up the edit draft. Keep this page open.', '浏览器无法备份编辑草稿，请不要关闭页面。'));
    }
  }, [base, draft, draftKey]);
  const changeDate = (key: 'availableAt' | 'dueDate', day: string, time: string) => {
    try {
      setDraft(old => ({
        ...old,
        [key]: planDateValue(day, time)
      }));
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const run = async (action: () => Promise<unknown>, success?: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      if (success) useUiStore.getState().showToast(success, 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const save = async (andClose = false) => {
    if (!base) return;
    await run(async () => {
      await editTask(taskId, latest => contentDraftPatch(base, draft, latest));
      localStorage.removeItem(draftKey);
      setBase(null);
      setExit(false);
      if (andClose) {
        lock.current = false;
        close(true);
      }
    });
  };
  const set = <K extends keyof Task,>(key: K, value: Task[K]) => setDraft(old => ({
    ...old,
    [key]: value
  }));
  const policy = useMemo(() => createPlanningPolicy(tasks, projects, now), [tasks, projects, now]);
  const reason = task ? policy.executionBlock(task) : 'lifecycle';
  const closed = !task || ['done', 'archived', 'reference'].includes(task.status) || !!task.deletedAt;
  const blockReason = {
    workflow: task?.status === 'inbox' ? l('Captured · not yet activated', '已记下 · 尚未加入待办') : task?.status === 'waiting' ? l('Waiting for a condition', '正在等待条件') : l('Paused by choice', '主动暂不做'),
    project: l('The project is paused', '所属项目暂停'),
    sequential: l('Finish the preceding task first', '先完成前面的任务'),
    unavailable: l('Not available yet', '尚未到可执行时间'),
    lifecycle: l('This task is closed', '任务已结束')
  }[reason ?? 'lifecycle'];
  const project = projects.find(p => p.id === task?.projectId),
    area = areas.find(a => a.id === (project?.areaId || task?.areaId));
  const blocks = task ? taskPlanner(task).blocks : [];
  const next = useMemo(() => task?.recurrence ? createNextRecurringTask(task, now.toISOString(), 'next') : null, [task, now]);
  const nextDate = next?.availableAt || next?.scheduledAt || next?.startTime || next?.dueDate;
  const input = 'mt-1 min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
  const button = 'min-h-11 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40';
  const beginReservation = (block?: WorkBlock) => {
    const start = new Date(now);
    start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
    setReservation({
      id: block?.id || crypto.randomUUID(),
      start: localPlanInput(block ? new Date(block.startAt) : start),
      duration: block?.durationMinutes || 30
    });
  };
  const reserve = () => run(async () => {
    if (!reservation || !task) return;
    if (!loaded || calendarError) throw new Error(l('Wait for calendar constraints to load before reserving a time.', '日历约束尚未读取成功，请先刷新日历。'));
    const parsed = new Date(reservation.start);
    if (!Number.isFinite(parsed.getTime()) || localPlanInput(parsed) !== reservation.start) throw new Error(l('Choose a valid local time.', '请选择有效的本地时间。'));
    checkReservation(taskId, reservation.id, parsed.toISOString(), reservation.duration, events, loaded && !calendarError);
    await editTask(taskId, (latest, clock) => {
      checkReservation(taskId, reservation.id, parsed.toISOString(), reservation.duration, events, loaded && !calendarError);
      if (latest.projectId && !useTaskStore.getState().projects.some(p => p.id === latest.projectId && p.status === 'active')) throw new Error(l('Activate the project before reserving new work.', '先启用所属项目，再新增安排。'));
      return {
        ...scheduleWork(latest, {
          id: reservation.id,
          startAt: parsed.toISOString(),
          durationMinutes: reservation.duration,
          timeZone: plannerTimeZone()
        }, clock),
        status: 'next'
      };
    });
    setReservation(null);
  }, l('Time reserved.', '时段已预留。'));
  const toggleStep = (id: string) => run(async () => {
    let prior = false;
    await editTask(taskId, latest => {
      prior = latest.checklist?.find(s => s.id === id)?.isCompleted ?? false;
      return {
        checklist: latest.checklist?.map(s => s.id === id ? {
          ...s,
          isCompleted: !s.isCompleted
        } : s)
      };
    });
    useUiStore.getState().showToast(l('Step updated', '步骤已更新'), 'info', 8000, {
      label: l('Undo', '撤销'),
      onClick: () => void run(() => editTask(taskId, latest => ({
        checklist: latest.checklist?.map(s => s.id === id && s.isCompleted === !prior ? {
          ...s,
          isCompleted: prior
        } : s)
      })))
    });
  });
  return <ModalPortal><div className="fixed inset-0 z-[65] flex justify-end bg-black/45" onClick={e => {
      if (e.target === e.currentTarget) close();
    }}>
        <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={l('Task details', '任务详情')} data-testid="task-details" className="flex h-[100dvh] w-full max-w-2xl flex-col bg-card text-foreground shadow-2xl" onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (exit) setExit(false);else if (reservation) setReservation(null);else close();
        }
        if (e.key === 'Tab') {
          const f = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary') ?? []).filter(x => x.getClientRects().length);
          const first = f[0],
            last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}>
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2"><button className={button} onClick={() => close()} disabled={busy}><ArrowLeft className="mr-1 inline h-4 w-4" />{l('Back', '返回')}</button><span className="text-xs text-muted-foreground">{editing ? l('Editing · changes saved together', '编辑中 · 修改一起保存') : l('Task details', '任务详情')}</span><button className={button} aria-label={l('Close', '关闭')} onClick={() => close()} disabled={busy}><X className="h-4 w-4" /></button></header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 pb-12">
        {!task ? <p>{l('Task not found. Close this view to continue.', '任务不存在，返回即可继续。')}</p> : <>
            <p className="text-xs text-muted-foreground">{[area?.name, project?.title].filter(Boolean).join(' / ') || l('Unassigned', '未分类')}</p>
            {restored && editing && <p className="text-xs text-muted-foreground">{l('Restored your unfinished edit. Saving still checks for changes from other devices.', '已恢复未完成的编辑，保存时仍会检查其他设备的修改。')}</p>}
            {editing ? <form onSubmit={e => {
              e.preventDefault();
              void save();
            }} className="space-y-4">
                <label className="block text-sm">{l('Task name', '任务名称')}<input className={input} value={draft.title ?? ''} onChange={e => set('title', e.target.value)} /></label>
                <CaptureContentFields t={t} description={draft.description ?? ''} checklist={draft.checklist} onChange={patch => setDraft(d => ({
                ...d,
                ...patch
              }))} />
                <details><summary className="min-h-11 cursor-pointer text-sm">{l('Dates, effort and belonging', '时间条件、总工作量与归属')}</summary>
                <label className="block text-sm">{l('Available from (earliest day)', '最早哪天可以做')}<input type="date" className={input} value={planDatePart(draft.availableAt)} onChange={e => changeDate('availableAt', e.target.value, planTimePart(draft.availableAt))} /></label><label className="block text-sm">{l('Available time (optional)', '最早可执行时间（可选）')}<input type="time" className={input} disabled={!draft.availableAt} value={planTimePart(draft.availableAt)} onChange={e => changeDate('availableAt', planDatePart(draft.availableAt), e.target.value)} /></label>
                <label className="block text-sm">{l('Must finish by', '最晚哪天必须完成')}<input type="date" className={input} value={planDatePart(draft.dueDate)} onChange={e => changeDate('dueDate', e.target.value, planTimePart(draft.dueDate))} /></label><label className="block text-sm">{l('Deadline time (optional)', '截止时刻（可选）')}<input type="time" className={input} disabled={!draft.dueDate} value={planTimePart(draft.dueDate)} onChange={e => changeDate('dueDate', planDatePart(draft.dueDate), e.target.value)} /></label>
                <label className="block text-sm">{l('Total estimated minutes (not this reservation)', '总预计分钟数（不是本次时长）')}<input type="number" min={1} className={input} value={estimateMinutes(draft.timeEstimate) ?? ''} onChange={e => set('timeEstimate', e.target.value ? `custom:${e.target.valueAsNumber}` : undefined)} /></label>
                <label className="block text-sm">{l('Belongs to', '归属')}<select className={input} value={draft.projectId ? `p:${draft.projectId}` : draft.areaId ? `a:${draft.areaId}` : ''} onChange={e => {
                    const [kind, id] = e.target.value.split(':');
                    setDraft(d => ({
                      ...d,
                      projectId: kind === 'p' ? id : undefined,
                      areaId: kind === 'a' ? id : undefined
                    }));
                  }}><option value="">{l('Unassigned', '暂不分类')}</option>{areas.map(a => <optgroup key={a.id} label={a.name}><option value={`a:${a.id}`}>{a.name}</option>{projects.filter(p => p.areaId === a.id).map(p => <option key={p.id} value={`p:${p.id}`}>{p.title}</option>)}</optgroup>)}{projects.filter(p => !p.areaId).map(p => <option key={p.id} value={`p:${p.id}`}>{p.title}</option>)}</select></label>
                </details>
                <details><summary className="min-h-11 cursor-pointer text-sm">{l('Repeat rule · this and following occurrences', '重复规则 · 本次及以后')}</summary><RepeatPicker value={draft.recurrence} onChange={v => set('recurrence', v)} /></details>
                <div className="flex gap-2"><button type="submit" disabled={busy} className={`${button} bg-primary text-primary-foreground`}>{l('Save changes', '保存全部修改')}</button><button type="button" className={button} onClick={() => {
                  setBase(null);
                  setExit(false);
                }}>{l('Discard edits', '放弃本次编辑')}</button></div>
            </form> : <>
                <h1 className="break-words text-2xl font-semibold">{task.title}</h1>
                <div className="flex flex-wrap gap-2 text-xs">{task.availableAt && <span>{l('Available', '可执行起始')} {task.availableAt}</span>}{task.dueDate && <span className={Date.parse(task.dueDate.length === 10 ? `${task.dueDate}T23:59:59` : task.dueDate) < now.getTime() ? 'text-destructive' : ''}>{l('Due', '截止')} {task.dueDate}</span>}{task.timeEstimate && <span>{l('Total estimate', '总预计')} {estimateMinutes(task.timeEstimate)} min</span>}</div>
                {reason && <p className="rounded-lg border border-border bg-muted p-3 text-sm">{blockReason}{!closed && l(' · Still visible for planning.', ' · 仍可查看和提前规划。')}</p>}
                <div className="flex flex-wrap gap-2"><button className={button} onClick={() => {
                  setBase(structuredClone(task));
                  setDraft(structuredClone(task));
                }}>{l('Edit content', '编辑内容')}</button>
                {task.status === 'inbox' && <button className={button} disabled={busy} onClick={() => run(() => editTask(task.id, () => ({ status: 'next' })), l('Ready to plan. No date is required.', '已加入待办，不必现在指定日期。'))}>{l('Ready to plan', '加入待办')}</button>}
                {!closed && <><button className={button} disabled={busy || !!reason} onClick={() => setCurrentWork(task.id)}>{l('Start / continue', '开始／继续')}</button><button className={button} disabled={busy} onClick={() => run(async () => {
                    if (!(await completeTaskWithUndo(task.id, t))) throw new Error(l('Completion failed.', '完成操作未保存。'));
                    setCurrentWork(null);
                  })}>{task.recurrence ? l('Complete this occurrence', '完成本次') : l('Complete task', '完成任务')}</button></>}
                {task.status === 'done' && <button className={button} disabled={busy} onClick={() => run(() => editTask(task.id, () => ({
                  status: 'next'
                })), l('Task reopened. Past reservations remain closed.', '任务已重新打开，历史时段不会自动重启。'))}>{l('Reopen task', '重新打开任务')}</button>}
                </div>
                {task.description && <RichMarkdown markdown={task.description} />}
                {!!task.checklist?.length && <section aria-label={l('Steps', '步骤')} className="space-y-2">{task.checklist.map(step => <label key={step.id} className="flex min-h-11 items-start gap-3 rounded border border-border p-3"><input type="checkbox" className="mt-1" checked={step.isCompleted} disabled={busy || closed} onChange={() => toggleStep(step.id)} /><span className={step.isCompleted ? 'text-muted-foreground line-through' : ''}>{step.title}</span>{!step.isCompleted && !closed && <button type="button" className="ml-auto min-h-11 shrink-0 px-2 text-xs underline" disabled={busy} aria-label={`${l('Move step to Inbox', '提升为独立任务')}: ${step.title}`} onClick={e => {
                    e.preventDefault();
                    void run(async () => {
                      const result = await useTaskStore.getState().promoteChecklistItem(task.id, step.id);
                      if (!result.success) throw new Error(result.error);
                      await flushPendingSave();
                    }, l('Moved to Inbox as an independent task.', '已移到收件箱，作为独立任务。'));
                  }}>{l('Make task', '独立成任务')}</button>}</label>)}</section>}
                {!closed && <section className="space-y-3 border-t border-border pt-4"><h2 className="font-semibold">{l('Plan this task', '安排这件事')}</h2>
                    <div className="flex flex-wrap items-end gap-2"><label className="text-sm">{l('Choose a day', '哪天想做')}<input type="date" className={input} value={day} onChange={e => setDay(e.target.value)} /></label><button className={button} disabled={busy} onClick={() => run(() => editTask(task.id, (latest, clock) => ({
                    ...commitToDay(latest, day, !isCommittedOn(latest, day), clock),
                    ...(latest.status === 'inbox' ? {
                      status: 'next' as const
                    } : {})
                  })), l('Day plan updated.', '当天计划已更新。'))}>{isCommittedOn(task, day) ? l('Remove day commitment', '取消当天意向') : l('Add to this day', '加入这一天')}</button><button className={button} onClick={() => beginReservation()}>{l('Reserve a work block', '预留一个时段')}</button></div>
                    <p className="text-xs text-muted-foreground">{l('Choosing a day does not occupy a time slot or set a deadline.', '哪天想做不等于占用时段，也不会设置截止日期。')}</p>
                </section>}
                {reservation && <section className="space-y-3 rounded-lg border border-primary/40 bg-muted/30 p-3" aria-label={l('Reserve a work block', '预留一个时段')}>
                    <label className="block text-sm">{l('Start time', '开始时间')}<input type="datetime-local" className={input} value={reservation.start} onChange={e => setReservation({
                    ...reservation,
                    start: e.target.value
                  })} /></label>
                    <label className="block text-sm">{l('Minutes for this block', '本次安排几分钟')}<input type="number" className={input} min={1} max={1440} value={reservation.duration} onChange={e => setReservation({
                    ...reservation,
                    duration: e.target.valueAsNumber
                  })} /></label>
                    <p className="text-xs text-muted-foreground">{l('Nearby meetings', '相邻会议')}：{events.filter(e => localPlanDate(new Date(e.start)) === reservation.start.slice(0, 10)).map(e => `${new Date(e.start).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })} ${e.title}`).join(' · ') || l('None in the loaded calendar', '已读取的日历中没有')}</p>
                    <p role="status" className="text-xs text-muted-foreground">{loaded && !calendarError ? l('Calendar constraints loaded', '已读取日历约束') : l('Calendar unavailable; reservation is not saved.', '日历尚未就绪，不能保存时段。')}</p><button className={button} disabled={busy || !loaded || !!calendarError} onClick={reserve}>{task.status === 'next' ? l('Save reservation', '保存时段') : l('Activate and reserve', '启用并预留')}</button><button className={`${button} ml-2`} onClick={() => setReservation(null)}>{l('Cancel reservation edit', '取消时段编辑')}</button>
                </section>}
                <section className="space-y-3"><h2 className="font-semibold">{l('Work blocks and history', '工作时段与历史')}</h2>{!blocks.length && <p className="text-sm text-muted-foreground">{l('No time reserved. This task is not taking up calendar space.', '尚未预留时间，不占用日历空档。')}</p>}
                    {blocks.map(b => <article key={b.id} id={`work-${b.id}`} className="space-y-2 rounded-lg border border-border p-3" data-block-id={b.id}>
                        <p className="text-sm font-medium">{new Date(b.startAt).toLocaleString()} · {b.durationMinutes} min · {{
                      scheduled: l('Reserved', '已安排'),
                      pending: l('Needs rescheduling', '待续排'),
                      done: l('Block complete', '本段已完成'),
                      cancelled: l('Closed reservation', '时段已取消')
                    }[b.state]}</p>
                        <p className="text-xs text-muted-foreground">{l('Confirmed progress', '已确认进度')} {b.completedMinutes}/{b.allocatedMinutes} min{b.reason ? ` · ${b.reason}` : ''}</p>
                        {b.origin === 'rollover' && <p className="text-xs">{l('Automatically moved; your deadline is unchanged.', '已自动顺延，原截止日期没有改变。')}</p>}
                        {!closed && ['scheduled', 'pending'].includes(b.state) && <><div className="flex flex-wrap gap-2"><button className={button} onClick={() => beginReservation(b)}>{l('Move / resize', '改期／改时长')}</button><button className={button} disabled={busy} onClick={() => run(() => editTask(task.id, (latest, c) => changeWork(latest, b.id, 'complete', c)), l('This block is complete. The task remains open.', '本段已完成，任务仍保留。'))}>{l('Complete this block', '完成本段')}</button><button className={button} disabled={busy} onClick={() => run(() => editTask(task.id, (latest, c) => changeWork(latest, b.id, 'cancel', c)), l('Reservation cancelled; task kept.', '已取消时段，任务保留。'))}>{l('Cancel this block', '取消本段')}</button></div>
                        <div className="flex flex-wrap items-end gap-2"><label className="text-xs">{l('Total minutes actually done in this block', '本段累计实际做了几分钟')}<input type="number" min={0} max={b.allocatedMinutes} className={input} value={progress[b.id] ?? b.completedMinutes} onChange={e => setProgress(p => ({
                          ...p,
                          [b.id]: e.target.valueAsNumber
                        }))} /></label><button className={button} disabled={busy} onClick={() => run(() => editTask(task.id, (latest, c) => changeWork(latest, b.id, 'progress', c, progress[b.id] ?? b.completedMinutes)), l('Progress saved. Only the remaining allocation will move.', '进度已保存，只续排剩余工作量。'))}>{l('Pause and reschedule remainder', '暂停，续排剩余')}</button></div></>}
                        {b.origin === 'rollover' && !closed && <button className={button} disabled={busy} onClick={() => run(() => editTask(task.id, (latest, c) => changeWork(latest, b.id, 'undo-rollover', c)))}>{l('Undo automatic move', '撤销自动顺延')}</button>}
                        {!!b.history.length && <details><summary className="min-h-11 cursor-pointer text-xs">{l('Previous reservations', '原安排记录')}</summary>{b.history.map((h, i) => <p key={i} className="text-xs text-muted-foreground">{new Date(h.startAt).toLocaleString()} · {h.durationMinutes} min · {h.reason}</p>)}</details>}
                    </article>)}
                </section>
                {!closed && <details><summary className="min-h-11 cursor-pointer text-sm">{l('Waiting, pause, or end recurrence', '等待条件、暂不做或结束重复')}</summary><div className="flex flex-wrap gap-2">{(['next', 'waiting', 'someday'] as const).map((status, i) => <button key={status} className={button} disabled={busy} onClick={() => run(() => editTask(task.id, () => ({
                    status
                  })), [l('Ready to plan', '已放入待办'), l('Waiting for a response', '已标记等待回复'), l('Paused; existing plans remain visible', '已暂停，原计划仍可查看')][i])}>{[l('Ready', '准备做'), l('Wait for reply', '等回复'), l('Not doing now', '暂不做')][i]}</button>)}</div>
                {task.recurrence && <div className="mt-3 space-y-2"><p className="text-xs">{l('Next occurrence preview', '下一次预览')}：{nextDate ?? l('No further occurrence', '没有后续')} · {l('Only created after completion or skip.', '完成或跳过本次后才生成。')}</p><button className={button} disabled={busy} onClick={() => run(() => editTask(task.id, skipRecurringWork), l('Occurrence skipped, not marked completed.', '已跳过本次，没有伪造完成记录。'))}>{l('Skip this occurrence', '跳过本次')}</button><button className={`${button} ml-2`} disabled={busy} onClick={() => run(() => editTask(task.id, () => ({
                    recurrence: undefined
                  })), l('Repeating stopped; this task is kept.', '已停止后续重复，当前任务保留。'))}>{l('Stop repeating', '停止后续重复')}</button></div>}</details>}
            </>}
        </>}
        {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p>}
        </div>
        {exit && <section role="alertdialog" aria-label={l('Unsaved changes', '有未保存的修改')} className="shrink-0 space-y-2 border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><p>{l('Save all edits before leaving?', '离开前保存全部修改吗？')}</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => save(true)}>{l('Save and return', '保存并返回')}</button><button className={button} disabled={busy} onClick={() => close(true)}>{l('Discard and return', '放弃并返回')}</button><button className={button} onClick={() => setExit(false)}>{l('Keep editing', '继续编辑')}</button></div></section>}
        </div></div></ModalPortal>;
}
