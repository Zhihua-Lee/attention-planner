import { useLayoutEffect, useRef, useState } from 'react';
import { dayOf, isTime } from '../model/dates';
import {
  addArea,
  addPlan,
  addProject,
  complete,
  isSnoozed,
  live,
  planOf,
  remainingEffort,
  removePlan,
  removeTask,
  setField,
  taskEffort,
  taskRound,
  toggleDay,
  uncomplete,
  updatePlan,
} from '../model/doc';
import { findTimes, stillToReserve, type Slot } from '../model/derive';
import type { Task } from '../model/types';
import { store, useStore } from '../store/store';
import { Popover, toast, usePopover } from './common';
import { EffortPicker, GroupPicker, LinkPicker, PlanPicker, RepeatEditor, WhenPicker } from './pickers';
import { ConflictNotice } from './Conflict';
import { NewStep } from './NewStep';
import { ProposalNotice } from './Proposals';
import { StepList } from './StepList';
import { duration, monthDay, planLabel, ruleLabel, useT } from './text';
import { noteHtml } from './markdown';

const commit = (fn: Parameters<typeof store.commit>[0]) => {
  try {
    store.commit(fn);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
};

type PopKey = 'plan-add' | `plan-${string}` | 'effort' | 'find' | 'group' | 'link';

/** Everything about one task, edited where it is shown. */
export function TaskDetail({ task, now }: { task: Task; now: Date }) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const today = dayOf(now);
  const pop = usePopover<PopKey>();
  const [editingNote, setEditingNote] = useState(false);
  const [noteHeight, setNoteHeight] = useState(0);
  const [showRepeat, setShowRepeat] = useState(false);
  const id = task.id;
  const set = <K extends Parameters<typeof setField>[3]>(field: K, value: Task[K]) =>
    commit((d, c) => setField(d, c, id, field, value));
  const plan = planOf(task);
  const round = taskRound(task, now);
  const done = plannedDone(task);
  const still = stillToReserve(task);
  const group = task.projectId
    ? doc.projects[task.projectId]?.name
    : task.areaId
      ? doc.areas[task.areaId]?.name
      : undefined;
  const target = task.linkTo ? doc.tasks[task.linkTo] : undefined;
  const linkedHere = Object.values(doc.tasks).filter((x) => !x.deleted && x.linkTo === id);
  const history = live(task.rounds)
    .sort((a, b) => b.doneAt.localeCompare(a.doneAt))
    .slice(0, 8);

  return (
    <div className="detail" data-testid="task-detail">
      <ConflictNotice task={task} field="title" />
      <ProposalNotice task={task} now={now} />
      {/* Steps are what you do, so they come first, at full width; the properties follow. */}
      <div className="val steps" role="group" aria-label={t('步骤', 'Steps')}>
        <StepList task={task} now={now} />
        <NewStep task={task} now={now} />
      </div>
      <div className="props">
        <span className="lbl">{t('截止', 'Due')}</span>
        <span className="val">
          <input
            type="date"
            value={task.due ?? ''}
            aria-label={t('截止日期', 'Due date')}
            onChange={(e) => set('due', e.target.value || undefined)}
          />
          {task.due && (
            <input
              type="time"
              value={task.dueTime ?? ''}
              aria-label={t('截止时刻（可选）', 'Due time (optional)')}
              onChange={(e) => set('dueTime', isTime(e.target.value) ? e.target.value : undefined)}
            />
          )}
        </span>

        <span className="lbl">{t('安排', 'When')}</span>
        <span className="val">
          {plan.map((p) => (
            <button
              key={p.id}
              className={`pill${p.day < today ? ' past' : ''}`}
              aria-expanded={pop.is(`plan-${p.id}`)}
              onClick={(e) => pop.toggle(`plan-${p.id}`, e.currentTarget)}
            >
              {planLabel(p, today, lang)}
              {p.doneMin ? (
                <span className="sub">
                  {' '}
                  · {t('已做', 'done')} {duration(p.doneMin, lang)}
                </span>
              ) : null}
            </button>
          ))}
          {!plan.some((p) => p.day === today) && (
            <button className="link-btn" onClick={() => commit((d, c) => toggleDay(d, c, id, today))}>
              ☀ {t('加到今天', 'Add to today')}
            </button>
          )}
          <button
            className="link-btn"
            aria-expanded={pop.is('plan-add')}
            onClick={(e) => pop.toggle('plan-add', e.currentTarget)}
          >
            + {t('添加', 'Add')}
          </button>
        </span>

        <span className="lbl">{t('用时', 'Effort')}</span>
        <span className="val">
          <button
            className="pill"
            aria-expanded={pop.is('effort')}
            onClick={(e) => pop.toggle('effort', e.currentTarget)}
          >
            {task.effort
              ? duration(task.effort, lang)
              : taskEffort(task)
                ? `${duration(taskEffort(task)!, lang)}${t('（步骤合计）', ' (sum of steps)')}`
                : t('未填', 'Not set')}
          </button>
          {taskEffort(task) && (done.reserved || done.worked) ? (
            <span className="muted">
              {[
                done.reserved && `${t('已排', 'reserved')} ${duration(done.reserved, lang)}`,
                done.worked && `${t('已做', 'done')} ${duration(done.worked, lang)}`,
                done.reserved && still > 0 && `${t('还差', 'to go')} ${duration(still, lang)}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          ) : null}
          {/* The estimate decides how long a suggested time is; reserving never changes the estimate. */}
          {still > 0 && !round?.done && !task.done && (
            <button
              className="link-btn"
              aria-expanded={pop.is('find')}
              onClick={(e) => pop.toggle('find', e.currentTarget)}
            >
              {t('找时间', 'Find time')}
            </button>
          )}
        </span>

        <span className="lbl">{t('重复', 'Repeat')}</span>
        <span className="val col">
          <button className="pill" aria-expanded={showRepeat} onClick={() => setShowRepeat((v) => !v)}>
            {task.repeat
              ? `${ruleLabel(task.repeat.rule, lang)} · ${task.repeat.mode === 'reopen' ? t('原地重开', 'reopens') : t('新建一份', 'new copy')}${task.repeat.paused ? ` · ${t('已暂停', 'paused')}` : ''}`
              : t('不重复', 'None')}
          </button>
          {round && (
            <span className="muted">
              {t('本轮', 'This round')} {round.key.length === 10 ? monthDay(round.key) : monthDay(dayOf(round.opensAt))}{' '}
              · {round.done ? t('已完成', 'done') : t('进行中', 'open')}
              {round.nextAt ? ` · ${t('下次', 'next')} ${monthDay(dayOf(round.nextAt))}` : ''}
            </span>
          )}
          {showRepeat && <RepeatEditor task={task} today={today} onChange={(r) => set('repeat', r)} />}
          {history.length > 0 && (
            <details className="history">
              <summary>
                {t('完成历史', 'History')} · {history.length}
              </summary>
              {history.map((r) => (
                <span key={r.key}>
                  {monthDay(dayOf(new Date(r.doneAt)))} {new Date(r.doneAt).toTimeString().slice(0, 5)}
                </span>
              ))}
            </details>
          )}
        </span>

        <span className="lbl">{t('其他', 'More')}</span>
        <span className="val">
          <label className="toggle">
            <input type="checkbox" checked={!!task.star} onChange={(e) => set('star', e.target.checked || undefined)} />
            ★ {t('重要', 'Important')}
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={isSnoozed(task, today)}
              onChange={(e) => set('snooze', e.target.checked ? { until: undefined } : undefined)}
            />
            {t('暂缓', 'Snooze')}
          </label>
          {task.snooze && (
            <>
              <input
                type="date"
                value={task.snooze.until ?? ''}
                aria-label={t('暂缓到', 'Snooze until')}
                onChange={(e) => set('snooze', { ...task.snooze, until: e.target.value || undefined })}
              />
              <input
                className="short"
                defaultValue={task.snooze.reason ?? ''}
                placeholder={t('原因，如“等回信”', 'Reason, e.g. waiting for reply')}
                aria-label={t('暂缓原因', 'Snooze reason')}
                onBlur={(e) =>
                  e.target.value !== (task.snooze?.reason ?? '') &&
                  set('snooze', { ...task.snooze, reason: e.target.value.trim() || undefined })
                }
              />
            </>
          )}
        </span>

        <span className="lbl">{t('归属', 'Belongs to')}</span>
        <span className="val">
          <button
            className="pill"
            aria-expanded={pop.is('group')}
            onClick={(e) => pop.toggle('group', e.currentTarget)}
          >
            {group ?? t('未分类', 'None')}
          </button>
        </span>

        <span className="lbl">{t('关联', 'Linked to')}</span>
        <span className="val">
          <button className="pill" aria-expanded={pop.is('link')} onClick={(e) => pop.toggle('link', e.currentTarget)}>
            {target && !target.deleted ? target.title : t('无', 'None')}
          </button>
          {linkedHere.length > 0 && (
            <span className="muted">
              {t('关联到这里：', 'Linked here: ')}
              {linkedHere.map((x) => x.title).join('、')}
            </span>
          )}
        </span>
      </div>

      <ConflictNotice task={task} field="note" />
      {editingNote ? (
        <NoteEditor
          value={task.note ?? ''}
          startHeight={noteHeight}
          label={t('正文', 'Note')}
          placeholder={t('怎么做、链接、上次的经验……', 'How to do it, links, what you learned last time…')}
          onDone={(value) => {
            setEditingNote(false);
            if (value !== (task.note ?? '')) set('note', value.trim() ? value : undefined);
          }}
        />
      ) : (
        <div
          className={`note-view${task.note ? '' : ' empty'}`}
          role="button"
          tabIndex={0}
          aria-label={t('编辑正文', 'Edit note')}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) return;
            setNoteHeight(e.currentTarget.offsetHeight);
            setEditingNote(true);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            setNoteHeight(e.currentTarget.offsetHeight);
            setEditingNote(true);
          }}
          dangerouslySetInnerHTML={{
            __html: task.note
              ? noteHtml(task.note)
              : t('点这里写正文（支持 Markdown）', 'Click to write a note (Markdown)'),
          }}
        />
      )}

      <div className="detail-actions">
        {round?.done || task.done ? (
          <button className="btn" onClick={() => commit((d, c) => uncomplete(d, c, id))}>
            {task.repeat?.mode === 'reopen' ? t('重新打开本轮', 'Reopen this round') : t('标为未完成', 'Mark not done')}
          </button>
        ) : (
          <button className="btn primary" onClick={() => commit((d, c) => complete(d, c, id))}>
            {task.repeat?.mode === 'reopen' ? t('完成本轮', 'Finish this round') : t('完成', 'Done')}
          </button>
        )}
        <button
          className="btn danger"
          onClick={() => {
            commit((d, c) => removeTask(d, c, id));
            toast(t(`已删除“${task.title}”`, `Deleted “${task.title}”`), () => store.undo());
          }}
        >
          {t('删除', 'Delete')}
        </button>
      </div>

      {pop.open && (
        <Popover anchor={pop.open.el} onClose={pop.close} label={t('编辑', 'Edit')}>
          {pop.is('plan-add') && (
            <PlanPicker
              doc={doc}
              today={today}
              effortLeft={remainingEffort(task)}
              onPick={(p) => {
                commit((d, c) => addPlan(d, c, id, p));
                pop.close();
              }}
            />
          )}
          {plan.map(
            (p) =>
              pop.is(`plan-${p.id}`) && (
                <WhenPicker
                  key={p.id}
                  doc={doc}
                  day={p.day}
                  today={today}
                  current={p}
                  effortLeft={remainingEffort(task)}
                  excludeEntry={p.id}
                  onPick={(w) => {
                    commit((d, c) => updatePlan(d, c, id, p.id, { part: w.part, start: w.start, minutes: w.minutes }));
                    pop.close();
                  }}
                  onDelete={() => {
                    commit((d, c) => removePlan(d, c, id, p.id));
                    pop.close();
                  }}
                  worked={p.doneMin}
                  onWorked={(m) => commit((d, c) => updatePlan(d, c, id, p.id, { doneMin: m }))}
                />
              ),
          )}
          {pop.is('find') && (
            <FindTime
              task={task}
              now={now}
              onPick={(slot, keepEstimate) => {
                commit((d, c) => {
                  const next = addPlan(d, c, id, slot);
                  return keepEstimate ? setField(next, c, id, 'effort', 60) : next;
                });
                toast(t(`已预留 ${planLabel(slot, today, lang)}`, `Reserved ${planLabel(slot, today, lang)}`), () =>
                  store.undo(),
                );
                pop.close();
              }}
            />
          )}
          {pop.is('effort') && (
            <EffortPicker
              value={task.effort}
              onPick={(m) => {
                set('effort', m);
                pop.close();
              }}
            />
          )}
          {pop.is('group') && (
            <GroupPicker
              doc={doc}
              value={{ areaId: task.areaId, projectId: task.projectId }}
              onPick={(g) => {
                commit((d, c) => setField(setField(d, c, id, 'areaId', g.areaId), c, id, 'projectId', g.projectId));
                pop.close();
              }}
              onCreate={(kind, name) => {
                commit((d, c) => {
                  const [n, gid] = kind === 'area' ? addArea(d, c, name) : addProject(d, c, name);
                  return setField(n, c, id, kind === 'area' ? 'areaId' : 'projectId', gid);
                });
                pop.close();
              }}
            />
          )}
          {pop.is('link') && (
            <LinkPicker
              doc={doc}
              self={id}
              value={task.linkTo}
              onPick={(v) => {
                set('linkTo', v);
                pop.close();
              }}
            />
          )}
        </Popover>
      )}
    </div>
  );
}

function plannedDone(task: Task) {
  let reserved = 0;
  let worked = 0;
  for (const p of planOf(task)) {
    if (p.start) reserved += p.minutes ?? 60;
    worked += p.doneMin ?? 0;
  }
  return { reserved, worked };
}

/** Free times for a task; one tap reserves one. Without an estimate it looks for an hour and offers to keep that. */
function FindTime({
  task,
  now,
  onPick,
}: {
  task: Task;
  now: Date;
  onPick: (slot: Slot, keepEstimate: boolean) => void;
}) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const [keep, setKeep] = useState(true);
  const today = dayOf(now);
  const slots = findTimes(doc, task, now);
  const noEstimate = !taskEffort(task);
  return (
    <div className="menu find-time">
      <div className="menu-title">
        {t('找时间', 'Find time')} · {duration(Math.min(120, stillToReserve(task)), lang)}
      </div>
      {slots.map((slot) => (
        <button
          key={`${slot.day} ${slot.start}`}
          className="menu-item"
          onClick={() => onPick(slot, noEstimate && keep)}
        >
          <span>{planLabel(slot, today, lang)}</span>
        </button>
      ))}
      {!slots.length && (
        <p className="hint pad">
          {task.due
            ? t('截止前的工作时间里没有空档。', 'No free working time before the deadline.')
            : t('两周内的工作时间里没有空档。', 'No free working time in the next two weeks.')}
        </p>
      )}
      {noEstimate && (
        <label className="check-row small pad">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          {t('用时记为 1 小时', 'Set the estimate to 1 hour')}
        </label>
      )}
    </div>
  );
}

/**
 * The note while it is being written: the same box, font and padding as the note when it is read, starting at the
 * height it had there and growing with the text, so switching between the two does not jump.
 */
function NoteEditor({
  value,
  startHeight,
  label,
  placeholder,
  onDone,
}: {
  value: string;
  startHeight: number;
  label: string;
  placeholder: string;
  onDone: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(startHeight, el.scrollHeight + 2)}px`;
  };
  useLayoutEffect(() => {
    fit();
    const el = ref.current;
    if (el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <textarea
      ref={ref}
      className="note"
      defaultValue={value}
      aria-label={label}
      placeholder={placeholder}
      onInput={fit}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.currentTarget.blur();
      }}
    />
  );
}
