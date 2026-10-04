import { useState } from 'react';
import { dayOf, minutesOf, timeOf } from '../model/dates';
import { stepProgress } from '../model/derive';
import { complete, remainingEffort, removePlan, updatePlan } from '../model/doc';
import type { CalendarEvent, PlanEntry, Task } from '../model/types';
import { store, useStore } from '../store/store';
import { toast } from './common';
import { WhenPicker } from './pickers';
import { dueLabel, duration, monthDay, planLabel, useT, weekdayName } from './text';

const commit = (fn: Parameters<typeof store.commit>[0]) => {
  try {
    store.commit(fn);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
};

/** A calendar event: what, when, where. Events come from Outlook or a file and are not edited here. */
export function EventPeek({ event }: { event: CalendarEvent }) {
  const { t, lang } = useT();
  const length = minutesOf(event.end) - minutesOf(event.start);
  return (
    <div className="peek">
      <div className="peek-title">{event.title}</div>
      <div className="peek-line">
        {weekdayName(event.day, lang)} {monthDay(event.day)} ·{' '}
        {event.allDay ? t('全天', 'All day') : `${event.start}–${event.end}（${duration(length, lang)}）`}
      </div>
      {event.location && <div className="peek-line">📍 {event.location}</div>}
      <div className="peek-note">{t('来自日历，在 Outlook 里修改。', 'From your calendar; change it in Outlook.')}</div>
    </div>
  );
}

/** A reserved time: the task, the time, minutes worked, and quick changes. */
export function SlotPeek({
  task,
  entry,
  open,
  close,
}: {
  task: Task;
  entry: PlanEntry;
  open: (id: string) => void;
  close: () => void;
}) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const [editing, setEditing] = useState(false);
  const today = dayOf(new Date());
  if (editing)
    return (
      <WhenPicker
        doc={doc}
        day={entry.day}
        today={today}
        current={entry}
        effortLeft={remainingEffort(task)}
        excludeEntry={entry.id}
        worked={entry.doneMin}
        onWorked={(m) => commit((d, c) => updatePlan(d, c, task.id, entry.id, { doneMin: m }))}
        onPick={(w) => {
          commit((d, c) => updatePlan(d, c, task.id, entry.id, { part: w.part, start: w.start, minutes: w.minutes }));
          close();
        }}
        onDelete={() => {
          commit((d, c) => removePlan(d, c, task.id, entry.id));
          close();
        }}
      />
    );
  return (
    <div className="peek">
      <div className="peek-title">{task.title}</div>
      <div className="peek-line">
        {planLabel(entry, today, lang)}
        {entry.start && entry.minutes ? `（${duration(entry.minutes, lang)}）` : ''}
      </div>
      {entry.doneMin ? (
        <div className="peek-line">
          {t(`这次已做 ${duration(entry.doneMin, lang)}`, `Worked ${duration(entry.doneMin, lang)}`)}
        </div>
      ) : null}
      <TaskFacts task={task} />
      <div className="peek-actions">
        <button className="btn primary" onClick={() => (close(), open(task.id))}>
          {t('打开任务', 'Open task')}
        </button>
        <button className="btn" onClick={() => setEditing(true)}>
          {t('改时间', 'Change time')}
        </button>
        <button
          className="btn danger"
          onClick={() => {
            commit((d, c) => removePlan(d, c, task.id, entry.id));
            toast(t('已删除这次安排', 'Arrangement removed'), () => store.undo());
            close();
          }}
        >
          {t('删除', 'Remove')}
        </button>
      </div>
    </div>
  );
}

/** A task shown in the agenda without a time (a deadline or a plan for the day). */
export function TaskPeek({ task, open, close }: { task: Task; open: (id: string) => void; close: () => void }) {
  const { t } = useT();
  return (
    <div className="peek">
      <div className="peek-title">{task.title}</div>
      <TaskFacts task={task} />
      <div className="peek-actions">
        <button className="btn primary" onClick={() => (close(), open(task.id))}>
          {t('打开任务', 'Open task')}
        </button>
        <button
          className="btn"
          onClick={() => {
            commit((d, c) => complete(d, c, task.id));
            toast(t(`完成了“${task.title}”`, `Done: “${task.title}”`), () => store.undo());
            close();
          }}
        >
          {task.repeat?.mode === 'reopen' ? t('完成本轮', 'Finish round') : t('完成', 'Done')}
        </button>
      </div>
    </div>
  );
}

function TaskFacts({ task }: { task: Task }) {
  const { t, lang } = useT();
  const now = new Date();
  const steps = stepProgress(task, now);
  const facts = [
    task.due && dueLabel(task.due, dayOf(now), lang),
    task.effort && `${t('用时', 'Effort')} ${duration(task.effort, lang)}`,
    steps.total && `${t('步骤', 'Steps')} ${steps.done}/${steps.total}`,
  ].filter(Boolean) as string[];
  const note = steps.next
    ? `${t('下一步：', 'Next step: ')}${steps.next.text}`
    : task.note?.split('\n').find((l) => l.trim());
  return (
    <>
      {facts.length > 0 && (
        <div className="facts">
          {facts.map((f) => (
            <span key={f} className="fact">
              {f}
            </span>
          ))}
        </div>
      )}
      {note && <div className="peek-note">{note.replace(/[#>*_`]/g, '')}</div>}
    </>
  );
}

export const slotTime = (entry: PlanEntry) =>
  entry.start ? `${entry.start}–${timeOf(minutesOf(entry.start) + (entry.minutes ?? 60))}` : '';
