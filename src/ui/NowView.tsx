import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { addDays, dayOf, weekStart } from '../model/dates';
import { capacity, currentEvent, freeUntilNext, nowCandidates, stepProgress } from '../model/derive';
import { complete, remainingEffort } from '../model/doc';
import type { Day } from '../model/types';
import { store, useStore } from '../store/store';
import { CalendarGrid } from './CalendarGrid';
import { toast } from './common';
import { dueLabel, duration, monthDay, reasonText, relDay, ruleLabel, useT, weekdayName } from './text';

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
    <div className="now-layout">
      <div className="now-side">
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
      </div>
      <Agenda now={now} open={open} />
    </div>
  );
}

type Range = 'day' | '3day' | 'week';
const STEP: Record<Range, number> = { day: 1, '3day': 3, week: 7 };

function Agenda({ now, open }: { now: Date; open: (id: string) => void }) {
  const { doc, sync } = useStore();
  const { t, lang } = useT();
  const today = dayOf(now);
  const [range, setRangeState] = useState<Range>(() => {
    try {
      const r = localStorage.getItem('ap:range');
      return r === 'day' || r === '3day' || r === 'week' ? r : window.innerWidth >= 1000 ? 'week' : 'day';
    } catch {
      return 'day';
    }
  });
  const setRange = (r: Range) => {
    setRangeState(r);
    try {
      localStorage.setItem('ap:range', r);
    } catch {
      /* only a convenience */
    }
  };
  const [cursor, setCursor] = useState<Day>(today);
  const first = range === 'week' ? weekStart(cursor) : cursor;
  const days = Array.from({ length: STEP[range] }, (_, i) => addDays(first, i));
  const atToday = range === 'week' ? first === weekStart(today) : cursor === today;
  const label =
    range === 'day'
      ? `${monthDay(cursor)} ${weekdayName(cursor, lang)}${cursor === today ? ` · ${t('今天', 'today')}` : ''}`
      : `${monthDay(days[0])} – ${monthDay(days.at(-1)!)}`;
  const prev = {
    day: t('前一天', 'Previous day'),
    '3day': t('前三天', 'Previous 3 days'),
    week: t('上一周', 'Previous week'),
  }[range];
  const next = { day: t('后一天', 'Next day'), '3day': t('后三天', 'Next 3 days'), week: t('下一周', 'Next week') }[
    range
  ];
  const noEvents = !doc.events?.length;
  return (
    <section className="agenda" aria-label={t('日程', 'Agenda')}>
      <div className="agenda-head">
        <div className="nav">
          <button className="today-btn" disabled={atToday} onClick={() => setCursor(today)}>
            {t('今天', 'Today')}
          </button>
          <button className="arrow" aria-label={prev} onClick={() => setCursor(addDays(cursor, -STEP[range]))}>
            ‹
          </button>
          <button className="arrow" aria-label={next} onClick={() => setCursor(addDays(cursor, STEP[range]))}>
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
          <button aria-pressed={range === '3day'} onClick={() => setRange('3day')}>
            {t('三日', '3 days')}
          </button>
          <button aria-pressed={range === 'week'} onClick={() => setRange('week')}>
            {t('周', 'Week')}
          </button>
        </div>
      </div>
      <CalendarGrid days={days} now={now} open={open} />
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
