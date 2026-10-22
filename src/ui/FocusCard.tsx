import { useState } from 'react';
import { dayOf, minutesOf, nowMinutes } from '../model/dates';
import { stepProgress, type Pick, type Reason } from '../model/derive';
import { complete, planOf, remainingEffort, toggleStep } from '../model/doc';
import type { PlanEntry, Task } from '../model/types';
import { store, useStore } from '../store/store';
import { Popover, toast, usePopover } from './common';
import { SlotPeek } from './Peek';
import { RowPicker, type RowPick } from './TaskList';
import { dueLabel, duration, reasonChip, ruleLabel, useT } from './text';

const commit = (fn: Parameters<typeof store.commit>[0]) => {
  try {
    store.commit(fn);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
};

/** Today's arrangement that made the task the one to do now, if a plan did. */
function planBehind(task: Task, reason: Reason, now: Date): PlanEntry | undefined {
  const today = dayOf(now);
  const m = nowMinutes(now);
  return planOf(task).find(
    (p) =>
      p.day === today &&
      (reason.kind === 'slot'
        ? !!p.start && minutesOf(p.start) <= m && m < minutesOf(p.start) + (p.minutes ?? 60)
        : reason.kind === 'part'
          ? p.part === reason.part
          : reason.kind === 'today' && !p.start),
  );
}

/**
 * The task to do now, in four parts from top to bottom: the time (free until the next event), the task and its
 * properties (why now, deadline, estimate, repeat, area; each opens its picker), the step to do next (checked right
 * here, or another one), and finishing it or taking the next task.
 */
export function FocusCard({
  pick,
  next,
  another,
  now,
  freeUntil,
  open,
}: {
  pick: Pick;
  next?: Pick;
  another: () => void;
  now: Date;
  /** The next event today, if any. */
  freeUntil?: { start: string; title: string };
  open: (id: string) => void;
}) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const pop = usePopover<RowPick | 'when'>();
  const [skip, setSkip] = useState({ id: '', n: 0 });
  const task = pick.task;
  const today = dayOf(now);
  const reason = reasonChip(pick.reason, lang);
  const behind = planBehind(task, pick.reason, now);
  const r = pick.reason;
  const reasonStep = (r.kind === 'overdue' || r.kind === 'dueToday') && r.step;

  // The step to do: the one whose deadline brought the task here first, then today's, then in order.
  const steps = stepProgress(task, now);
  const todo = reasonStep
    ? [...steps.open.filter((s) => s.text === reasonStep), ...steps.open.filter((s) => s.text !== reasonStep)]
    : steps.open;
  const n = skip.id === task.id ? skip.n : 0;
  const step = todo.length ? todo[n % todo.length] : undefined;
  const note = task.note
    ?.split('\n')
    .find((l) => l.trim())
    ?.replace(/[#>*_`[\]]/g, '')
    .trim();

  const left = remainingEffort(task);
  const area = task.areaId ? doc.areas[task.areaId]?.name : undefined;
  // Why now, then the deadline, the size, the rhythm and where it belongs.
  const chips: { key: RowPick | 'when' | 'open'; label: string; cls?: string }[] = [];
  if (reason)
    chips.push({
      key: behind ? 'when' : reasonStep ? 'open' : r.kind === 'overdue' || r.kind === 'dueToday' ? 'due' : 'plan',
      label: reason.label,
      cls: reason.late ? 'late' : r.kind === 'today' ? 'today' : undefined,
    });
  if (task.due && !((r.kind === 'overdue' || r.kind === 'dueToday') && !r.step))
    chips.push({ key: 'due', label: dueLabel(task.due, today, lang) });
  if (task.effort)
    chips.push({
      key: 'effort',
      label: `${t('用时', 'Effort')} ${duration(task.effort, lang)}${left! < task.effort ? ` · ${t('还剩', 'left')} ${duration(left!, lang)}` : ''}`,
    });
  if (task.repeat) chips.push({ key: 'repeat', label: `↻ ${ruleLabel(task.repeat.rule, lang)}` });
  if (area) chips.push({ key: 'area', label: area });

  return (
    <>
      <div className="focus-head">
        <span>
          {freeUntil
            ? t(`空闲到 ${freeUntil.start}`, `Free until ${freeUntil.start}`)
            : t('今天后面没有日程', 'Nothing else on the calendar today')}
        </span>
        {freeUntil && <span className="ellip">{t(`之后：${freeUntil.title}`, `Then: ${freeUntil.title}`)}</span>}
      </div>

      <div className="focus-task">
        <h1>
          <button className="focus-title" onClick={() => open(task.id)}>
            {task.star && (
              <span className="star" aria-label={t('重要', 'Important')}>
                ★{' '}
              </span>
            )}
            {task.title}
          </button>
        </h1>
        {chips.length > 0 && (
          <div className="attrs" role="group" aria-label={t('属性', 'Properties')}>
            {chips.map((c) => (
              <button
                key={c.key + c.label}
                className={`attr${c.cls ? ` ${c.cls}` : ''}`}
                aria-expanded={c.key === 'open' ? undefined : pop.is(c.key)}
                onClick={(e) => (c.key === 'open' ? open(task.id) : pop.toggle(c.key, e.currentTarget))}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {step ? (
        <div className="focus-step">
          <label>
            <input
              type="checkbox"
              checked={false}
              onChange={() => {
                commit((d, c) => toggleStep(d, c, task.id, step.id, true));
                toast(t(`勾掉了“${step.text}”`, `Checked “${step.text}”`), () => store.undo());
              }}
            />
            <span>{step.text}</span>
          </label>
          <span className="count">
            {steps.done}/{steps.total}
          </span>
          {todo.length > 1 && (
            <button className="attr" onClick={() => setSkip({ id: task.id, n: n + 1 })}>
              {t('换一步', 'Another step')}
            </button>
          )}
        </div>
      ) : (
        note && <div className="snippet">{note}</div>
      )}

      <div className="focus-foot">
        <button
          className="btn primary"
          onClick={() => {
            commit((d, c) => complete(d, c, task.id));
            toast(t(`完成了“${task.title}”`, `Done: “${task.title}”`), () => store.undo());
          }}
        >
          {task.repeat?.mode === 'reopen' ? t('完成本轮', 'Finish round') : t('完成', 'Done')}
        </button>
        {next && (
          <button className="btn another" onClick={another}>
            <span className="ellip">{t(`换一件：${next.task.title}`, `Another: ${next.task.title}`)}</span>
          </button>
        )}
      </div>

      {pop.open &&
        (pop.open.key === 'when' ? (
          behind && (
            <Popover anchor={pop.open.el} onClose={pop.close} label={task.title}>
              <SlotPeek task={task} entry={behind} open={open} close={pop.close} editing />
            </Popover>
          )
        ) : (
          <RowPicker task={task} now={now} which={pop.open.key} anchor={pop.open.el} close={pop.close} />
        ))}
    </>
  );
}
