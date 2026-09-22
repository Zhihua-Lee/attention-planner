import { useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { localPlanDate, scheduleWork, taskPlanner, type ExternalCalendarEvent, type Task } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { checkReservation, editTask, openTaskDetails } from '../../lib/lifecycle-actions';
import { buildPlannerCalendarDay, PLANNER_DAY_HEIGHT, PLANNER_HOUR_HEIGHT } from './planner-calendar-layout';

type Props = {
    day: string; setDay: (day: string) => void; span: 1 | 7; setSpan: (span: 1 | 7) => void;
    showViewSwitch: boolean; now: Date; tasks: Task[]; events: ExternalCalendarEvent[];
    calendarTrusted: boolean; isBlocked: (task: Task) => boolean;
    capture: (date: Date) => void; openEvent: (event: ExternalCalendarEvent) => void;
    run: (action: () => Promise<unknown>) => Promise<void>;
};
const control = 'inline-flex min-h-11 shrink-0 items-center justify-center rounded-md px-3 text-sm hover:bg-muted focus-visible:outline-primary';
export function PlannerCalendar({ day, setDay, span, setSpan, showViewSwitch, now, tasks, events, calendarTrusted, isBlocked, capture, openEvent, run }: Props) {
    const { language } = useLanguage();
    const l = (en: string, zh: string) => language.startsWith('zh') ? zh : en;
    const timeline = useRef<HTMLDivElement>(null);
    const today = localPlanDate(now);
    const days = useMemo(() => Array.from({ length: span }, (_, index) => {
        const date = new Date(`${day}T12:00:00`);
        date.setDate(date.getDate() + index);
        const key = localPlanDate(date);
        return { date, key, ...buildPlannerCalendarDay(key, tasks, events) };
    }), [day, span, tasks, events]);
    useEffect(() => {
        if (timeline.current) timeline.current.scrollTop = Math.max(0, (now.getHours() - 1) * PLANNER_HOUR_HEIGHT);
        // Start near the current hour on entry/date changes, not every clock tick.
    }, [day, span]);
    const move = (amount: number) => {
        const date = new Date(`${day}T12:00:00`);
        date.setDate(date.getDate() + amount);
        setDay(localPlanDate(date));
    };
    const columnWidth = span === 1 ? Math.max(220, days[0].columns * 76) : Math.max(148, ...days.map(d => d.columns * 48));
    const grid = { gridTemplateColumns: `3.25rem repeat(${span}, minmax(${columnWidth}px, 1fr))` };
    const time = (value: string) => new Date(value).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' });
    return <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card" aria-label={l('Time overview', '时间总览')}>
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border p-2 sm:p-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
                <button type="button" className={control} aria-label={l('Previous day', '前一天')} onClick={() => move(-span)}><ChevronLeft className="h-4 w-4" /></button>
                <input type="date" aria-label={l('Planning date', '规划日期')} value={day} onChange={e => { if (e.target.value) setDay(e.target.value); }} className="min-h-11 min-w-0 w-[9.25rem] rounded-md border border-border bg-background px-2 text-sm tabular-nums" />
                <button type="button" className={control} aria-label={l('Next day', '后一天')} onClick={() => move(span)}><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="flex flex-wrap items-center gap-2"><button type="button" className={control} onClick={() => setDay(today)}>{l('Today', '今天')}</button>{showViewSwitch && <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label={l('Calendar view', '日历视图')}>
                {([1, 7] as const).map(value => <button key={value} type="button" className={`${control} ${span === value ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground'}`} aria-pressed={span === value} onClick={() => setSpan(value)}>{value === 1 ? l('Day', '日') : l('Week', '周')}</button>)}
            </div>}</div>
        </header>
        <div ref={timeline} className="max-h-[70dvh] min-w-0 overflow-auto overscroll-contain" data-testid="planner-timeline">
            <div style={{ minWidth: 52 + span * columnWidth }}>
                <div className="sticky top-0 z-30 border-b border-border bg-card">
                    <div className="grid" style={grid}>
                        <div className="sticky left-0 z-10 bg-card" />
                        {days.map(({ date, key }) => <div key={key} className={`flex min-h-14 items-center justify-center gap-2 border-l border-border px-2 py-2 text-xs ${key === today ? 'bg-primary/5' : ''}`}>
                            <span className="text-muted-foreground">{date.toLocaleDateString(language, { weekday: 'short' })}</span>
                            <span className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-sm font-semibold tabular-nums ${key === today ? 'bg-primary text-primary-foreground' : ''}`}>{date.getDate()}</span>
                        </div>)}
                    </div>
                    {days.some(d => d.allDay.length) && <div className="grid border-t border-border/60" style={grid} data-testid="planner-all-day">
                        <div className="sticky left-0 z-10 bg-card px-1 py-3 text-center text-[11px] text-muted-foreground">{l('All day', '全天')}</div>
                        {days.map(d => <div key={d.key} className="max-h-36 space-y-1 overflow-y-auto border-l border-border p-1">
                            {d.allDay.map(event => <button type="button" key={event.id} aria-label={event.title} onClick={() => openEvent(event)} className="block min-h-11 w-full rounded-md border-l-2 border-primary/50 bg-muted px-2 py-1 text-left text-xs focus-visible:outline-primary" title={event.title}><span className="line-clamp-2 break-words">{event.title}</span></button>)}
                        </div>)}
                    </div>}
                </div>
                <div className="grid" style={grid} data-testid="planner-time-grid">
                    <div className="sticky left-0 z-20 bg-card" style={{ height: PLANNER_DAY_HEIGHT }}>{Array.from({ length: 24 }, (_, hour) => <span key={hour} className="absolute right-2 text-[11px] tabular-nums text-muted-foreground" style={{ top: hour * PLANNER_HOUR_HEIGHT + 4 }}>{String(hour).padStart(2, '0')}:00</span>)}</div>
                    {days.map(d => <div key={d.key} className="relative border-l border-border" style={{ height: PLANNER_DAY_HEIGHT }} data-calendar-day={d.key}>
                        {Array.from({ length: 48 }, (_, half) => {
                            const slot = new Date(`${d.key}T${String(Math.floor(half / 2)).padStart(2, '0')}:${half % 2 ? '30' : '00'}:00`);
                            return <button type="button" key={half} aria-label={`${l('Reserve', '预留')} ${d.key} ${time(slot.toISOString())}`} className={`absolute left-0 w-full hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline-primary ${half % 2 ? 'border-t border-dashed border-border/40' : 'border-t border-border/70'}`} style={{ top: half * PLANNER_HOUR_HEIGHT / 2, height: PLANNER_HOUR_HEIGHT / 2 }} onClick={() => capture(slot)} onDragOver={e => e.preventDefault()} onDrop={e => {
                                e.preventDefault();
                                const raw = e.dataTransfer.getData('application/x-attention-block');
                                void run(async () => {
                                    const value = JSON.parse(raw);
                                    if (!value.taskId || !value.blockId) throw new Error(l('Could not move this block.', '无法移动这个时段。'));
                                    await editTask(value.taskId, (latest, clock) => {
                                        const block = taskPlanner(latest).blocks.find(b => b.id === value.blockId);
                                        if (!block) throw new Error(l('Block no longer exists.', '这个时段已不存在。'));
                                        checkReservation(latest.id, block.id, slot.toISOString(), block.durationMinutes, events, calendarTrusted);
                                        return scheduleWork(latest, { id: block.id, startAt: slot.toISOString(), durationMinutes: block.durationMinutes, timeZone: block.timeZone }, clock);
                                    });
                                });
                            }} />;
                        })}
                        {d.timed.map(item => {
                            const isEvent = item.kind === 'event';
                            const location = isEvent ? item.event.location : '';
                            const compact = item.height < 64;
                            const label = `${item.title}${location ? ` · ${location}` : ''}`;
                            return <button key={item.id} type="button" data-calendar-item={item.id} data-calendar-block={item.kind === 'task' ? item.block.id : undefined} aria-label={label} draggable={!isEvent} onDragStart={e => { if (item.kind === 'task') e.dataTransfer.setData('application/x-attention-block', JSON.stringify({ taskId: item.task.id, blockId: item.block.id })); }} onClick={() => item.kind === 'event' ? openEvent(item.event) : openTaskDetails(item.task.id, item.block.id)}
                                className={`absolute z-10 overflow-hidden rounded-md border border-l-[3px] px-2 py-1 text-left text-xs leading-4 focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-primary ${isEvent ? 'border-border border-l-primary/50 bg-muted text-foreground hover:brightness-95' : 'border-primary/30 border-l-primary bg-card text-foreground hover:bg-accent'}`}
                                style={{ top: item.top, height: item.height, left: `calc(${item.leftPercent}% + 2px)`, width: `calc(${item.widthPercent}% - 4px)` }} title={`${label}\n${time(item.start)} – ${time(item.end)}`}>
                                <span className={`break-words font-semibold [overflow-wrap:anywhere] ${compact ? 'block truncate' : item.height >= 100 ? 'line-clamp-3' : 'line-clamp-2'}`}>{item.title}</span>
                                <span className="block truncate text-[11px] tabular-nums text-muted-foreground">{time(item.start)} – {time(item.end)}</span>
                                {!compact && location && <span className="block truncate text-[11px] text-muted-foreground">{location}</span>}
                                {item.kind === 'task' && item.height >= 90 && <span className="block truncate text-[11px] text-muted-foreground">{item.block.durationMinutes} min{isBlocked(item.task) ? ` · ${l('blocked', '条件未满足')}` : ''}{item.block.origin === 'rollover' ? ` · ${l('moved', '已顺延')}` : ''}</span>}
                            </button>;
                        })}
                        {d.key === today && <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-primary" style={{ top: (now.getHours() * 60 + now.getMinutes()) * PLANNER_HOUR_HEIGHT / 60 }} />}
                    </div>)}
                </div>
            </div>
        </div>
    </section>;
}
