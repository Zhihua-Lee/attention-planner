import { dayOf, PARTS } from '../model/dates';
import { historyOf, type LogEntry } from '../model/history';
import type { Day, Part, Task } from '../model/types';
import { duration, monthDay, partName, planWhen, useT, weekdayName, type Lang, type T } from './text';

/** What one entry says, in a few words. */
function entryText(x: LogEntry, t: T, lang: Lang): string {
  const step = x.step ? `「${x.step.text}」` : '';
  // Days as dates: "tomorrow" read a week later would mislead.
  const at = (p: LogEntry) => [monthDay(p.day!), planWhen(p, lang)].filter(Boolean).join(' ');
  switch (x.kind) {
    case 'done':
      return t('完成', 'Done');
    case 'reopen':
      return t('重新打开', 'Reopened');
    case 'check':
      return t(`勾选${step}`, `Checked ${step}`);
    case 'uncheck':
      return t(`取消勾选${step}`, `Unchecked ${step}`);
    case 'due':
      return x.day
        ? t(
            `截止改为 ${monthDay(x.day)}${x.time ? ` ${x.time}` : ''}`,
            `Due ${monthDay(x.day)}${x.time ? ` ${x.time}` : ''}`,
          )
        : t('去掉截止', 'Deadline removed');
    case 'plan':
      return t(`安排到 ${at(x)}`, `Planned for ${at(x)}`);
    case 'move':
      return t(`改到 ${at(x)}`, `Moved to ${at(x)}`);
    case 'unplan':
      return t(`取消安排 ${at(x)}`, `Unplanned ${at(x)}`);
    case 'worked':
      return x.minutes! > 0
        ? t(`记下做了 ${duration(x.minutes!, lang)}`, `Logged ${duration(x.minutes!, lang)} of work`)
        : t(`减去 ${duration(-x.minutes!, lang)}`, `Took off ${duration(-x.minutes!, lang)}`);
    case 'snooze':
      return [
        x.until ? t(`暂缓到 ${monthDay(x.until)}`, `Snoozed until ${monthDay(x.until)}`) : t('暂缓', 'Snoozed'),
        x.reason,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'unsnooze':
      return t('取消暂缓', 'Unsnoozed');
  }
}

/** The context an entry carries: what was planned for that day, the deadline then, and the AI that proposed it. */
function contextText(x: LogEntry, t: T, lang: Lang): string {
  const planned = x.planned
    ? x.planned === 'day'
      ? t('原定当天', 'planned that day')
      : x.planned in PARTS
        ? t(
            `原定${partName(x.planned as Part, lang)}`,
            `planned for the ${partName(x.planned as Part, lang).toLowerCase()}`,
          )
        : t(`原定 ${x.planned}`, `planned at ${x.planned}`)
    : '';
  return [
    planned,
    x.dueThen && t(`截止 ${monthDay(x.dueThen)}`, `due ${monthDay(x.dueThen)}`),
    x.ai && t(`${x.ai} 提议`, `proposed by ${x.ai}`),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A task's history, newest first and grouped by day; folded until opened. */
export function History({ task }: { task: Task }) {
  const { t, lang } = useT();
  const entries = historyOf(task);
  if (!entries.length) return null;
  const days: [Day, LogEntry[]][] = [];
  for (const x of entries) {
    const day = dayOf(new Date(x.at));
    const last = days.at(-1);
    if (last?.[0] === day) last[1].push(x);
    else days.push([day, [x]]);
  }
  return (
    <details className="history" data-testid="history">
      <summary>
        {t('历史', 'History')} · {entries.length}
      </summary>
      {days.map(([day, xs]) => (
        <div key={day} className="history-day">
          <div className="history-date">
            {monthDay(day)} {weekdayName(day, lang)}
          </div>
          {xs.map((x) => {
            const context = contextText(x, t, lang);
            return (
              <div key={x.id} className="history-entry">
                <span className="history-time">{new Date(x.at).toTimeString().slice(0, 5)}</span>
                <span>
                  {entryText(x, t, lang)}
                  {context && <span className="muted"> · {context}</span>}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </details>
  );
}
