import { useMemo, useState, type ReactNode } from 'react';
import { CalendarCheck, CalendarClock, CalendarDays, CircleDot, Clock3, FolderTree, Link2, Repeat2, Timer, X } from 'lucide-react';
import { changeWork, commitToDay, createNextRecurringTask, estimateMinutes, localPlanDate, localPlanInput, planDatePart, planDateValue, planTimePart, plannerTimeZone,
  scheduleWork, skipRecurringWork, taskPlanner, useTaskStore, type ExecutionBlock, type Task, type WorkBlock } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { checkReservation, editTask } from '../../lib/lifecycle-actions';
import { returnTaskToInbox } from '../../lib/return-task-to-inbox';
import { RepeatPicker } from './RepeatPicker';
import { TaskLinks } from './TaskLinks';
import { usePlannerEnvironment } from './usePlannerEnvironment';

const field = 'min-h-9 rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-border focus:border-border focus:outline-none';
const chip = 'inline-flex min-h-9 items-center gap-1 rounded-md bg-muted px-2 text-sm';
const small = 'min-h-9 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';

function Row({ icon, label, children, id }: { icon: ReactNode; label: string; children: ReactNode; id?: string }) {
  return <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]" data-property={id}>
    <span className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">{icon}{label}</span>
    <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-1">{children}</div>
  </div>;
}

/**
 * Notion-style properties: each value is edited where it is shown and saved immediately.
 * Empty properties fold behind one control so the page shows what the task actually has.
 */
export function TaskProperties({ task, reason, closed, blockId, run, busy, onOpenTask, onBusyChange }: {
  task: Task; reason: ExecutionBlock | null; closed: boolean; blockId?: string; busy: boolean;
  run: (action: () => Promise<unknown>, success?: string) => Promise<void>;
  onOpenTask: (id: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const { language } = useLanguage(), zh = language.startsWith('zh'), l = (a: string, b: string) => zh ? b : a;
  const projects = useTaskStore(s => s.projects), areas = useTaskStore(s => s.areas);
  const linkedHere = useTaskStore(s => s.tasks.some(t => t.parentTaskId === task.id));
  const { now, events, loaded, calendarError } = usePlannerEnvironment();
  const [showEmpty, setShowEmpty] = useState(false), [repeatOpen, setRepeatOpen] = useState(false), [openBlock, setOpenBlock] = useState<string | undefined>(blockId);
  const [reservation, setReservation] = useState<{ id: string; start: string; duration: number } | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({}), [estimate, setEstimate] = useState<string | null>(null);
  const planner = taskPlanner(task), blocks = planner.blocks;
  const activeBlocks = blocks.filter(b => b.state === 'scheduled' || b.state === 'pending'), pastBlocks = blocks.filter(b => b.state === 'done' || b.state === 'cancelled');
  const today = localPlanDate(now), days = planner.days.filter(d => d.selected).map(d => d.date).sort();
  const next = useMemo(() => task.recurrence ? createNextRecurringTask(task, now.toISOString(), 'next') : null, [task, now]);
  const nextDate = next?.availableAt || next?.scheduledAt || next?.startTime || next?.dueDate;
  const edit = (build: (latest: Task) => Partial<Task>, success?: string) => run(() => editTask(task.id, latest => build(latest)), success);
  const setDate = (key: 'availableAt' | 'dueDate', day: string, time: string) => edit(() => ({ [key]: day ? planDateValue(day, time) : undefined }));
  const beginReservation = (block?: WorkBlock) => {
    const start = new Date(now);
    start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
    setReservation({ id: block?.id || crypto.randomUUID(), start: localPlanInput(block ? new Date(block.startAt) : start), duration: block?.durationMinutes || 30 });
  };
  const reserve = () => run(async () => {
    if (!reservation) return;
    if (!loaded || calendarError) throw new Error(l('Wait for calendar constraints to load before reserving a time.', '日历约束尚未读取成功，请先刷新日历。'));
    const parsed = new Date(reservation.start);
    if (!Number.isFinite(parsed.getTime()) || localPlanInput(parsed) !== reservation.start) throw new Error(l('Choose a valid local time.', '请选择有效的本地时间。'));
    checkReservation(task.id, reservation.id, parsed.toISOString(), reservation.duration, events, loaded && !calendarError);
    await editTask(task.id, (latest, clock) => {
      checkReservation(task.id, reservation.id, parsed.toISOString(), reservation.duration, events, loaded && !calendarError);
      if (latest.projectId && !useTaskStore.getState().projects.some(p => p.id === latest.projectId && p.status === 'active')) throw new Error(l('Activate the project before reserving new work.', '先启用所属项目，再新增安排。'));
      return { ...scheduleWork(latest, { id: reservation.id, startAt: parsed.toISOString(), durationMinutes: reservation.duration, timeZone: plannerTimeZone() }, clock), status: 'next' };
    });
    setReservation(null);
  }, l('Time reserved.', '时段已预留。'));
  const blockLabel = (b: WorkBlock) => `${new Date(b.startAt).toLocaleString([], { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ${b.durationMinutes} min · ${({
    scheduled: l('Reserved', '已安排'), pending: l('Needs rescheduling', '待续排'), done: l('Block complete', '本段已完成'), cancelled: l('Closed reservation', '时段已取消'),
  } as Record<string, string>)[b.state]}`;
  const blockReason = reason && {
    workflow: task.status === 'inbox' ? l('Captured · not yet activated', '已记下 · 尚未加入待办') : task.status === 'waiting' ? l('Waiting for a condition', '正在等待条件') : l('Paused by choice', '主动暂不做'),
    project: l('The project is paused', '所属项目暂停'), sequential: l('Finish the preceding task first', '先完成前面的任务'),
    unavailable: l('Not available yet', '尚未到可执行时间'), lifecycle: l('This task is closed', '任务已结束'),
  }[reason];
  const statusLabel: Record<string, string> = { inbox: l('Inbox', '收集箱'), next: l('Ready', '待办'), waiting: l('Waiting', '等待中'), someday: l('Not now', '暂不做'),
    done: l('Done', '已完成'), archived: l('Archived', '已归档'), reference: l('Reference', '参考') };
  const dateRow = (key: 'availableAt' | 'dueDate') => {
    const value = task[key], overdue = key === 'dueDate' && value && Date.parse(value.length === 10 ? `${value}T23:59:59` : value) < now.getTime();
    const date = (autoFocus = false) => <input type="date" autoFocus={autoFocus} aria-label={key === 'availableAt' ? l('Available from', '最早哪天可以做') : l('Must finish by', '最晚哪天必须完成')} data-inline-edit="property" className={`${field} ${overdue ? 'text-destructive' : ''}`}
      ref={node => { if (autoFocus) try { node?.showPicker?.(); } catch { /* picker needs a user gesture */ } }}
      value={planDatePart(value)} onChange={e => setDate(key, e.target.value, planTimePart(value))} />;
    return <>
      {value ? date() : <Reveal label={l('+ Set date', '+ 设置日期')} className={small}>{() => date(true)}</Reveal>}
      {value && (() => {
        const time = (autoFocus = false) => <input type="time" autoFocus={autoFocus} aria-label={key === 'availableAt' ? l('Available time (optional)', '最早可执行时间（可选）') : l('Deadline time (optional)', '截止时刻（可选）')} data-inline-edit="property" className={field}
          value={planTimePart(value)} onChange={e => setDate(key, planDatePart(value), e.target.value)} />;
        return planTimePart(value) ? time() : <Reveal label={l('+ time', '+ 时间')} className={small}>{() => time(true)}</Reveal>;
      })()}
      {value && <button type="button" className={small} aria-label={l('Clear', '清除')} onClick={() => setDate(key, '', '')}><X className="h-3.5 w-3.5" /></button>}
    </>;
  };
  const rows: Array<{ id: string; empty: boolean; node: ReactNode }> = [
    { id: 'status', empty: false, node: <Row id="status" icon={<CircleDot className="h-4 w-4" />} label={l('Status', '状态')}>
      {closed ? <><span className={chip}>{statusLabel[task.status] ?? task.status}</span>
        {task.status === 'done' && !task.deletedAt && <button type="button" className={small} disabled={busy} onClick={() => edit(() => ({ status: 'next' }), l('Task reopened. Past reservations remain closed.', '任务已重新打开，历史时段不会自动重启。'))}>{l('Reopen task', '重新打开任务')}</button>}</>
        : <select aria-label={l('Status', '状态')} data-inline-edit="property" className={`${field} ${chip}`} value={task.status} disabled={busy} onChange={e => {
          const status = e.target.value as Task['status'];
          if (status === 'inbox') void run(() => returnTaskToInbox(task.id, zh));
          else void edit(() => ({ status }), status === 'next' ? l('Ready to plan. No date is required.', '已加入待办，不必现在指定日期。') : undefined);
        }}>{(['inbox', 'next', 'waiting', 'someday'] as const).map(status => <option key={status} value={status}>{statusLabel[status]}</option>)}</select>}
      {blockReason && reason !== 'workflow' && reason !== 'lifecycle' && <span className="text-xs text-muted-foreground">{blockReason}</span>}
    </Row> },
    { id: 'dueDate', empty: !task.dueDate, node: <Row id="dueDate" icon={<CalendarCheck className="h-4 w-4" />} label={l('Due', '截止')}>{dateRow('dueDate')}</Row> },
    { id: 'availableAt', empty: !task.availableAt, node: <Row id="availableAt" icon={<CalendarClock className="h-4 w-4" />} label={l('Available from', '可以开始')}>{dateRow('availableAt')}</Row> },
    { id: 'days', empty: !days.length, node: <Row id="days" icon={<CalendarDays className="h-4 w-4" />} label={l('Day to do', '哪天想做')}>
      {days.map(day => <span key={day} className={`${chip} ${day < today ? 'text-muted-foreground' : ''}`}>{day === today ? l('Today', '今天') : day}
        {!closed && <button type="button" className="rounded p-0.5 hover:bg-background" aria-label={`${l('Remove day commitment', '取消当天意向')}: ${day}`} disabled={busy}
          onClick={() => run(() => editTask(task.id, (latest, clock) => commitToDay(latest, day, false, clock)))}><X className="h-3.5 w-3.5" /></button>}</span>)}
      {!closed && <>
        {!days.includes(today) && <button type="button" className={small} disabled={busy} onClick={() => run(() => editTask(task.id, (latest, clock) => commitToDay(latest, today, true, clock)), l('Day plan updated.', '当天计划已更新。'))}>{l('+ Today', '+ 今天')}</button>}
        <Reveal label={l('+ Other day', '+ 其他日期')} className={small}>{close => <input type="date" autoFocus aria-label={l('Choose a day', '哪天想做')} data-inline-edit="property" className={field} value=""
          ref={node => { try { node?.showPicker?.(); } catch { /* picker needs a user gesture; the field stays focused */ } }}
          onChange={e => { const day = e.target.value; if (day) { close(); void run(() => editTask(task.id, (latest, clock) => commitToDay(latest, day, true, clock)), l('Day plan updated.', '当天计划已更新。')); } }} />}</Reveal>
      </>}
    </Row> },
    { id: 'blocks', empty: !blocks.length && !reservation, node: <Row id="blocks" icon={<Clock3 className="h-4 w-4" />} label={l('Time blocks', '时段')}>
      <div className="w-full space-y-1">
        {activeBlocks.map(b => <WorkBlockRow key={b.id} block={b} label={blockLabel(b)} open={openBlock === b.id} onToggle={() => setOpenBlock(openBlock === b.id ? undefined : b.id)}>
          {!closed && <><div className="flex flex-wrap gap-1"><button className={small} onClick={() => beginReservation(b)}>{l('Move / resize', '改期／改时长')}</button>
            <button className={small} disabled={busy} onClick={() => run(() => editTask(task.id, (latest, c) => changeWork(latest, b.id, 'complete', c)), l('This block is complete. The task remains open.', '本段已完成，任务仍保留。'))}>{l('Complete this block', '完成本段')}</button>
            <button className={small} disabled={busy} onClick={() => run(() => editTask(task.id, (latest, c) => changeWork(latest, b.id, 'cancel', c)), l('Reservation cancelled; task kept.', '已取消时段，任务保留。'))}>{l('Cancel this block', '取消本段')}</button>
            {b.origin === 'rollover' && <button className={small} disabled={busy} onClick={() => run(() => editTask(task.id, (latest, c) => changeWork(latest, b.id, 'undo-rollover', c)))}>{l('Undo automatic move', '撤销自动顺延')}</button>}</div>
            <div className="flex flex-wrap items-end gap-2"><label className="text-xs text-muted-foreground">{l('Total minutes actually done in this block', '本段累计实际做了几分钟')}<input type="number" min={0} max={b.allocatedMinutes} data-inline-edit="property" className={`${field} ml-2 w-24 border-border`} value={progress[b.id] ?? b.completedMinutes} onChange={e => setProgress(p => ({ ...p, [b.id]: e.target.valueAsNumber }))} /></label>
              <button className={small} disabled={busy} onClick={() => run(() => editTask(task.id, (latest, c) => changeWork(latest, b.id, 'progress', c, progress[b.id] ?? b.completedMinutes)), l('Progress saved. Only the remaining allocation will move.', '进度已保存，只续排剩余工作量。'))}>{l('Pause and reschedule remainder', '暂停，续排剩余')}</button></div></>}
          <p className="text-xs text-muted-foreground">{l('Confirmed progress', '已确认进度')} {b.completedMinutes}/{b.allocatedMinutes} min{b.reason ? ` · ${b.reason}` : ''}{b.origin === 'rollover' ? ` · ${l('Automatically moved; your deadline is unchanged.', '已自动顺延，原截止日期没有改变。')}` : ''}</p>
          {!!b.history.length && <details><summary className="min-h-9 cursor-pointer text-xs">{l('Previous reservations', '原安排记录')}</summary>{b.history.map((h, i) => <p key={i} className="text-xs text-muted-foreground">{new Date(h.startAt).toLocaleString()} · {h.durationMinutes} min · {h.reason}</p>)}</details>}
        </WorkBlockRow>)}
        {reservation && <div className="space-y-2 rounded-md border border-primary/40 bg-muted/30 p-3" aria-label={l('Reserve a work block', '预留一个时段')} role="group">
          <div className="flex flex-wrap gap-2">
            <label className="text-xs text-muted-foreground">{l('Start time', '开始时间')}<input type="datetime-local" data-inline-edit="property" className={`${field} ml-1 border-border`} value={reservation.start} onChange={e => setReservation({ ...reservation, start: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">{l('Minutes for this block', '本次安排几分钟')}<input type="number" data-inline-edit="property" className={`${field} ml-1 w-20 border-border`} min={1} max={1440} value={reservation.duration} onChange={e => setReservation({ ...reservation, duration: e.target.valueAsNumber })} /></label>
          </div>
          <p className="text-xs text-muted-foreground">{l('Nearby meetings', '相邻会议')}：{events.filter(e => localPlanDate(new Date(e.start)) === reservation.start.slice(0, 10)).map(e => `${new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${e.title}`).join(' · ') || l('None in the loaded calendar', '已读取的日历中没有')}</p>
          <p role="status" className="text-xs text-muted-foreground">{loaded && !calendarError ? l('Calendar constraints loaded', '已读取日历约束') : l('Calendar unavailable; reservation is not saved.', '日历尚未就绪，不能保存时段。')}</p>
          <div className="flex flex-wrap gap-2"><button className="min-h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-40" disabled={busy || !loaded || !!calendarError} onClick={reserve}>{task.status === 'next' ? l('Save reservation', '保存时段') : l('Activate and reserve', '启用并预留')}</button>
            <button className={small} onClick={() => setReservation(null)}>{l('Cancel reservation edit', '取消时段编辑')}</button></div>
        </div>}
        {!closed && !reservation && <button type="button" className={small} onClick={() => beginReservation()}>{l('Reserve a work block', '预留一个时段')}</button>}
        {!!pastBlocks.length && <details><summary className="min-h-9 cursor-pointer text-xs text-muted-foreground">{l('Past blocks', '过去的时段')} · {pastBlocks.length}</summary>
          {pastBlocks.map(b => <p key={b.id} id={`work-${b.id}`} data-block-id={b.id} className="text-xs text-muted-foreground">{blockLabel(b)} · {b.completedMinutes}/{b.allocatedMinutes} min</p>)}</details>}
      </div>
    </Row> },
    { id: 'estimate', empty: !task.timeEstimate && estimate === null, node: <Row id="estimate" icon={<Timer className="h-4 w-4" />} label={l('Estimate', '预计')}>
      <input type="number" min={1} aria-label={l('Total estimated minutes (not this reservation)', '总预计分钟数（不是本次时长）')} data-inline-edit="property" className={`${field} w-24`} placeholder={l('minutes', '分钟')}
        value={estimate ?? estimateMinutes(task.timeEstimate) ?? ''} onChange={e => setEstimate(e.target.value)}
        onBlur={() => { if (estimate === null) return; const minutes = Number(estimate); setEstimate(null); void edit(() => ({ timeEstimate: estimate && minutes > 0 ? `custom:${minutes}` : undefined } as Partial<Task>)); }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <span className="text-xs text-muted-foreground">{l('min in total', '分钟（总量）')}</span>
    </Row> },
    { id: 'belongs', empty: !task.projectId && !task.areaId, node: <Row id="belongs" icon={<FolderTree className="h-4 w-4" />} label={l('Belongs to', '归属')}>
      <select aria-label={l('Belongs to', '归属')} data-inline-edit="property" className={field} value={task.projectId ? `p:${task.projectId}` : task.areaId ? `a:${task.areaId}` : ''} disabled={busy} onChange={e => {
        const [kind, id] = e.target.value.split(':');
        void edit(() => ({ projectId: kind === 'p' ? id : undefined, areaId: kind === 'a' ? id : undefined }));
      }}><option value="">{l('Unassigned', '暂不分类')}</option>{areas.map(a => <optgroup key={a.id} label={a.name}><option value={`a:${a.id}`}>{a.name}</option>{projects.filter(p => p.areaId === a.id).map(p => <option key={p.id} value={`p:${p.id}`}>{p.title}</option>)}</optgroup>)}{projects.filter(p => !p.areaId).map(p => <option key={p.id} value={`p:${p.id}`}>{p.title}</option>)}</select>
    </Row> },
    { id: 'repeat', empty: !task.recurrence && !repeatOpen, node: <Row id="repeat" icon={<Repeat2 className="h-4 w-4" />} label={l('Repeat', '重复')}>
      <div className="w-full space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={`${small} text-foreground`} onClick={() => setRepeatOpen(!repeatOpen)}>{task.recurrence ? `${({ daily: l('Daily', '按天'), weekly: l('Weekly', '按周'), monthly: l('Monthly', '按月'), yearly: l('Yearly', '按年') } as Record<string, string>)[typeof task.recurrence === 'string' ? task.recurrence : task.recurrence.rule] ?? ''}${nextDate ? ` · ${l('next', '下次')} ${nextDate}` : ''}` : l('Does not repeat', '不重复')}</button>
          {task.recurrence && !closed && <><button className={small} disabled={busy} onClick={() => run(() => editTask(task.id, skipRecurringWork), l('Occurrence skipped, not marked completed.', '已跳过本次，没有伪造完成记录。'))}>{l('Skip this occurrence', '跳过本次')}</button>
            <button className={small} disabled={busy} onClick={() => edit(() => ({ recurrence: undefined }), l('Repeating stopped; this task is kept.', '已停止后续重复，当前任务保留。'))}>{l('Stop repeating', '停止后续重复')}</button></>}
        </div>
        {repeatOpen && <div className="rounded-md border border-border p-3"><RepeatPicker value={task.recurrence} onChange={value => void edit(() => ({ recurrence: value }))} />
          <p className="mt-2 text-xs text-muted-foreground">{l('Applies to this occurrence and later ones; the next one is only created after completing or skipping.', '用于本次及以后；完成或跳过本次后才生成下一次。')}</p></div>}
      </div>
    </Row> },
    { id: 'links', empty: !task.parentTaskId && !linkedHere, node: <Row id="links" icon={<Link2 className="h-4 w-4" />} label={l('Linked to', '关联')}>
      <TaskLinks task={task} onOpenTask={onOpenTask} onBusyChange={onBusyChange} />
    </Row> },
  ];
  const hidden = rows.filter(row => row.empty && !showEmpty);
  return <section aria-label={l('Properties', '属性')} className="space-y-0.5 border-y border-border/60 py-3">
    {rows.filter(row => !hidden.includes(row)).map(row => <div key={row.id}>{row.node}</div>)}
    {hidden.length > 0 && <button type="button" className={small} onClick={() => setShowEmpty(true)}>{l(`+ ${hidden.length} more properties`, `+ 其他 ${hidden.length} 个属性`)}</button>}
    {showEmpty && <button type="button" className={small} onClick={() => setShowEmpty(false)}>{l('Hide empty properties', '收起空属性')}</button>}
  </section>;
}

function WorkBlockRow({ block, label, open, onToggle, children }: { block: WorkBlock; label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <article id={`work-${block.id}`} data-block-id={block.id} className={`rounded-md ${open ? 'border border-border p-2' : ''}`}>
    <button type="button" className="min-h-9 w-full rounded-md px-2 text-left text-sm hover:bg-muted" aria-expanded={open} onClick={onToggle}>{label}</button>
    {open && <div className="space-y-2 px-2 pb-1">{children}</div>}
  </article>;
}

/** An optional value stays a quiet "+ label" until it is wanted; then the real input opens (with its picker). */
function Reveal({ label, className, children }: { label: string; className: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return open ? <span className="contents" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>{children(() => setOpen(false))}</span>
    : <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>;
}
