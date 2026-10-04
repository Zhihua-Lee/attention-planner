import { useMemo, useState } from 'react';
import { dayOf, isTime, minutesOf, timeOf } from '../model/dates';
import { eventsOn, nowCandidates } from '../model/derive';
import { addPlan, addTask, liveTasks, planOf, remainingEffort } from '../model/doc';
import type { Day } from '../model/types';
import { store, useStore } from '../store/store';
import { toast } from './common';
import { Sheet } from './Sheet';
import { duration, monthDay, useT, weekdayName } from './text';

const LENGTHS = [30, 60, 90, 120, 180];

/**
 * Reserve a time on the calendar: for a new task, or for one already in the list.
 * Start and length can be adjusted; overlaps with events or other reserved times are named, not blocked.
 */
export function ReserveSheet({ day, start, onClose }: { day: Day; start: number; onClose: () => void }) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [title, setTitle] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [time, setTime] = useState(timeOf(start));
  const [minutes, setMinutes] = useState(60);
  const now = new Date();
  const s = isTime(time) ? minutesOf(time) : start;
  const e = s + minutes;

  const clashes = useMemo(() => {
    const names: string[] = eventsOn(doc, day)
      .filter((ev) => minutesOf(ev.start) < e && s < minutesOf(ev.end))
      .map((ev) => ev.title);
    for (const task of liveTasks(doc))
      if (!task.done)
        for (const p of planOf(task))
          if (p.day === day && p.start && minutesOf(p.start) < e && s < minutesOf(p.start) + (p.minutes ?? 60))
            names.push(task.title);
    return names;
  }, [doc, day, s, e]);

  // Existing tasks in the order NOW would suggest them, filtered by what is typed.
  const choices = nowCandidates(doc, now)
    .map((c) => c.task)
    .filter((task) => task.title.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 6);

  const pickTask = (id: string) => {
    setTaskId(id);
    const left = remainingEffort(doc.tasks[id]);
    if (left) setMinutes(Math.min(180, Math.max(30, Math.round(left / 30) * 30)));
  };
  const ready = mode === 'new' ? !!title.trim() : !!taskId;
  const save = () => {
    if (!ready) return;
    const entry = { day, start: timeOf(s), minutes };
    const name = mode === 'new' ? title.trim() : doc.tasks[taskId!].title;
    store.commit((d, c) =>
      mode === 'new' ? addTask(d, c, { title: name, plan: [entry] })[0] : addPlan(d, c, taskId!, entry),
    );
    toast(t(`已预留 ${timeOf(s)}–${timeOf(e)}：${name}`, `Reserved ${timeOf(s)}–${timeOf(e)}: ${name}`), () =>
      store.undo(),
    );
    onClose();
  };

  return (
    <Sheet label={t('预留时段', 'Reserve time')} onClose={onClose}>
      <form
        className="reserve"
        onSubmit={(ev) => {
          ev.preventDefault();
          save();
        }}
      >
        <header className="reserve-head">
          <h2>{t('预留时段', 'Reserve time')}</h2>
          <span className="muted">
            {day === dayOf(now) ? t('今天', 'Today') : weekdayName(day, lang)} {monthDay(day)}
          </span>
        </header>
        <div className="reserve-row">
          <label className="reserve-time">
            <span>{t('开始', 'Starts')}</span>
            <input type="time" step={900} value={time} onChange={(ev) => setTime(ev.target.value)} />
          </label>
          <span className="muted">→ {timeOf(e % (24 * 60))}</span>
        </div>
        <div className="row-chips" role="group" aria-label={t('时长', 'Length')}>
          {LENGTHS.map((m) => (
            <button
              type="button"
              key={m}
              className={`opt${minutes === m ? ' sel' : ''}`}
              aria-pressed={minutes === m}
              onClick={() => setMinutes(m)}
            >
              {duration(m, lang)}
            </button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label={t('做什么', 'For')}>
          <button type="button" role="radio" aria-checked={mode === 'new'} onClick={() => setMode('new')}>
            {t('新任务', 'New task')}
          </button>
          <button type="button" role="radio" aria-checked={mode === 'existing'} onClick={() => setMode('existing')}>
            {t('已有任务', 'Existing task')}
          </button>
        </div>
        {mode === 'new' ? (
          <input
            data-autofocus
            className="reserve-title"
            value={title}
            onChange={(ev) => setTitle(ev.target.value)}
            placeholder={t('这段时间做什么？', 'What will you do then?')}
            aria-label={t('这段时间做什么？', 'What will you do then?')}
            enterKeyHint="done"
          />
        ) : (
          <div className="reserve-pick">
            <input
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
              placeholder={t('搜索任务', 'Search tasks')}
              aria-label={t('搜索任务', 'Search tasks')}
            />
            <div className="pick-list" role="listbox" aria-label={t('选择任务', 'Choose a task')}>
              {choices.map((task) => (
                <button
                  type="button"
                  key={task.id}
                  role="option"
                  aria-selected={taskId === task.id}
                  className={`pick${taskId === task.id ? ' on' : ''}`}
                  onClick={() => pickTask(task.id)}
                >
                  <span>{task.title}</span>
                  {remainingEffort(task) ? (
                    <span className="muted">{duration(remainingEffort(task)!, lang)}</span>
                  ) : null}
                </button>
              ))}
              {choices.length === 0 && <span className="muted">{t('没有匹配的任务。', 'No matching task.')}</span>}
            </div>
          </div>
        )}
        {clashes.length > 0 && (
          <p className="clash" role="note">
            {t(
              `和“${clashes.join('”“')}”重叠，仍可以预留。`,
              `Overlaps “${clashes.join('”, “')}”; you can still reserve it.`,
            )}
          </p>
        )}
        <div className="reserve-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('取消', 'Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!ready}>
            {t('预留', 'Reserve')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
