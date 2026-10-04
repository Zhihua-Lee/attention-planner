import { useLayoutEffect, useRef, useState } from 'react';
import { dayOf, minutesOf, nowMinutes, timeOf } from '../model/dates';
import { eventsOn, openTasks } from '../model/derive';
import { addTask, isSnoozed, planOf } from '../model/doc';
import type { Day, Doc, Part } from '../model/types';
import { store, useStore } from '../store/store';
import { Popover, toast } from './common';
import { layoutBlocks, type Block } from '../model/layout';
import { monthDay, partName, useT, weekdayName } from './text';

const HOUR = 44; // px per hour
const MIN = HOUR / 60;

function dayBlocks(doc: Doc, day: Day, now: Date): Block[] {
  const blocks: Block[] = eventsOn(doc, day).map((e) => ({
    key: e.id,
    kind: 'event',
    title: e.title,
    s: minutesOf(e.start),
    e: Math.max(minutesOf(e.end), minutesOf(e.start) + 15),
    sub: e.location,
  }));
  for (const t of openTasks(doc, now))
    for (const p of planOf(t))
      if (p.day === day && p.start) {
        const s = minutesOf(p.start);
        blocks.push({ key: p.id, kind: 'slot', title: t.title, s, e: s + (p.minutes ?? 60), taskId: t.id });
      }
  return blocks;
}

type Chip = { key: string; kind: 'allday' | 'due' | 'loose'; title: string; part?: Part; taskId?: string };
function dayChips(doc: Doc, day: Day, now: Date): Chip[] {
  const today = dayOf(now);
  const chips: Chip[] = eventsOn(doc, day, true)
    .filter((e) => e.allDay)
    .map((e) => ({ key: e.id, kind: 'allday', title: e.title }));
  for (const t of openTasks(doc, now)) {
    if (t.due === day) chips.push({ key: `d${t.id}`, kind: 'due', title: t.title, taskId: t.id });
    if (!isSnoozed(t, today))
      for (const p of planOf(t))
        if (p.day === day && !p.start)
          chips.push({ key: p.id, kind: 'loose', title: t.title, part: p.part, taskId: t.id });
  }
  const rank = { allday: 0, due: 1, loose: 2 } as const;
  const part = (c: Chip) => (c.part === 'am' ? 1 : c.part === 'pm' ? 2 : c.part === 'eve' ? 3 : 0);
  return chips.sort((a, b) => rank[a.kind] - rank[b.kind] || part(a) - part(b));
}

/**
 * A time grid for one or more days: dates on top, an all-day strip (all-day events, deadlines,
 * tasks without a set time), and the hours below with events and reserved times side by side.
 * Clicking an empty spot reserves that half hour for a new task.
 */
export function CalendarGrid({ days, now, open }: { days: Day[]; now: Date; open: (id: string) => void }) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const today = dayOf(now);
  const n = nowMinutes(now);
  const scroller = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<{ day: Day; start: number } | null>(null);
  const [title, setTitle] = useState('');
  const columns = days.map((day) => ({
    day,
    blocks: layoutBlocks(dayBlocks(doc, day, now)),
    chips: dayChips(doc, day, now),
  }));
  const hasChips = columns.some((c) => c.chips.length);

  // Open at the current time when today is shown, otherwise at the first thing scheduled (or 08:00).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const firsts = columns.flatMap((c) => c.blocks.map((b) => b.s));
    // Land on a full hour so the block that is under way shows its title.
    const target = Math.floor((days.includes(today) ? n - 30 : Math.min(8 * 60, ...firsts)) / 60) * 60;
    el.scrollTop = Math.max(0, target * MIN - 10); // a little above, so the hour label is not under the header
  }, [days.join()]);

  const reserve = () => {
    if (!draft || !title.trim()) return;
    store.commit(
      (d, c) =>
        addTask(d, c, { title: title.trim(), plan: [{ day: draft.day, start: timeOf(draft.start), minutes: 60 }] })[0],
    );
    toast(t(`已预留 ${timeOf(draft.start)}：${title.trim()}`, `Reserved ${timeOf(draft.start)}: ${title.trim()}`), () =>
      store.undo(),
    );
    setDraft(null);
    setTitle('');
  };

  // A week keeps readable columns and scrolls sideways on a phone; a day or three days always fit.
  const grid = { gridTemplateColumns: `3rem repeat(${days.length}, minmax(${days.length > 3 ? '96px' : '0'}, 1fr))` };
  return (
    <div className="cal" ref={scroller} data-days={days.length}>
      <div
        className="cal-inner"
        style={{ minWidth: days.length > 3 ? `calc(3rem + ${days.length * 96}px)` : undefined }}
      >
        <div className="cal-top">
          <div className="cal-head" style={grid}>
            <span className="cal-corner" />
            {days.map((day) => (
              <div key={day} className={`cal-date${day === today ? ' is-today' : ''}`}>
                <span className="wd">{weekdayName(day, lang)}</span>
                <span className="num">{+day.slice(8, 10)}</span>
              </div>
            ))}
          </div>
          {hasChips && (
            <div className="cal-strip" style={grid}>
              <span className="cal-corner small">{t('全天', 'All day')}</span>
              {columns.map(({ day, chips }) => (
                <div key={day} className="strip-col">
                  {chips.map((c) =>
                    c.taskId ? (
                      <button
                        key={c.key}
                        className={`strip-chip ${c.kind}`}
                        onClick={() => open(c.taskId!)}
                        title={c.title}
                      >
                        {c.kind === 'due' ? <b>{t('截止', 'Due')}</b> : c.part ? <b>{partName(c.part, lang)}</b> : null}
                        {c.title}
                      </button>
                    ) : (
                      <span key={c.key} className="strip-chip allday" title={c.title}>
                        {c.title}
                      </span>
                    ),
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cal-body" style={{ ...grid, height: 24 * HOUR }}>
          <div className="cal-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * HOUR }}>
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>
          {columns.map(({ day, blocks }) => (
            <div
              key={day}
              className="cal-col"
              data-day={day}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const y = e.nativeEvent.offsetY;
                setDraft({ day, start: Math.min(23 * 60 + 30, Math.floor(y / MIN / 30) * 30) });
                setTitle('');
              }}
            >
              {blocks.map((b) => {
                const style = {
                  top: b.s * MIN + 1,
                  height: Math.max(20, (b.e - b.s) * MIN - 2),
                  left: `calc(${(b.lane / b.lanes) * 100}% + 2px)`,
                  width: `calc(${100 / b.lanes}% - 4px)`,
                };
                const body = (
                  <>
                    <span className="bt">{b.title}</span>
                    <span className="bs">
                      {timeOf(b.s)}–{timeOf(Math.min(b.e, 24 * 60 - 1))}
                      {b.sub ? ` · ${b.sub}` : ''}
                    </span>
                  </>
                );
                return b.kind === 'slot' ? (
                  <button
                    key={b.key}
                    className={`blk slot${(b.e - b.s) * MIN < 34 ? ' short' : ''}`}
                    style={style}
                    onClick={() => open(b.taskId!)}
                    title={b.title}
                  >
                    {body}
                  </button>
                ) : (
                  <div
                    key={b.key}
                    className={`blk event${(b.e - b.s) * MIN < 34 ? ' short' : ''}`}
                    style={style}
                    title={b.sub ? `${b.title} · ${b.sub}` : b.title}
                  >
                    {body}
                  </div>
                );
              })}
              {day === today && (
                <div className="nowline" style={{ top: n * MIN }} aria-label={`${t('现在', 'Now')} ${timeOf(n)}`} />
              )}
              {draft?.day === day && (
                <div ref={setGhost} className="blk ghost" style={{ top: draft.start * MIN + 1, height: HOUR - 2 }}>
                  {timeOf(draft.start)}–{timeOf(draft.start + 60)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {draft && ghost && (
        <Popover anchor={ghost} onClose={() => setDraft(null)} label={t('预留时段', 'Reserve time')}>
          <div className="menu">
            <div className="menu-title">
              {monthDay(draft.day)} {weekdayName(draft.day, lang)} {timeOf(draft.start)}–{timeOf(draft.start + 60)}
            </div>
            <div className="menu-row">
              <input
                data-autofocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('这段时间做什么？', 'What will you do then?')}
                aria-label={t('这段时间做什么？', 'What will you do then?')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) reserve();
                }}
              />
              <button className="opt" disabled={!title.trim()} onClick={reserve}>
                {t('预留', 'Reserve')}
              </button>
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}
