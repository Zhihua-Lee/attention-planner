import { Reorder, useDragControls } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { dayOf } from '../model/dates';
import { findTimes, stillToReserveStep } from '../model/derive';
import {
  addPlan,
  moveStep,
  promoteStep,
  removeStep,
  reorderSteps,
  stepDone,
  stepPlannedOn,
  stepsOf,
  toggleStep,
  toggleStepDay,
  updateStep,
} from '../model/doc';
import type { Step, StepTool, Task } from '../model/types';
import { store, useStore } from '../store/store';
import { AutoText, Popover, toast, usePopover } from './common';
import { DayOptions, EffortPicker, StepRepeatEditor } from './pickers';
import { dueLabel, duration, planLabel, ruleLabel, useT } from './text';

const commit = (fn: Parameters<typeof store.commit>[0]) => {
  try {
    store.commit(fn);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
};

export const DEFAULT_STEP_TOOLS: StepTool[] = ['today', 'due', 'repeat'];

/**
 * The steps of a task. Drag the handle (or use ↑/↓ on it) to reorder. A step's own deadline, estimate and repeat show
 * as small tags; the buttons after each step are chosen in Settings so the list stays quiet.
 */
export function StepList({ task, now }: { task: Task; now: Date }) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const tools = doc.settings.stepTools ?? DEFAULT_STEP_TOOLS;
  const pop = usePopover<string>();
  const steps = stepsOf(task);
  const [dragging, setDragging] = useState<string[] | null>(null);
  // The dragged order until it is saved. Motion reports the drop a frame after the handle is let go, while the list
  // already shows the new order; a key pressed in between saves it first, so the late drop must not save it again.
  const pending = useRef<string[] | null>(null);
  const drag = (order: string[]) => {
    pending.current = order;
    setDragging(order);
  };
  const drop = () => {
    const order = pending.current;
    pending.current = null;
    setDragging(null);
    if (order) commit((d, c) => reorderSteps(d, c, task.id, order));
  };
  const listRef = useRef<HTMLDivElement>(null);
  // Opening the task (this list mounts with it) scrolls past the checked steps to the first open one, if so chosen.
  useEffect(() => {
    const first = steps.findIndex((s) => !stepDone(task, s, now));
    if (!doc.settings.skipDoneSteps || first <= 0) return;
    // After the details have opened, so the step is where it will stay; a jump, not a glide (a smooth scroll is
    // dropped when anything else scrolls meanwhile).
    const timer = setTimeout(
      // In this list: a task just closed may still be fading out with the same steps.
      () => listRef.current?.querySelector(`[data-step="${steps[first].id}"]`)?.scrollIntoView({ block: 'center' }),
      250,
    );
    return () => clearTimeout(timer);
    // Once, on opening: checking a step later must not move the page.
  }, []);
  // The step last tapped keeps its buttons out on a phone: iOS does not focus a tapped button, so focus alone would
  // hide them between the touch and the click. It is set on click, once the tap is over, so no row moves under it.
  const [active, setActive] = useState<string | null>(null);
  const ids = dragging ?? steps.map((s) => s.id);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const today = dayOf(now);
  const open = pop.open ? byId.get(pop.open.key.slice(pop.open.key.indexOf(':') + 1)) : undefined;
  const kind = pop.open?.key.split(':')[0];
  return (
    <>
      <Reorder.Group ref={listRef} axis="y" as="div" className="step-list" values={ids} onReorder={drag}>
        {ids.map((sid, i) => {
          const s = byId.get(sid);
          return s ? (
            <StepRow
              key={sid}
              task={task}
              step={s}
              now={now}
              tools={tools}
              first={i === 0}
              active={active === sid}
              onActive={() => setActive(sid)}
              last={i === ids.length - 1}
              onOpen={(k, el) => pop.toggle(`${k}:${s.id}`, el)}
              isOpen={(k) => pop.is(`${k}:${s.id}`)}
              onDrop={drop}
            />
          ) : null;
        })}
      </Reorder.Group>
      {pop.open && open && (
        <Popover anchor={pop.open.el} onClose={pop.close} label={t('步骤', 'Step')}>
          {kind === 'due' && (
            <div className="menu">
              <DayOptions
                today={today}
                title={`${t('步骤截止', 'Step due')} · ${open.text}`}
                onPick={(day) => {
                  commit((d, c) => updateStep(d, c, task.id, open.id, { due: day }));
                  pop.close();
                }}
              />
              {open.due && (
                <button
                  className="link-btn danger"
                  onClick={() => {
                    commit((d, c) => updateStep(d, c, task.id, open.id, { due: undefined }));
                    pop.close();
                  }}
                >
                  {t('清除截止', 'Clear the deadline')}
                </button>
              )}
            </div>
          )}
          {kind === 'effort' && (
            <>
              <EffortPicker
                value={open.effort}
                onPick={(m) => {
                  commit((d, c) => updateStep(d, c, task.id, open.id, { effort: m }));
                  pop.close();
                }}
              />
              {/* Time for this step in the calendar: as long as its estimate (or an hour), before its deadline. */}
              <div className="menu find-time">
                <div className="menu-title">
                  {t('找时间', 'Find time')} · {duration(Math.min(120, stillToReserveStep(task, open) || 60), lang)}
                </div>
                {findTimes(doc, task, now, 3, open).map((slot) => (
                  <button
                    key={`${slot.day} ${slot.start}`}
                    className="menu-item"
                    onClick={() => {
                      commit((d, c) =>
                        addPlan(d, c, task.id, {
                          day: slot.day,
                          start: slot.start,
                          minutes: slot.minutes,
                          stepId: open.id,
                        }),
                      );
                      toast(
                        t(
                          `已为“${open.text}”预留 ${planLabel(slot, today, lang)}`,
                          `Reserved ${planLabel(slot, today, lang)} for “${open.text}”`,
                        ),
                        () => store.undo(),
                      );
                      pop.close();
                    }}
                  >
                    <span>{planLabel(slot, today, lang)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {kind === 'repeat' && (
            <StepRepeatEditor
              task={task}
              step={open}
              today={today}
              onChange={(r) => commit((d, c) => updateStep(d, c, task.id, open.id, { repeat: r }))}
            />
          )}
        </Popover>
      )}
    </>
  );
}

function StepRow({
  task,
  step,
  now,
  tools,
  first,
  last,
  active,
  onActive,
  onOpen,
  isOpen,
  onDrop,
}: {
  task: Task;
  step: Step;
  now: Date;
  tools: StepTool[];
  first: boolean;
  last: boolean;
  active: boolean;
  onActive: () => void;
  onOpen: (kind: string, el: HTMLElement) => void;
  isOpen: (kind: string) => boolean;
  onDrop: () => void;
}) {
  const { t, lang } = useT();
  const controls = useDragControls();
  const checked = stepDone(task, step, now);
  const today = dayOf(now);
  const own = typeof step.repeat === 'object' ? step.repeat : undefined;
  const inToday = stepPlannedOn(task, step.id, today, now);
  const toggleToday = () => {
    commit((d, c) => toggleStepDay(d, c, task.id, step.id, today));
    toast(
      inToday
        ? t(`已移出今天：${step.text}`, `Off today: ${step.text}`)
        : t(`今天做这一步：${step.text}`, `Today: ${step.text}`),
      () => store.undo(),
    );
  };
  const tag = (kind: string, text: string, cls = '') => (
    <button
      className={`step-tag ${cls}`}
      aria-expanded={isOpen(kind)}
      onClick={(e) => onOpen(kind, e.currentTarget)}
      title={text}
    >
      {text}
    </button>
  );
  return (
    <Reorder.Item
      value={step.id}
      as="div"
      className={`step${checked ? ' done' : ''}${active ? ' active' : ''}`}
      data-step={step.id}
      onClick={onActive}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDrop}
    >
      <button
        className="handle"
        aria-label={`${t('拖动排序（也可用 ↑↓）', 'Drag to reorder (or ↑/↓)')}: ${step.text}`}
        onPointerDown={(e) => controls.start(e)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowUp' && !first) || (e.key === 'ArrowDown' && !last)) {
            e.preventDefault();
            onDrop(); // a drag just let go is saved first
            commit((d, c) => moveStep(d, c, task.id, step.id, e.key === 'ArrowUp' ? -1 : 1));
          }
        }}
      >
        ⠿
      </button>
      <input
        type="checkbox"
        checked={checked}
        aria-label={step.text}
        onChange={(e) => commit((d, c) => toggleStep(d, c, task.id, step.id, e.target.checked))}
      />
      <span className="step-main">
        <AutoText
          key={step.s.rev}
          className="step-text"
          value={step.text}
          label={t('步骤内容', 'Step text')}
          onCommit={(text) => commit((d, c) => updateStep(d, c, task.id, step.id, { text }))}
        />
        {(inToday || step.due || step.effort || own || (step.repeat === 'none' && task.repeat?.mode === 'reopen')) && (
          <span className="step-tags">
            {inToday && (
              <button
                className="step-tag today"
                title={t('点一下移出今天', 'Tap to take it off today')}
                onClick={toggleToday}
              >
                ☀ {t('今天', 'Today')}
              </button>
            )}
            {step.due && tag('due', dueLabel(step.due, today, lang), step.due < today && !checked ? 'late' : '')}
            {step.effort ? tag('effort', duration(step.effort, lang)) : null}
            {own ? tag('repeat', `↻ ${ruleLabel(own, lang)}`) : null}
            {step.repeat === 'none' && task.repeat?.mode === 'reopen' ? tag('repeat', t('不重复', 'No repeat')) : null}
          </span>
        )}
      </span>
      <span className="step-tools">
        {tools.includes('today') && !checked && (
          <button
            className={`mini${inToday ? ' on' : ''}`}
            aria-pressed={inToday}
            aria-label={`${inToday ? t('移出今天', 'Off today') : t('今天做这一步', 'Do this step today')}: ${step.text}`}
            title={inToday ? t('移出今天', 'Off today') : t('今天做这一步', 'Do this step today')}
            onClick={toggleToday}
          >
            ☀
          </button>
        )}
        {tools.includes('due') && (
          <button
            className={`mini${step.due ? ' on' : ''}`}
            aria-label={`${t('截止', 'Due')}: ${step.text}`}
            aria-expanded={isOpen('due')}
            onClick={(e) => onOpen('due', e.currentTarget)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
          </button>
        )}
        {tools.includes('effort') && (
          <button
            className={`mini${step.effort ? ' on' : ''}`}
            aria-label={`${t('用时', 'Effort')}: ${step.text}`}
            aria-expanded={isOpen('effort')}
            onClick={(e) => onOpen('effort', e.currentTarget)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2 2M9 2h6" />
            </svg>
          </button>
        )}
        {tools.includes('repeat') && (
          <button
            className={`mini${step.repeat ? ' on' : ''}`}
            aria-label={`${t('重复', 'Repeat')}: ${step.text}`}
            aria-expanded={isOpen('repeat')}
            onClick={(e) => onOpen('repeat', e.currentTarget)}
          >
            ↻
          </button>
        )}
        {tools.includes('promote') && (
          <button
            className="mini"
            aria-label={`${t('独立成任务', 'Make it a task')}: ${step.text}`}
            onClick={() => {
              commit((d, c) => promoteStep(d, c, task.id, step.id)[0]);
              toast(
                t(
                  `“${step.text}”成了独立的任务，是这里的子任务`,
                  `“${step.text}” is now its own task, a subtask of this one`,
                ),
                () => store.undo(),
              );
            }}
          >
            ↗
          </button>
        )}
        <button
          className="mini"
          aria-label={`${t('删除', 'Delete')}: ${step.text}`}
          onClick={() => commit((d, c) => removeStep(d, c, task.id, step.id))}
        >
          ×
        </button>
      </span>
    </Reorder.Item>
  );
}
