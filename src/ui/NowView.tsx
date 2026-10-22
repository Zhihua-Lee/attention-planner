import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { addDays, dayOf, minutesOf, nowMinutes, timeOf, weekStart } from '../model/dates';
import { agenda, capacity, currentEvent, eventsOn, nextEvent, nowCandidates } from '../model/derive';
import { layoutBlocks, type Block } from '../model/layout';
import { complete, removePlan } from '../model/doc';
import type { CalendarEvent, Day, Task } from '../model/types';
import { store, useStore } from '../store/store';
import { Popover, toast, usePopover } from './common';
import { FocusCard } from './FocusCard';
import { EventPeek, eventFrom, eventWhen, SlotPeek, TaskPeek } from './Peek';
import { ReserveSheet } from './Reserve';
import { ContextMenu, useMenu, type MenuItem } from './RightMenu';
import { duration, monthDay, partName, planLabel, relDay, useT, weekdayName } from './text';

const ease = [0.2, 0.8, 0.2, 1] as const;

export function NowView({ now, open }: { now: Date; open: (id: string) => void }) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const [skip, setSkip] = useState(0);
  const [goalOpen, setGoalOpen] = useState(false);
  const today = dayOf(now);
  const event = currentEvent(doc, now);
  const all = nowCandidates(doc, now);
  const i = all.length ? skip % all.length : 0;
  const pick = all[i];
  const next = all.length > 1 ? all[(i + 1) % all.length] : undefined;
  const upcoming = nextEvent(doc, now);
  const short = capacity(doc, now);

  let card;
  if (event) {
    card = (
      <>
        <div className="focus-head">
          <span className="kicker">{t('正在进行', 'Happening now')}</span>
          <span>{t('日历', 'Calendar')}</span>
        </div>
        <h1>{event.title}</h1>
        <div className="why">
          {event.start}–{event.end}
        </div>
        {pick && (
          <div className="up-next">
            {t('之后：', 'After this: ')}
            {pick.task.title}
          </div>
        )}
      </>
    );
  } else if (pick) {
    card = (
      <FocusCard
        pick={pick}
        next={next}
        another={() => setSkip((s) => s + 1)}
        now={now}
        freeUntil={upcoming}
        open={open}
      />
    );
  } else {
    card = (
      <>
        <div className="focus-head">
          <span className="kicker">{t('现在做', 'Now')}</span>
        </div>
        <h1>{t('没有要做的事', 'Nothing to do')}</h1>
        <div className="why">{t('在清单里记下的任务会出现在这里。', 'Tasks you add to the list show up here.')}</div>
      </>
    );
  }

  // The goal, if the owner chose to see it here: its first line, quietly; tap for the whole text.
  const goal = doc.settings.showGoal ? doc.settings.goal?.trim() : undefined;
  const goalLine = goal
    ?.split('\n')
    .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
    .find(Boolean);
  return (
    <div className="stack">
      {goal && goalLine && (
        <button
          className={`goal${goalOpen ? ' open' : ''}`}
          aria-expanded={goalOpen}
          aria-label={t('目标', 'Goal')}
          onClick={() => setGoalOpen((v) => !v)}
        >
          {goalOpen ? goal : goalLine}
        </button>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={event?.id ?? pick?.task.id ?? 'none'}
          className="focus"
          aria-live="polite"
          data-testid="now-card"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease }}
        >
          {card}
        </motion.section>
      </AnimatePresence>
      {short && (
        <div className="capacity" role="note">
          <span className="dot" aria-hidden="true" />
          {t(
            `${short.task.title}：${relDay(short.task.due!, today, lang)}前大约还差 ${duration(short.missing, lang)}`,
            `${short.task.title}: about ${duration(short.missing, lang)} short before ${relDay(short.task.due!, today, lang)}`,
          )}
        </div>
      )}
      <Agenda now={now} open={open} />
    </div>
  );
}

function Agenda({ now, open }: { now: Date; open: (id: string) => void }) {
  const { doc, sync } = useStore();
  const { t, lang } = useT();
  const today = dayOf(now);
  const [range, setRange] = useState<'day' | 'week'>('day');
  const [cursor, setCursor] = useState<Day>(today);
  const ws = weekStart(cursor);
  const atToday = range === 'day' ? cursor === today : ws === weekStart(today);
  const label =
    range === 'day'
      ? `${monthDay(cursor)} ${weekdayName(cursor, lang)}${cursor === today ? ` · ${t('今天', 'today')}` : ''}`
      : `${monthDay(ws)} – ${monthDay(addDays(ws, 6))}`;
  const noEvents = !doc.events?.length;
  return (
    <section className="agenda" aria-label={t('日程', 'Agenda')}>
      <div className="agenda-head">
        <div className="nav">
          <button className="today-btn" disabled={atToday} onClick={() => setCursor(today)}>
            {t('今天', 'Today')}
          </button>
          <button
            className="arrow"
            aria-label={range === 'day' ? t('前一天', 'Previous day') : t('上一周', 'Previous week')}
            onClick={() => setCursor(addDays(cursor, range === 'day' ? -1 : -7))}
          >
            ‹
          </button>
          <button
            className="arrow"
            aria-label={range === 'day' ? t('后一天', 'Next day') : t('下一周', 'Next week')}
            onClick={() => setCursor(addDays(cursor, range === 'day' ? 1 : 7))}
          >
            ›
          </button>
          <span className="lbl" aria-live="polite">
            {label}
          </span>
        </div>
        <div className="seg small" role="group" aria-label={t('范围', 'Range')}>
          <button aria-pressed={range === 'day'} onClick={() => setRange('day')}>
            {t('日', 'Day')}
          </button>
          <button aria-pressed={range === 'week'} onClick={() => setRange('week')}>
            {t('周', 'Week')}
          </button>
        </div>
      </div>
      {range === 'day' ? (
        <DayView day={cursor} now={now} open={open} />
      ) : (
        <WeekView start={ws} now={now} open={open} pickDay={(d) => (setCursor(d), setRange('day'))} />
      )}
      {noEvents && (
        <div className="agenda-note">
          {sync.status === 'off'
            ? t(
                '日历还没接入：在设置里连接同步后会自动读取 Outlook 日历，也可以导入 .ics 文件。',
                'No calendar yet: connect sync in Settings to read your Outlook calendar, or import an .ics file.',
              )
            : t(
                'Google Drive 里没找到 Outlook 日历导出文件；也可以在设置里导入 .ics 文件。',
                'No Outlook calendar export found in Google Drive; you can also import an .ics file in Settings.',
              )}
        </div>
      )}
    </section>
  );
}

type At = React.MouseEvent<HTMLElement>;

/**
 * Right-click menus for the agenda, the same in the day and the week: a reserved time (finish, change the time, open,
 * remove), a calendar event (what and where it comes from, details, reserve the time after it), a task shown on a day
 * (finish, open), and a day of the week (see it, reserve time on it).
 */
function useAgendaMenu(handlers: {
  open: (id: string) => void;
  peek: (key: string, el: HTMLElement) => void;
  reserve: (day: Day, start: number) => void;
}) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const menu = useMenu();
  const today = dayOf(new Date());
  const nowMin = nowMinutes(new Date());
  const finish = (task: Task): MenuItem => ({
    label: task.repeat?.mode === 'reopen' ? t('完成本轮', 'Finish this round') : t('完成任务', 'Finish the task'),
    run: () => {
      try {
        store.commit((d, c) => complete(d, c, task.id));
        toast(t(`完成了“${task.title}”`, `Done: “${task.title}”`), () => store.undo());
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
      }
    },
  });
  const openTask = (task: Task): MenuItem => ({ label: t('打开任务', 'Open task'), run: () => handlers.open(task.id) });
  const show = (ev: At, label: string, items: MenuItem[], head?: { title: string; note?: string }) => {
    ev.preventDefault();
    ev.stopPropagation();
    menu.openAt(ev, ev.currentTarget, label, items, head);
  };
  return {
    element: menu.menu && <ContextMenu menu={menu.menu} onClose={menu.close} />,
    /** A calendar event; `key` opens its details. */
    event: (ev: At, e: CalendarEvent, key: string) => {
      const el = ev.currentTarget;
      show(
        ev,
        e.title,
        [
          { label: t('详情', 'Details'), run: () => handlers.peek(key, el) },
          // Time after it, while it has not ended and some of the day is left.
          ...(e.allDay ||
          minutesOf(e.end) > 23 * 60 + 30 ||
          e.day < today ||
          (e.day === today && minutesOf(e.end) <= nowMin)
            ? []
            : [
                {
                  label: t(`接着安排一件事（${e.end} 起）…`, `Plan something right after (from ${e.end})…`),
                  run: () => handlers.reserve(e.day, minutesOf(e.end)),
                },
              ]),
        ],
        { title: e.title, note: `${eventWhen(e, lang, t)} · ${eventFrom(doc, e, t)}` },
      );
    },
    /** A reserved time; `key` opens it at changing the time. */
    slot: (ev: At, task: Task, entryId: string, key: string) => {
      const el = ev.currentTarget;
      const entry = task.plan.find((p) => p.id === entryId);
      const step = entry?.stepId ? task.steps.find((s) => s.id === entry.stepId && !s.deleted)?.text : undefined;
      show(
        ev,
        task.title,
        [
          finish(task),
          { label: t('改时间…', 'Change time…'), run: () => handlers.peek(key, el) },
          openTask(task),
          'sep',
          {
            label: t('取消这次预留', 'Remove this time'),
            danger: true,
            run: () => {
              store.commit((d, c) => removePlan(d, c, task.id, entryId));
              toast(t('已删除这次安排', 'Arrangement removed'), () => store.undo());
            },
          },
        ],
        { title: step ? `${step} · ${task.title}` : task.title, note: entry && planLabel(entry, today, lang) },
      );
    },
    /** A task on a day without a time: its deadline or a plan for the day. */
    task: (ev: At, task: Task, note: string) =>
      show(ev, task.title, [finish(task), openTask(task)], { title: task.title, note }),
    /** A day of the week. */
    day: (ev: At, day: Day, see: () => void) =>
      show(
        ev,
        `${weekdayName(day, lang)} ${monthDay(day)}`,
        [
          { label: t('看这一天', 'See this day'), run: see },
          {
            label: t('在这天预留…', 'Reserve time on this day…'),
            run: () => handlers.reserve(day, minutesOf(doc.settings.workStart)),
          },
        ],
        { title: `${weekdayName(day, lang)} ${monthDay(day)}` },
      ),
  };
}

// One fixed scale keeps the day an overview: a half hour is one line, an hour fits a title and its time.
const HOUR = 40; // px per hour
const MIN = HOUR / 60;
const LINE = 16; // px per line of title in a block
const GUTTER = 50; // room for the hour labels

/**
 * One day: what has no set time on top (all-day events, deadlines, plans for the day), then all 24 hours in a
 * scrolling column that opens at the current time. Overlapping items share the width side by side. Tap an item for
 * details; tap an empty time to reserve it. A right-click opens the menus of `useAgendaMenu`; on an empty time it
 * reserves it, like a tap.
 */
function DayView({ day, now, open }: { day: Day; now: Date; open: (id: string) => void }) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const peek = usePopover<string>();
  const [reserve, setReserve] = useState<number | null>(null);
  const menu = useAgendaMenu({ open, peek: (k, el) => peek.toggle(k, el), reserve: (_, start) => setReserve(start) });
  const scroller = useRef<HTMLDivElement>(null);
  const items = agenda(doc, day, now);
  const isToday = day === dayOf(now);
  const n = nowMinutes(now);
  const allDay = eventsOn(doc, day, true).filter((e) => e.allDay);
  const placed = layoutBlocks(
    items.flatMap((x): Block[] =>
      x.kind === 'event'
        ? [
            {
              key: x.event.id,
              kind: 'event',
              title: x.event.title,
              s: minutesOf(x.event.start),
              e: Math.max(minutesOf(x.event.end), minutesOf(x.event.start) + 15),
              sub: x.event.location,
            },
          ]
        : x.kind === 'slot'
          ? [
              {
                key: x.entryId,
                kind: 'slot',
                title: x.step ? `${x.step} · ${x.task.title}` : x.task.title,
                s: x.start,
                e: x.end,
                taskId: x.task.id,
              },
            ]
          : [],
    ),
  );
  const loose = items.filter((x) => x.kind === 'loose' || x.kind === 'due');
  const order = { am: 1, pm: 2, eve: 3 } as const;
  loose.sort(
    (a, b) =>
      (a.kind === 'due' ? 0 : a.kind === 'loose' && a.part ? order[a.part] : 4) -
      (b.kind === 'due' ? 0 : b.kind === 'loose' && b.part ? order[b.part] : 4),
  );

  // Open at the current time (today) or a little before the first thing scheduled.
  const first = Math.min(8 * 60, ...placed.map((b) => b.s));
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, ((isToday ? n : first) - 45) * MIN);
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  const events = new Map(eventsOn(doc, day, true).map((e) => [e.id, e]));
  const togglePeek = (key: string) => (ev: React.MouseEvent<HTMLElement>) => peek.toggle(key, ev.currentTarget);
  const blockMenu = (b: (typeof placed)[number]) => (ev: At) => {
    const task = b.taskId ? doc.tasks[b.taskId] : undefined;
    const event = events.get(b.key);
    if (task) menu.slot(ev, task, b.key, `e:${b.key}`);
    else if (event) menu.event(ev, event, b.key);
  };
  return (
    <>
      {(allDay.length > 0 || loose.length > 0) && (
        <div className="loose">
          {allDay.map((e) => (
            <button
              key={e.id}
              className="pill allday"
              aria-expanded={peek.is(e.id)}
              onClick={togglePeek(e.id)}
              onContextMenu={(ev) => menu.event(ev, e, e.id)}
            >
              <span className="part">{t('全天', 'All day')}</span>
              {e.title}
            </button>
          ))}
          {loose.map((x) =>
            x.kind === 'due' || x.kind === 'loose' ? (
              <button
                key={x.kind === 'due' ? `d${x.task.id}${x.step ?? ''}` : x.entryId}
                className="pill"
                aria-expanded={peek.is(`t:${x.task.id}`)}
                onClick={togglePeek(`t:${x.task.id}`)}
                onContextMenu={(ev) =>
                  menu.task(
                    ev,
                    x.task,
                    x.kind === 'due'
                      ? t('这天截止', 'Due this day')
                      : x.part
                        ? partName(x.part, lang)
                        : t('安排在这天', 'Planned for this day'),
                  )
                }
              >
                {x.kind === 'due' ? (
                  <span className="part late">{t('截止', 'Due')}</span>
                ) : (
                  x.part && <span className="part">{partName(x.part, lang)}</span>
                )}
                {x.step ? `${x.step} · ${x.task.title}` : x.task.title}
              </button>
            ) : null,
          )}
        </div>
      )}
      <div className="day-scroll" ref={scroller}>
        <div className="timeline" style={{ height: 24 * HOUR }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="hour" style={{ top: h * HOUR }}>
              {h ? timeOf(h * 60) : ''}
            </div>
          ))}
          <div
            className="lane-area"
            style={{ left: GUTTER }}
            title={t('点空白处预留时段', 'Tap an empty time to reserve it')}
            onClick={(e) => {
              if (e.target !== e.currentTarget) return;
              setReserve(Math.min(23 * 60 + 30, Math.floor(e.nativeEvent.offsetY / MIN / 30) * 30));
            }}
            onContextMenu={(e) => {
              if (e.target !== e.currentTarget) return;
              e.preventDefault();
              setReserve(Math.min(23 * 60 + 30, Math.floor(e.nativeEvent.offsetY / MIN / 30) * 30));
            }}
          >
            {placed.map((b) => {
              const height = Math.max(18, (b.e - b.s) * MIN - 2);
              const short = height < 2 * LINE + 4;
              // Lines the title may wrap to, leaving one line for the time.
              const lines = short ? 1 : Math.max(1, Math.floor((height - 4) / LINE) - 1);
              return (
                <button
                  key={b.key}
                  className={`blk ${b.kind}${short ? ' brief' : ''}`}
                  style={{
                    top: b.s * MIN + 1,
                    height,
                    left: `calc(${(b.lane / b.lanes) * 100}% + 1px)`,
                    width: `calc(${100 / b.lanes}% - 3px)`,
                  }}
                  aria-expanded={peek.is(b.key)}
                  onClick={togglePeek(b.key)}
                  onContextMenu={blockMenu(b)}
                  title={b.sub ? `${b.title} · ${b.sub}` : b.title}
                >
                  <span className="bt" style={short ? undefined : { WebkitLineClamp: lines }}>
                    {b.title}
                  </span>
                  <span className="t">
                    {timeOf(b.s)}–{timeOf(Math.min(b.e, 24 * 60 - 1))}
                    {b.sub ? ` · ${b.sub}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
          {isToday && (
            <div className="nowline" style={{ top: n * MIN }} aria-label={`${t('现在', 'Now')} ${timeOf(n)}`}>
              <span className="now-tag">{timeOf(n)}</span>
            </div>
          )}
        </div>
      </div>
      {peek.open && (
        <Popover anchor={peek.open.el} onClose={peek.close} label={t('详情', 'Details')}>
          {(() => {
            const key = peek.open.key;
            if (key.startsWith('t:')) {
              const task = doc.tasks[key.slice(2)];
              return task ? <TaskPeek task={task} open={open} close={peek.close} /> : null;
            }
            const ev = events.get(key);
            if (ev) return <EventPeek event={ev} />;
            // "e:" opens a reserved time at changing it (from its right-click menu).
            const slot = key.startsWith('e:') ? key.slice(2) : key;
            const b = placed.find((x) => x.key === slot);
            const task = b?.taskId ? doc.tasks[b.taskId] : undefined;
            const entry = task?.plan.find((x) => x.id === slot);
            return task && entry ? (
              <SlotPeek task={task} entry={entry} open={open} close={peek.close} editing={slot !== key} />
            ) : null;
          })()}
        </Popover>
      )}
      {menu.element}
      {reserve !== null && <ReserveSheet day={day} start={reserve} onClose={() => setReserve(null)} />}
    </>
  );
}

type WeekRef =
  | { kind: 'event'; event: CalendarEvent }
  | { kind: 'slot'; taskId: string; entryId: string }
  | { kind: 'task'; taskId: string; note: string };

function WeekView({
  start,
  now,
  open,
  pickDay,
}: {
  start: Day;
  now: Date;
  open: (id: string) => void;
  pickDay: (d: Day) => void;
}) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const peek = usePopover<string>();
  const [reserve, setReserve] = useState<{ day: Day; start: number } | null>(null);
  const menu = useAgendaMenu({
    open,
    peek: (k, el) => peek.toggle(k, el),
    reserve: (day, start) => setReserve({ day, start }),
  });
  const today = dayOf(now);
  const refs = new Map<string, WeekRef>();
  const rows = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => {
    const list: { key: string; k: string; time: string; title: string; cls: string; ref: WeekRef }[] = [];
    for (const event of eventsOn(doc, day, true).filter((e) => e.allDay))
      list.push({
        key: event.id,
        k: '00:00',
        time: t('全天', 'All day'),
        title: event.title,
        cls: 'event',
        ref: { kind: 'event', event },
      });
    for (const x of agenda(doc, day, now)) {
      if (x.kind === 'event')
        list.push({
          key: x.event.id,
          k: x.event.start,
          time: x.event.start,
          title: x.event.title,
          cls: 'event',
          ref: { kind: 'event', event: x.event },
        });
      else if (x.kind === 'slot')
        list.push({
          key: x.entryId,
          k: timeOf(x.start),
          time: timeOf(x.start),
          title: x.step ? `${x.step} · ${x.task.title}` : x.task.title,
          cls: 'slot',
          ref: { kind: 'slot', taskId: x.task.id, entryId: x.entryId },
        });
      else if (x.kind === 'loose')
        list.push({
          key: x.entryId,
          k: x.part === 'am' ? '08:00' : x.part === 'pm' ? '12:00' : x.part === 'eve' ? '18:00' : '00:01',
          time: x.part ? partName(x.part, lang) : t('不定', 'Any'),
          title: x.step ? `${x.step} · ${x.task.title}` : x.task.title,
          cls: 'loose',
          ref: {
            kind: 'task',
            taskId: x.task.id,
            note: x.part ? partName(x.part, lang) : t('安排在这天', 'Planned for this day'),
          },
        });
      else
        list.push({
          key: `d${x.task.id}${x.step ?? ''}`,
          k: '23:59',
          time: t('截止', 'Due'),
          title: x.step ? `${x.step} · ${x.task.title}` : x.task.title,
          cls: 'due',
          ref: { kind: 'task', taskId: x.task.id, note: t('这天截止', 'Due this day') },
        });
    }
    list.sort((a, b) => a.k.localeCompare(b.k));
    for (const it of list) refs.set(it.key, it.ref);
    return { day, list };
  });
  return (
    <div className="week">
      {rows.map(({ day, list }) => (
        <div
          key={day}
          className={`wday${day === today ? ' is-today' : ''}`}
          onContextMenu={(ev) => menu.day(ev, day, () => pickDay(day))}
        >
          <button className="dname" onClick={() => pickDay(day)}>
            {weekdayName(day, lang)} {monthDay(day)}
          </button>
          <div className="witems">
            {list.length === 0 && <span className="wempty">{t('空', '—')}</span>}
            {list.map((it) => (
              <button
                key={it.key}
                className={`witem ${it.cls}`}
                aria-expanded={peek.is(it.key)}
                onClick={(ev) => peek.toggle(it.key, ev.currentTarget)}
                onContextMenu={(ev) => {
                  const r = it.ref;
                  const task = r.kind === 'event' ? undefined : doc.tasks[r.taskId];
                  if (r.kind === 'event') menu.event(ev, r.event, it.key);
                  else if (task && r.kind === 'slot') menu.slot(ev, task, r.entryId, `e:${it.key}`);
                  else if (task && r.kind === 'task') menu.task(ev, task, r.note);
                }}
              >
                <span className="t">{it.time}</span>
                <span className="n">{it.title}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {peek.open && (
        <Popover anchor={peek.open.el} onClose={peek.close} label={t('详情', 'Details')}>
          {(() => {
            // "e:" opens a reserved time at changing it (from its right-click menu).
            const key = peek.open.key.startsWith('e:') ? peek.open.key.slice(2) : peek.open.key;
            const v = refs.get(key);
            if (!v) return null;
            if (v.kind === 'event') return <EventPeek event={v.event} />;
            const task = doc.tasks[v.taskId];
            if (!task) return null;
            const entry = v.kind === 'slot' ? task.plan.find((x) => x.id === v.entryId) : undefined;
            return entry ? (
              <SlotPeek task={task} entry={entry} open={open} close={peek.close} editing={key !== peek.open.key} />
            ) : (
              <TaskPeek task={task} open={open} close={peek.close} />
            );
          })()}
        </Popover>
      )}
      {menu.element}
      {reserve && <ReserveSheet day={reserve.day} start={reserve.start} onClose={() => setReserve(null)} />}
    </div>
  );
}
