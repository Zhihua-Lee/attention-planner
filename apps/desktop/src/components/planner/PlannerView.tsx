import { useEffect, useMemo, useRef, useState } from 'react';
import { TaskHierarchyDrag, TaskTreeList } from './TaskTreeList';
import { isInputComposition } from '../../lib/input-method';
import { Plus } from 'lucide-react';
import { activeWorkBlocks, resolveAreaFilter, taskMatchesAreaFilter, createPlanningPolicy, flushPendingSave, isCommittedOn, localPlanDate, validPlanDay, commitToDay, selectNow, taskPlanner, useTaskStore, type Task } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { editTask, openTaskDetails, setCurrentWork, downloadPlannerBackup } from '../../lib/lifecycle-actions';
import { completeTaskWithUndo } from '../../lib/complete-task-with-undo';
import { useUiStore } from '../../store/ui-store';
import { RichMarkdown } from '../RichMarkdown';
import { QUICK_CAPTURE_EVENT } from '../capture/PwaCaptureHost';
import { usePlannerEnvironment } from './usePlannerEnvironment';
import { PlanningPreferences } from './PlanningPreferences';
import { CalendarEventDetails } from './CalendarEventDetails';
import { PlannerCalendar } from './PlannerCalendar';
import type { ExternalCalendarEvent } from '@mindwtr/core';
const button = 'min-h-11 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40';
export function PlannerView({
  mode
}: {
  mode: 'now' | 'inbox' | 'day' | 'calendar' | 'history';
}) {
  const {
      language,
      t
    } = useLanguage(),
    zh = language.startsWith('zh'),
    l = (a: string, b: string) => zh ? b : a;
  const isFocusMode = useUiStore(s => s.isFocusMode);
  const [selectedEvent, setSelectedEvent] = useState<ExternalCalendarEvent | null>(null);
  const tasks = useTaskStore(s => s.tasks),
    projects = useTaskStore(s => s.projects),
    gtd = useTaskStore(s => s.settings.gtd);
  const {
    now,
    events,
    loaded,
    calendarError,
    currentId,
    refresh,
    showDate
  } = usePlannerEnvironment();
  const [day, setDay] = useState(() => {
      const saved = new URLSearchParams(location.search).get('planDate');
      return saved && validPlanDay(saved) ? saved : localPlanDate(now);
    }),
    [span, setSpan] = useState<1 | 7>(() => window.innerWidth < 640 ? 1 : 7);
  useEffect(() => {
    if (mode === 'calendar' || mode === 'day') {
      const url = new URL(location.href);
      url.searchParams.set('planDate', day);
      history.replaceState(history.state, '', url);
    }
  }, [day, mode]);
  const [quick, setQuick] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [excluded, setExcluded] = useState<Set<string>>(new Set());
  const saveLock = useRef(false),
    quickId = useRef<string | null>(null);
  useEffect(() => {
    if (mode === 'calendar' || mode === 'day') showDate(day);
  }, [day, mode, showDate]);
  const areas = useTaskStore(s => s.areas),
    areaFilter = useTaskStore(s => s.settings.filters?.areaId);
  const visibleInArea = (task: Task) => taskMatchesAreaFilter(task, resolveAreaFilter(areaFilter, areas), new Map(projects.map(p => [p.id, p])), new Map(areas.map(a => [a.id, a])));
  const policy = useMemo(() => createPlanningPolicy(tasks, projects, now), [tasks, projects, now]);
  const active = tasks.filter(policy.isVisible).filter(visibleInArea),
    inbox = active.filter(t => t.status === 'inbox');
  const committed = active.filter(t => isCommittedOn(t, day));
  const pending = active.flatMap(task => taskPlanner(task).blocks.filter(b => b.state === 'pending').map(block => ({
    task,
    block
  })));
  const run = async (action: () => Promise<unknown>) => {
    try {
      setError('');
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const create = async () => {
    if (saveLock.current || !quick.trim()) return;
    saveLock.current = true;
    setSaving(true);
    try {
      const state = useTaskStore.getState();
      const result = quickId.current && state._allTasks.some(t => t.id === quickId.current) ? {
        success: true as const,
        id: quickId.current
      } : await state.addTask(quick, {
        status: 'inbox'
      });
      if (!result.success) throw new Error(result.error);
      quickId.current = result.id ?? null;
      await flushPendingSave();
      setQuick('');
      quickId.current = null;
    } catch (e) {
      setError(String(e));
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };
  const capture = (start?: Date) => window.dispatchEvent(new CustomEvent(QUICK_CAPTURE_EVENT, {
    detail: {
      initialValue: quick,
      initialProps: start ? {
        scheduledAt: start.toISOString(),
        status: 'next'
      } : undefined,
      expandContent: !!quick
    }
  }));
  const row = (task: Task) => <article key={task.id} data-task-id={task.id} className="rounded-lg border border-border bg-card p-3">
        <button className="min-h-11 w-full break-words pr-12 text-left text-sm font-medium hover:text-primary" onClick={() => openTaskDetails(task.id)}>{task.title}</button>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{task.availableAt && <span>{l('Available', '可做起始')} {task.availableAt}</span>}{task.dueDate && <span>{l('Due', '截止')} {task.dueDate}</span>}{policy.executionBlock(task) && task.status !== 'inbox' && <span>{l('Not executable yet; plan kept', '目前不可执行，计划保留')}</span>}</div>
        <div className="mt-2 flex flex-wrap gap-2">{task.status === 'inbox' && <button className={button} onClick={() => run(() => editTask(task.id, () => ({
        status: 'next'
      })))}>{l('Ready to plan', '已想清楚，加入待办')}</button>}
            {task.status !== 'done' && <button className={button} onClick={() => run(async () => {
        if (!(await completeTaskWithUndo(task.id, t))) throw new Error(l('Could not save completion.', '未能保存完成操作。'));
      })}>{l('Complete', '完成')}</button>}
            {task.status === 'done' && <button className={button} onClick={() => run(() => editTask(task.id, () => ({
        status: 'next'
      })))}>{l('Reopen', '重新打开')}</button>}
            <button className={button} onClick={() => openTaskDetails(task.id)}>{l('Details / arrange', '详情／安排')}</button>
            <details className="relative"><summary className={`${button} cursor-pointer`} role="button" aria-label={l('More options', '更多操作')}>{l('More', '更多')}</summary><div role="menu" aria-label={l('More options', '更多操作')} className="absolute right-0 z-30 min-w-36 rounded border border-border bg-card p-2 shadow-lg"><button role="menuitem" className={button} onClick={() => run(async () => {
            const result = await useTaskStore.getState().deleteTask(task.id);
            if (!result.success) throw new Error(result.error);
            await flushPendingSave();
            useUiStore.getState().showToast(l('Moved to Trash', '已移到回收站'), 'info');
          })}>{l('Delete', '删除')}</button></div></details>
        </div></article>;
  const projection = tasks.filter(visibleInArea).map(task => ({
    ...task,
    areaId: task.areaId || projects.find(p => p.id === task.projectId)?.areaId,
    isFocusedToday: isCommittedOn(task, localPlanDate(now))
  }));
  const recommended = selectNow({
    tasks: projection,
    projects,
    now,
    events,
    frames: gtd?.attentionFrames,
    excludedTaskIds: excluded
  });
  const current = tasks.find(t => visibleInArea(t) && t.id === currentId && !excluded.has(t.id) && !policy.executionBlock(t) && (!t.snoozedUntil || Date.parse(t.snoozedUntil) <= now.getTime()));
  const selection = recommended?.kind === 'event' ? recommended : current ? {
    kind: 'task' as const,
    task: current,
    reason: 'current'
  } : recommended;
  const nextConstraint = events.filter(e => Date.parse(e.start) > now.getTime()).sort((a, b) => a.start.localeCompare(b.start))[0];
  const reasonLabels: Record<string, string> = {
    current: l('Continue your chosen task', '继续你已选择的任务'),
    scheduled: l('Your reserved time', '已预留的工作时段'),
    focused: l('Chosen for today', '今天想做的任务'),
    frame: l('Fits your current preference', '符合当前时段偏好'),
    'next-action': l('An available next action', '当前可执行的一件事')
  };
  const calendar = <PlannerCalendar day={day} setDay={setDay} span={mode === 'calendar' ? span : 1} setSpan={setSpan} showViewSwitch={mode === 'calendar'} now={now} tasks={active} events={events} calendarTrusted={loaded && !calendarError} isBlocked={task => Boolean(policy.executionBlock(task))} capture={capture} openEvent={setSelectedEvent} run={run} />;
  return <TaskHierarchyDrag><div className="space-y-5" data-testid={`planner-${mode}`}>
        <header className="flex items-center justify-between gap-2"><h1 className="text-2xl font-semibold">{{
          now: 'NOW',
          inbox: l('Inbox', '收件箱'),
          day: l('Your day', '这一天'),
          calendar: l('Calendar', '日历'),
          history: l('Completed', '已完成')
        }[mode]}</h1>{mode !== 'now' && isFocusMode && <button className={button} onClick={() => capture()}><Plus className="mr-1 inline h-4 w-4" />{l('Add task', '添加任务')}</button>}</header>
        {error && <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">{error}</p>}
        {(mode === 'calendar' || mode === 'day' || mode === 'now') && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{!loaded ? l('Loading calendars…', '正在读取日历…') : calendarError ? l('Calendar unavailable; automatic moves are paused.', '日历读取失败，已暂停自动移动。') : l('Calendar constraints loaded', '已读取日历约束')}</span><button className="min-h-11 px-2 underline" onClick={refresh}>{l('Refresh', '刷新')}</button>{calendarError && <details><summary>{l('Details', '详情')}</summary>{calendarError}</details>}</div>}
        {mode === 'inbox' && <><p className="text-sm text-muted-foreground">{l('Write it down first. Organize or schedule only when you need to.', '先写下来。需要的时候再整理或安排，不必先决定分类。')}</p><form className="flex gap-2" onSubmit={e => {
        e.preventDefault();
        void create();
      }}><input className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-card px-3" aria-label={l('Add task', '添加任务')} placeholder={l('Add task…', '记一件事…')} value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => {
          if (isInputComposition(e.nativeEvent) && e.key === 'Enter') e.preventDefault();
        }} /><button className={button} disabled={saving || !quick.trim()}>{l('Save', '保存')}</button><button className={button} type="button" onClick={() => capture()}>{l('Content and steps', '补充内容与安排')}</button></form><TaskTreeList tasks={inbox} render={row} listId="inbox" />{!inbox.length && <p className="text-sm text-muted-foreground">{l('Nothing waiting to be clarified.', '没有待整理事项。')}</p>}</>}
        {mode === 'now' && <><section className="space-y-4 rounded-xl border border-border bg-card p-5" data-testid="now-card" aria-label={l('Current action', '当前行动')}>
            {selection?.kind === 'event' ? <><p className="text-xs text-muted-foreground">{l('Current meeting', '当前会议')}</p><h2 className="text-xl font-semibold">{selection.event.title}</h2><p>{new Date(selection.event.start).toLocaleTimeString()} – {new Date(selection.event.end).toLocaleTimeString()}</p></> : selection?.kind === 'task' ? <>
                <p className="text-xs text-muted-foreground">{reasonLabels[selection.reason]}</p><button className="min-h-11 text-left text-xl font-semibold hover:text-primary" onClick={() => openTaskDetails(selection.task.id)}>{selection.task.title}</button>
                {selection.task.description && <RichMarkdown markdown={selection.task.description} />}
                {!!selection.task.checklist?.length && <div className="space-y-2">{selection.task.checklist.map(step => <label key={step.id} className="flex min-h-11 items-center gap-3 rounded border border-border p-2"><input type="checkbox" checked={step.isCompleted} onChange={() => run(() => editTask(selection.task.id, latest => ({
                checklist: latest.checklist?.map(s => s.id === step.id ? {
                  ...s,
                  isCompleted: !s.isCompleted
                } : s)
              })))} /><span className={step.isCompleted ? 'line-through text-muted-foreground' : ''}>{step.title}</span></label>)}</div>}
                <div className="flex flex-wrap gap-2"><button className={`${button} bg-primary text-primary-foreground`} onClick={() => setCurrentWork(selection.task.id)}>{l('Start / continue', '开始／继续')}</button><button className={button} onClick={() => openTaskDetails(selection.task.id)}>{l('Progress / details', '进度／详情')}</button><button className={button} onClick={() => run(async () => {
              if (await completeTaskWithUndo(selection.task.id, t)) setCurrentWork(null);
            })}>{l('Complete task', '完成任务')}</button><button className={button} onClick={() => run(() => editTask(selection.task.id, () => ({
              snoozedUntil: new Date(now.getTime() + 30 * 60000).toISOString()
            })))}>{l('Hide suggestion for 30 min', '30分钟后再推荐')}</button><button className={button} onClick={() => {
              setExcluded(old => new Set([...old, selection.task.id]));
              setCurrentWork(null);
            }}>{l('Choose another', '换一件')}</button></div>
            </> : <><h2 className="text-lg font-semibold">{l('No action fits this moment.', '暂时没有适合此刻的任务。')}</h2><p className="text-sm text-muted-foreground">{active.length ? l(`${active.length} tasks are still in your plan. Check upcoming availability or waiting tasks.`, `${active.length} 件事仍在计划中，可以查看未来安排或等待条件。`) : l('Your active task list is empty.', '当前没有活动待办。')}</p><button className={button} onClick={() => {
            setExcluded(new Set());
            setCurrentWork(null);
          }}>{l('Reset suggestions', '重新查看建议')}</button></>}
            {nextConstraint && <p className="border-t border-border pt-3 text-sm">{l('Next fixed appointment', '下一项固定安排')}：{new Date(nextConstraint.start).toLocaleString()} · {nextConstraint.title}</p>}
        </section>{pending.length > 0 && <p className="text-sm">{l(`${pending.length} allocations need rescheduling. Open Calendar to see why.`, `${pending.length} 个工作时段待续排，可在日历查看原因。`)}</p>}</>}
        {(mode === 'calendar' || mode === 'day') && <>
            {active.some(t => taskPlanner(t).legacyFocus) && <details className="rounded-lg border border-border p-3"><summary className="min-h-11 cursor-pointer text-sm">{l('Old undated selections · choose their day', '旧版未注明日期的选择 · 指定哪天想做')}</summary>{active.filter(t => taskPlanner(t).legacyFocus).map(task => <div key={task.id} className="flex min-h-11 flex-wrap items-center gap-2 text-sm"><button className="underline" onClick={() => openTaskDetails(task.id)}>{task.title}</button><button className={button} onClick={() => run(() => editTask(task.id, (latest, c) => commitToDay(latest, day, true, c)))}>{l('Choose for this day', '选入这一天')}</button></div>)}</details>}
            {committed.length > 0 && <section className="space-y-2"><h2 className="text-sm font-semibold">{l('Chosen for this day · not necessarily timed', '这一天想做 · 不代表已占用时段')}</h2><TaskTreeList tasks={committed} render={row} listId="committed" /></section>}
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">{calendar}<aside className="space-y-3"><h2 className="font-semibold">{l('Tasks to arrange', '待安排任务')}</h2><p className="text-xs text-muted-foreground">{l('Future availability is shown, never hidden. Open a task to reserve multiple blocks.', '未来可用的任务仍可提前规划。打开详情可预留多个时段。')}</p><div className="max-h-[70dvh] space-y-2 overflow-y-auto"><TaskTreeList tasks={active.filter(policy.isCandidate).filter(t => !activeWorkBlocks(t).length && !isCommittedOn(t, day))} render={row} listId="unscheduled" /></div><details><summary className="min-h-11 cursor-pointer text-sm">{l('Waiting / paused tasks', '等待条件／暂不做')}</summary><div className="space-y-2"><TaskTreeList tasks={active.filter(t => t.status !== 'inbox' && !policy.isCandidate(t))} render={row} listId="waiting" /></div></details></aside></div>
            {pending.length > 0 && <section className="space-y-2"><h2 className="font-semibold">{l('Needs rescheduling', '待续排')}</h2>{pending.map(({
          task,
          block
        }) => <button key={block.id} className={`${button} mr-2 text-left`} onClick={() => openTaskDetails(task.id, block.id)}>{task.title} · {block.allocatedMinutes - block.completedMinutes} min · {({
            'configure-hours': l('Set allowed hours', '请设置允许时段'),
            'calendar-unavailable': l('Calendar unavailable', '日历不可用'),
            'no-space': l('No continuous gap in the next 7 days', '未来7天没有足够的连续空档'),
            'manual-hold': l('Automatic move undone', '已撤销自动移动'),
            workflow: l('Waiting or paused', '等待条件或暂不做'),
            project: l('Inactive project', '项目已暂停')
          } as Record<string, string>)[block.reason ?? ''] ?? block.reason}</button>)}</section>}
            <PlanningPreferences />
            <button className={button} onClick={downloadPlannerBackup}>{l('Export full backup', '导出完整备份')}</button>
        </>}
        {mode === 'history' && <div className="space-y-2"><TaskTreeList tasks={tasks.filter(t => t.status === 'done')} render={row} listId="history" /></div>}
        {selectedEvent && <CalendarEventDetails event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div></TaskHierarchyDrag>;
}
