import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { addDays, dayOf, minutesOf, nowMinutes, timeOf, weekStart } from '../model/dates';
import {
  agenda,
  capacity,
  currentEvent,
  freeUntilNext,
  nowCandidates,
  stepProgress,
  type AgendaItem,
} from '../model/derive';
import { complete, remainingEffort } from '../model/doc';
import type { Day } from '../model/types';
import { store, useStore } from '../store/store';
import { toast } from './common';
import { dueLabel, duration, monthDay, partName, reasonText, relDay, ruleLabel, useT, weekdayName } from './text';

const ease = [0.2, 0.8, 0.2, 1] as const;

export function NowView({ now, open }: { now: Date; open: (id: string) => void }) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const [skip, setSkip] = useState(0);
  const today = dayOf(now);
  const event = currentEvent(doc, now);
  const all = nowCandidates(doc, now);
  const i = all.length ? skip % all.length : 0;
  const pick = all[i];
  const next = all.length > 1 ? all[(i + 1) % all.length] : undefined;
  const free = freeUntilNext(doc, now);
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
    const task = pick.task;
    const steps = stepProgress(task, now);
    const facts: string[] = [];
    if (task.due && pick.reason.kind !== 'overdue' && pick.reason.kind !== 'dueToday')
      facts.push(dueLabel(task.due, today, lang));
    if (task.effort)
      facts.push(
        `${t('用时', 'Effort')} ${duration(task.effort, lang)}${remainingEffort(task)! < task.effort ? ` · ${t('还剩', 'left')} ${duration(remainingEffort(task)!, lang)}` : ''}`,
      );
    if (steps.total) facts.push(`${t('步骤', 'Steps')} ${steps.done}/${steps.total}`);
    if (task.repeat) facts.push(`↻ ${ruleLabel(task.repeat.rule, lang)}`);
    const snippet = steps.next
      ? `${t('下一步：', 'Next step: ')}${steps.next.text}`
      : task.note
          ?.split('\n')
          .find((l) => l.trim())
          ?.replace(/[#>*_`[\]]/g, '')
          .trim();
    card = (
      <>
        <div className="focus-head">
          <span className="kicker">{t('现在做', 'Now')}</span>
          <span>
            {free !== null
              ? t(`接下来 ${duration(free, lang)}空闲`, `${duration(free, lang)} free`)
              : t('今天后面没有日程', 'Nothing else on the calendar today')}
          </span>
        </div>
        <h1>
          {task.star && (
            <span className="star" aria-label={t('重要', 'Important')}>
              ★{' '}
            </span>
          )}
          {task.title}
        </h1>
        <div className="why">{reasonText(pick.reason, lang)}</div>
        {facts.length > 0 && (
          <div className="facts">
            {facts.map((f) => (
              <span key={f} className="fact">
                {f}
              </span>
            ))}
          </div>
        )}
        {snippet && <div className="snippet">{snippet}</div>}
        <div className="focus-foot">
          <div className="actions">
            <button
              className="btn primary"
              onClick={() => {
                try {
                  store.commit((d, c) => complete(d, c, task.id));
                  toast(t(`完成了“${task.title}”`, `Done: “${task.title}”`), () => store.undo());
                } catch (e) {
                  toast(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              {task.repeat?.mode === 'reopen' ? t('完成本轮', 'Finish round') : t('完成', 'Done')}
            </button>
            {all.length > 1 && (
              <button className="btn" onClick={() => setSkip((s) => s + 1)}>
                {t('换一件', 'Another')}
              </button>
            )}
            <button className="btn" onClick={() => open(task.id)}>
              {t('打开', 'Open')}
            </button>
          </div>
          {next && (
            <span className="up-next">
              {t('下一件：', 'Next: ')}
              {next.task.title}
            </span>
          )}
        </div>
      </>
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

  return (
    <div className="stack">
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
  const { doc } = useStore();
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
          {t('日历还没接入：可以在设置里导入 .ics 文件。', 'No calendar yet: import an .ics file in Settings.')}
        </div>
      )}
    </section>
  );
}

function DayView({ day, now, open }: { day: Day; now: Date; open: (id: string) => void }) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const items = agenda(doc, day, now);
  const isToday = day === dayOf(now);
  const n = nowMinutes(now);
  const timed = items.filter(
    (x): x is Extract<AgendaItem, { kind: 'event' | 'slot' }> => x.kind === 'event' || x.kind === 'slot',
  );
  const spans = timed.map((x) =>
    x.kind === 'event' ? [minutesOf(x.event.start), minutesOf(x.event.end)] : [x.start, x.end],
  );
  // The working day, stretched to include now and anything scheduled outside it.
  const lo = Math.max(0, Math.floor(Math.min(9 * 60, isToday ? n : 9 * 60, ...spans.map((s) => s[0])) / 60) * 60);
  const hi = Math.min(24 * 60, Math.ceil(Math.max(18 * 60, isToday ? n + 30 : 0, ...spans.map((s) => s[1])) / 60) * 60);
  const PX = 22 / 60;
  const y = (m: number) => (m - lo) * PX;
  const loose = items.filter((x) => x.kind === 'loose' || x.kind === 'due');
  const order = { am: 1, pm: 2, eve: 3 } as const;
  loose.sort(
    (a, b) =>
      (a.kind === 'due' ? 0 : a.kind === 'loose' && a.part ? order[a.part] : 4) -
      (b.kind === 'due' ? 0 : b.kind === 'loose' && b.part ? order[b.part] : 4),
  );
  return (
    <>
      {loose.length > 0 && (
        <div className="loose">
          {loose.map((x) =>
            x.kind === 'due' ? (
              <button key={`d${x.task.id}`} className="pill" onClick={() => open(x.task.id)}>
                <span className="part late">{t('截止', 'Due')}</span>
                {x.task.title}
              </button>
            ) : x.kind === 'loose' ? (
              <button key={x.entryId} className="pill" onClick={() => open(x.task.id)}>
                {x.part && <span className="part">{partName(x.part, lang)}</span>}
                {x.task.title}
              </button>
            ) : null,
          )}
        </div>
      )}
      <div className="timeline" style={{ height: (hi - lo) * PX }}>
        {Array.from({ length: (hi - lo) / 60 }, (_, k) => lo + k * 60).map((m) => (
          <div key={m} className="hour" style={{ top: y(m) }}>
            {timeOf(m)}
          </div>
        ))}
        {timed.map((x) => {
          const [s, e] = x.kind === 'event' ? [minutesOf(x.event.start), minutesOf(x.event.end)] : [x.start, x.end];
          const style = { top: y(s) + 1, height: Math.max(16, y(e) - y(s) - 2) };
          return x.kind === 'event' ? (
            <div key={x.event.id} className="blk event" style={style}>
              <span>{x.event.title}</span>
              <span className="t">
                {x.event.start}–{x.event.end}
              </span>
            </div>
          ) : (
            <button key={x.entryId} className="blk slot" style={style} onClick={() => open(x.task.id)}>
              <span>{x.task.title}</span>
              <span className="t">
                {timeOf(s)}–{timeOf(e)}
              </span>
            </button>
          );
        })}
        {isToday && n >= lo && n <= hi && (
          <div className="nowline" style={{ top: y(n) }} aria-label={`${t('现在', 'Now')} ${timeOf(n)}`} />
        )}
      </div>
    </>
  );
}

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
  const today = dayOf(now);
  return (
    <div className="week">
      {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => {
        const items = agenda(doc, day, now)
          .map((x) => ({
            x,
            k:
              x.kind === 'event'
                ? x.event.start
                : x.kind === 'slot'
                  ? timeOf(x.start)
                  : x.kind === 'loose'
                    ? x.part === 'am'
                      ? '08:00'
                      : x.part === 'pm'
                        ? '12:00'
                        : x.part === 'eve'
                          ? '18:00'
                          : '00:00'
                    : '23:59',
          }))
          .sort((a, b) => a.k.localeCompare(b.k));
        return (
          <div key={day} className={`wday${day === today ? ' is-today' : ''}`}>
            <button className="dname" onClick={() => pickDay(day)}>
              {weekdayName(day, lang)} {monthDay(day)}
            </button>
            <div className="witems">
              {items.length === 0 && <span className="wempty">{t('空', '—')}</span>}
              {items.map(({ x }, k) =>
                x.kind === 'event' ? (
                  <div key={k} className="witem event">
                    <span className="t">{x.event.start}</span>
                    <span className="n">{x.event.title}</span>
                  </div>
                ) : (
                  <button key={k} className={`witem ${x.kind}`} onClick={() => open(x.task.id)}>
                    <span className="t">
                      {x.kind === 'slot'
                        ? timeOf(x.start)
                        : x.kind === 'due'
                          ? t('截止', 'Due')
                          : x.part
                            ? partName(x.part, lang)
                            : t('不定', 'Any')}
                    </span>
                    <span className="n">{x.task.title}</span>
                  </button>
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
