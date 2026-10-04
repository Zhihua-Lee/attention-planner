import { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { addDays, dayOf, isoWeekday, minutesOf, nowMinutes, timeOf } from '../model/dates';
import { eventsOn } from '../model/derive';
import { liveTasks, planOf } from '../model/doc';
import type { Day, Doc, Frequency, Part, PlanEntry, Repeat, RepeatRule, Task } from '../model/types';
import { duration, monthDay, relDay, weekdayName, weekdayShort, useT } from './text';

export type When = Pick<PlanEntry, 'part' | 'start' | 'minutes'>;

/** Today, tomorrow, the day after, next Monday, or any date. */
export function DayOptions({ today, onPick, title }: { today: Day; onPick: (d: Day) => void; title: string }) {
  const { t, lang } = useT();
  const nextMonday = addDays(today, 8 - isoWeekday(today));
  const days = [today, addDays(today, 1), addDays(today, 2), nextMonday];
  return (
    <div className="menu">
      <div className="menu-title">{title}</div>
      {days.map((d, i) => (
        <button key={d} className="menu-item" onClick={() => onPick(d)}>
          <span>{i === 3 ? t('下周一', 'Next Monday') : relDay(d, today, lang)}</span>
          <span className="sub">
            {monthDay(d)} {weekdayName(d, lang)}
          </span>
        </button>
      ))}
      <label className="menu-item">
        <span>{t('选日期', 'Pick a date')}</span>
        <input
          type="date"
          aria-label={t('选日期', 'Pick a date')}
          onChange={(e) => e.target.value && onPick(e.target.value)}
        />
      </label>
    </div>
  );
}

/**
 * When on a given day: no set time, a part of the day, or a start time from a half-hour grid
 * (times that overlap an event or another reserved time are greyed), then how long.
 */
export function WhenPicker({
  doc,
  day,
  today,
  current,
  effortLeft,
  excludeEntry,
  onPick,
  onDelete,
  worked,
  onWorked,
}: {
  doc: Doc;
  day: Day;
  today: Day;
  current?: When;
  effortLeft?: number;
  excludeEntry?: string;
  onPick: (w: When) => void;
  onDelete?: () => void;
  /** Minutes already worked in this reserved time, when editing one. */
  worked?: number;
  onWorked?: (minutes: number | undefined) => void;
}) {
  const { t, lang } = useT();
  const [start, setStart] = useState<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const busy = useMemo(() => {
    const spans: { s: number; e: number; title: string }[] = eventsOn(doc, day).map((e) => ({
      s: minutesOf(e.start),
      e: minutesOf(e.end),
      title: e.title,
    }));
    for (const task of liveTasks(doc))
      for (const p of planOf(task))
        if (p.day === day && p.start && p.id !== excludeEntry)
          spans.push({ s: minutesOf(p.start), e: minutesOf(p.start) + (p.minutes ?? 60), title: task.title });
    return spans;
  }, [doc, day, excludeEntry]);
  const times: number[] = [];
  for (let m = 6 * 60; m <= 23 * 60; m += 30) times.push(m);
  const first = day === today ? Math.ceil((nowMinutes(new Date()) + 1) / 30) * 30 : 9 * 60;
  useLayoutEffect(() => {
    const g = grid.current;
    if (!g) return;
    const target = g.querySelector<HTMLElement>(
      `[data-t="${current?.start ? minutesOf(current.start) : Math.min(Math.max(first, 6 * 60), 23 * 60)}"]`,
    );
    if (target) g.scrollTop = target.offsetTop - g.offsetTop - 4;
  }, [current?.start, first, start]);

  if (start !== null) {
    const def = Math.min(120, Math.max(30, Math.round((effortLeft ?? 60) / 30) * 30));
    const chosen = current?.start === timeOf(start) ? (current.minutes ?? def) : def;
    return (
      <div className="tpick">
        <div className="cap">
          {relDay(day, today, lang)} {timeOf(start)} {t('开始 · 多久', 'start · how long')}
        </div>
        <div className="row4">
          {[30, 60, 90, 120, 180, 240].map((m) => (
            <button
              key={m}
              className={`opt${m === chosen ? ' sel' : ''}`}
              onClick={() => onPick({ start: timeOf(start), minutes: m })}
            >
              {duration(m, lang)}
            </button>
          ))}
        </div>
        <button className="link-btn" onClick={() => setStart(null)}>
          ‹ {t('换个时间', 'Another time')}
        </button>
      </div>
    );
  }
  const parts: [Part | '', string][] = [
    ['', t('不定', 'Any time')],
    ['am', t('上午', 'Morning')],
    ['pm', t('下午', 'Afternoon')],
    ['eve', t('晚上', 'Evening')],
  ];
  return (
    <div className="tpick">
      <div className="cap">
        {relDay(day, today, lang)} {weekdayName(day, lang)} · {t('什么时候', 'when')}
      </div>
      <div className="row4">
        {parts.map(([k, n]) => (
          <button
            key={k}
            className={`opt${current && !current.start && (current.part ?? '') === k ? ' sel' : ''}`}
            onClick={() => onPick(k ? { part: k } : {})}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="cap">
        <span>{t('具体时间', 'At a time')}</span>
        <span>{t('灰色 = 已有安排', 'grey = taken')}</span>
      </div>
      <div className="tgrid" ref={grid}>
        {times.map((m) => {
          const hit = busy.find((b) => b.s < m + 30 && m < b.e);
          return (
            <button
              key={m}
              data-t={m}
              className={`opt${hit ? ' busy' : ''}${current?.start === timeOf(m) ? ' sel' : ''}`}
              title={hit?.title}
              onClick={() => setStart(m)}
            >
              {timeOf(m)}
            </button>
          );
        })}
      </div>
      {onWorked && current?.start && (
        <label className="menu-row worked">
          <span>{t('这次已做', 'Worked')}</span>
          <input
            type="number"
            min={0}
            max={1440}
            step={5}
            defaultValue={worked}
            aria-label={t('这次已做（分钟）', 'Minutes worked')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onWorked(Number((e.target as HTMLInputElement).value) || undefined);
              }
            }}
            onBlur={(e) =>
              Number(e.target.value || 0) !== (worked ?? 0) && onWorked(Number(e.target.value) || undefined)
            }
          />
          <span>{t('分钟', 'min')}</span>
        </label>
      )}
      {onDelete && (
        <button className="link-btn danger" onClick={onDelete}>
          {t('删除这次安排', 'Remove this arrangement')}
        </button>
      )}
    </div>
  );
}

/** Two short steps: which day, then when on that day. */
export function PlanPicker({
  doc,
  today,
  effortLeft,
  onPick,
}: {
  doc: Doc;
  today: Day;
  effortLeft?: number;
  onPick: (p: Pick<PlanEntry, 'day' | 'part' | 'start' | 'minutes'>) => void;
}) {
  const { t } = useT();
  const [day, setDay] = useState<Day | null>(null);
  if (!day) return <DayOptions today={today} title={t('哪天做', 'Which day')} onPick={setDay} />;
  return <WhenPicker doc={doc} day={day} today={today} effortLeft={effortLeft} onPick={(w) => onPick({ day, ...w })} />;
}

export function EffortPicker({ value, onPick }: { value?: number; onPick: (m: number | undefined) => void }) {
  const { t, lang } = useT();
  return (
    <div className="menu">
      <div className="menu-title">{t('用时', 'Effort')}</div>
      <div className="row4 pad">
        {[15, 30, 60, 90, 120, 180, 240, 360].map((m) => (
          <button key={m} className={`opt${value === m ? ' sel' : ''}`} onClick={() => onPick(m)}>
            {duration(m, lang)}
          </button>
        ))}
      </div>
      <label className="menu-item">
        <span>{t('其他（分钟）', 'Other (minutes)')}</span>
        <input
          type="number"
          min={1}
          max={6000}
          defaultValue={value}
          aria-label={t('用时（分钟）', 'Effort (minutes)')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onPick(Number((e.target as HTMLInputElement).value) || undefined);
          }}
        />
      </label>
      {value !== undefined && (
        <button className="link-btn danger" onClick={() => onPick(undefined)}>
          {t('清除', 'Clear')}
        </button>
      )}
    </div>
  );
}

/** Choose an area or project, or create one by typing its name. */
export function GroupPicker({
  doc,
  value,
  onPick,
  onCreate,
}: {
  doc: Doc;
  value: { areaId?: string; projectId?: string };
  onPick: (v: { areaId?: string; projectId?: string }) => void;
  onCreate: (kind: 'area' | 'project', name: string) => void;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const areas = Object.values(doc.areas)
    .filter((a) => !a.deleted)
    .sort((a, b) => a.order - b.order);
  const projects = Object.values(doc.projects)
    .filter((p) => !p.deleted && !p.done)
    .sort((a, b) => a.order - b.order);
  return (
    <div className="menu">
      <div className="menu-title">{t('归属', 'Belongs to')}</div>
      {areas.map((a) => (
        <div key={a.id}>
          <button
            className={`menu-item${value.areaId === a.id && !value.projectId ? ' on' : ''}`}
            onClick={() => onPick({ areaId: a.id })}
          >
            {a.name}
          </button>
          {projects
            .filter((p) => p.areaId === a.id)
            .map((p) => (
              <button
                key={p.id}
                className={`menu-item indent${value.projectId === p.id ? ' on' : ''}`}
                onClick={() => onPick({ projectId: p.id })}
              >
                {p.name}
              </button>
            ))}
        </div>
      ))}
      {projects
        .filter((p) => !p.areaId || !doc.areas[p.areaId] || doc.areas[p.areaId].deleted)
        .map((p) => (
          <button
            key={p.id}
            className={`menu-item${value.projectId === p.id ? ' on' : ''}`}
            onClick={() => onPick({ projectId: p.id })}
          >
            {p.name}
          </button>
        ))}
      <div className="menu-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('新的区域或项目', 'New area or project')}
          aria-label={t('新的区域或项目', 'New area or project')}
        />
        <button className="opt" disabled={!name.trim()} onClick={() => onCreate('area', name)}>
          {t('区域', 'Area')}
        </button>
        <button className="opt" disabled={!name.trim()} onClick={() => onCreate('project', name)}>
          {t('项目', 'Project')}
        </button>
      </div>
      {(value.areaId || value.projectId) && (
        <button className="link-btn danger" onClick={() => onPick({})}>
          {t('不归属', 'None')}
        </button>
      )}
    </div>
  );
}

/** Point this task at another one. */
export function LinkPicker({
  doc,
  self,
  value,
  onPick,
}: {
  doc: Doc;
  self: string;
  value?: string;
  onPick: (id: string | undefined) => void;
}) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const hits = liveTasks(doc)
    .filter(
      (x) => x.id !== self && !x.done && x.linkTo !== self && x.title.toLowerCase().includes(q.trim().toLowerCase()),
    )
    .slice(0, 8);
  return (
    <div className="menu">
      <div className="menu-title">{t('关联到', 'Link to')}</div>
      <div className="menu-row">
        <input
          data-autofocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('搜索任务', 'Search tasks')}
          aria-label={t('搜索任务', 'Search tasks')}
        />
      </div>
      {hits.map((x) => (
        <button key={x.id} className={`menu-item${value === x.id ? ' on' : ''}`} onClick={() => onPick(x.id)}>
          {x.title}
        </button>
      ))}
      {value && (
        <button className="link-btn danger" onClick={() => onPick(undefined)}>
          {t('取消关联', 'Unlink')}
        </button>
      )}
    </div>
  );
}

const freqs: Frequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

/** The step-by-step repeat form: mode, frequency, every, from completion, days, when to stop, more. */
export function RepeatEditor({
  task,
  today,
  onChange,
}: {
  task: Task;
  today: Day;
  onChange: (r: Repeat | undefined) => void;
}) {
  const { t, lang } = useT();
  const r = task.repeat;
  const rule: RepeatRule | undefined = r?.rule;
  const set = (patch: Partial<RepeatRule>) => r && onChange({ ...r, rule: { ...r.rule, ...patch } });
  const fresh = (): RepeatRule =>
    rule ?? { freq: 'daily', every: 1, fromDone: false, start: task.due ?? planOf(task)[0]?.day ?? today };
  const ends = rule?.until ? 'until' : rule?.count && r?.mode === 'copy' ? 'count' : 'never';
  const unit =
    rule &&
    {
      hourly: t('小时', 'hours'),
      daily: t('天', 'days'),
      weekly: t('周', 'weeks'),
      monthly: t('个月', 'months'),
      yearly: t('年', 'years'),
    }[rule.freq];
  return (
    <div className="repeat-editor">
      <div className="seg" role="radiogroup" aria-label={t('重复', 'Repeat')}>
        {(
          [
            ['none', t('不重复', 'None')],
            ['reopen', t('原地重开', 'Reopen')],
            ['copy', t('新建一份', 'New copy')],
          ] as const
        ).map(([k, n]) => (
          <button
            key={k}
            role="radio"
            aria-checked={(r?.mode ?? 'none') === k}
            onClick={() =>
              onChange(
                k === 'none'
                  ? undefined
                  : {
                      mode: k,
                      rule: k === 'copy' && fresh().freq === 'hourly' ? { ...fresh(), freq: 'daily' } : fresh(),
                    },
              )
            }
          >
            {n}
          </button>
        ))}
      </div>
      <p className="hint">
        {r?.mode === 'reopen'
          ? t(
              '同一个任务每轮重新打开，步骤清空，往期记入历史。',
              'The same task opens again each round; steps clear; past rounds are kept.',
            )
          : r?.mode === 'copy'
            ? t('完成后这一个归档，并新建下一次。', 'Completing it files this one and creates the next.')
            : ''}
      </p>
      {rule && (
        <div className="form">
          <label>
            {t('频率', 'Frequency')}
            <select
              value={rule.freq}
              onChange={(e) => {
                const freq = e.target.value as Frequency;
                set({
                  freq,
                  ...(freq === 'weekly' && !rule.weekdays?.length ? { weekdays: [isoWeekday(rule.start)] } : {}),
                });
              }}
            >
              {(rule.fromDone && r!.mode === 'reopen' ? (['hourly', ...freqs] as Frequency[]) : freqs).map((f) => (
                <option key={f} value={f}>
                  {
                    {
                      hourly: t('按小时', 'Hourly'),
                      daily: t('按天', 'Daily'),
                      weekly: t('按周', 'Weekly'),
                      monthly: t('按月', 'Monthly'),
                      yearly: t('按年', 'Yearly'),
                    }[f]
                  }
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('每隔', 'Every')}
            <span className="inline">
              <input
                type="number"
                min={1}
                max={999}
                value={rule.every}
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  if (n >= 1 && n <= 999) set({ every: Math.round(n) });
                }}
              />
              {unit}
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={rule.fromDone}
              onChange={(e) =>
                set({
                  fromDone: e.target.checked,
                  freq: !e.target.checked && rule.freq === 'hourly' ? 'daily' : rule.freq,
                })
              }
            />
            {t('从完成后计时', 'Count from completion')}
          </label>
          {!rule.fromDone && rule.freq === 'weekly' && (
            <div className="weekdays" role="group" aria-label={t('星期', 'Days')}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                const on = (rule.weekdays ?? [isoWeekday(rule.start)]).includes(d);
                return (
                  <button
                    key={d}
                    aria-pressed={on}
                    onClick={() => {
                      const cur = rule.weekdays ?? [isoWeekday(rule.start)];
                      const next = on ? cur.filter((x) => x !== d) : [...cur, d].sort();
                      if (next.length) set({ weekdays: next });
                    }}
                  >
                    {weekdayShort(d, lang)}
                  </button>
                );
              })}
            </div>
          )}
          {!rule.fromDone && rule.freq === 'monthly' && (
            <label>
              {t('每月哪天', 'Day of month')}
              <select
                value={rule.monthDay ?? ''}
                onChange={(e) => set({ monthDay: e.target.value ? Number(e.target.value) : undefined })}
              >
                <option value="">{t('与开始同一天', 'Same as the start')}</option>
                <option value={-1}>{t('最后一天', 'Last day')}</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {t('何时停止', 'Ends')}
            <span className="inline">
              <select
                value={ends}
                onChange={(e) => {
                  const m = e.target.value;
                  set(
                    m === 'until'
                      ? { until: rule.until ?? addDays(today, 30), count: undefined }
                      : m === 'count'
                        ? { until: undefined, count: rule.count ?? 10 }
                        : { until: undefined, count: undefined },
                  );
                }}
              >
                <option value="never">{t('不设结束', 'Never')}</option>
                <option value="until">{t('到指定日期', 'On a date')}</option>
                {r!.mode === 'copy' && <option value="count">{t('达到指定次数', 'After a number of times')}</option>}
              </select>
              {ends === 'until' && (
                <input
                  type="date"
                  aria-label={t('结束日期', 'End date')}
                  value={rule.until}
                  onChange={(e) => e.target.value && set({ until: e.target.value })}
                />
              )}
              {ends === 'count' && (
                <input
                  type="number"
                  min={1}
                  max={999}
                  aria-label={t('总次数', 'Total times')}
                  value={rule.count}
                  onChange={(e) => {
                    const n = e.target.valueAsNumber;
                    if (n >= 1) set({ count: Math.round(n) });
                  }}
                />
              )}
            </span>
          </label>
          <details className="more">
            <summary>{t('更多', 'More')}</summary>
            <label>
              {t('开始日期', 'Starts')}
              <input
                type="date"
                value={rule.start}
                onChange={(e) => e.target.value && set({ start: e.target.value })}
              />
            </label>
            {r!.mode === 'reopen' && (
              <>
                <label>
                  {t('刷新时刻', 'Opens at')}
                  <input
                    type="time"
                    value={rule.time ?? '00:00'}
                    onChange={(e) =>
                      e.target.value && set({ time: e.target.value === '00:00' ? undefined : e.target.value })
                    }
                  />
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={!!r!.paused}
                    onChange={(e) => onChange({ ...r!, paused: e.target.checked || undefined })}
                  />
                  {t('暂停', 'Paused')}
                </label>
              </>
            )}
          </details>
        </div>
      )}
    </div>
  );
}

export const todayOf = (now: Date) => dayOf(now);
