import { AnimatePresence, motion, Reorder, useDragControls, type DragControls, type PanInfo } from 'motion/react';
import { forwardRef, useRef, useState } from 'react';
import { addDays, dayOf } from '../model/dates';
import { finishedTasks, listTasks, matches, openTasks, type Filter, queuePosition } from '../model/derive';
import { inRound, plannedOn, reorderTasks, setSettings, toggleDay } from '../model/doc';
import {
  complete,
  isSnoozed,
  liveTasks,
  planOf,
  setField,
  taskRound,
  uncomplete,
  effectiveDue,
  openConflict,
} from '../model/doc';
import { FILTER_CHIPS, type Task } from '../model/types';
import { store, useStore } from '../store/store';
import { Popover, toast, usePopover } from './common';
import { Capture } from './Capture';
import { proposalsFor } from '../model/proposals';
import { ProposalsBar } from './Proposals';
import { TaskDetail } from './TaskDetail';
import { dueLabel, planLabel, useT } from './text';

const ease = [0.2, 0.8, 0.2, 1] as const;

export const TaskList = forwardRef<
  HTMLInputElement,
  { now: Date; expanded: string | null; setExpanded: (id: string | null) => void; proposal?: string | null }
>(function TaskList({ now, expanded, setExpanded, proposal = null }, captureRef) {
  const { doc } = useStore();
  const { t } = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const [showDone, setShowDone] = useState(false);
  const [dragging, setDragging] = useState<string[] | null>(null);
  const manual = doc.settings.listSort === 'manual';
  const rows = listTasks(doc, now, filter);
  const done = finishedTasks(doc).slice(0, 50);
  const open = openTasks(doc, now);
  const count = (f: Filter) => open.filter((x) => matches(doc, x, f, now)).length;
  // "All" always; the rest as chosen in Settings. "Today" stays even when empty; the others show only when they have
  // something (or are selected).
  const shown = new Set(doc.settings.filters ?? FILTER_CHIPS);
  const chips: [Filter, string][] = [
    ['all', t('全部', 'All')],
    ...(shown.has('today') ? ([['today', t('今天', 'Today')]] as [Filter, string][]) : []),
    ...(
      [
        ...(shown.has('soon') ? [['soon', t('7 天内截止', 'Due this week')]] : []),
        ...(shown.has('due') ? [['due', t('有截止', 'With a deadline')]] : []),
        ...(shown.has('star') ? [['star', t('重要', 'Important')]] : []),
        ...(shown.has('new') ? [['new', t('新加的', 'New')]] : []),
        ...(shown.has('unplanned') ? [['unplanned', t('未安排', 'Unplanned')]] : []),
        ...(shown.has('snoozed') ? [['snoozed', t('暂缓', 'Snoozed')]] : []),
        ...(shown.has('areas')
          ? Object.values(doc.areas)
              .filter((x) => !x.deleted)
              .sort((x, y) => x.order - y.order)
              .map((x) => [`a:${x.id}`, x.name])
          : []),
        ...(shown.has('projects')
          ? Object.values(doc.projects)
              .filter((x) => !x.deleted && !x.done)
              .sort((x, y) => x.order - y.order)
              .map((x) => [`p:${x.id}`, x.name])
          : []),
      ] as [Filter, string][]
    ).filter(([k]) => filter === k || count(k) > 0),
  ];
  const info = usePopover<'today'>();
  // Planned yesterday, not done, and not already in today: offered to carry over (only offered, never moved by itself).
  const today = dayOf(now);
  const yesterday = addDays(today, -1);
  const carry =
    filter === 'today'
      ? open.filter((x) => {
          const seen = inRound(x, now);
          return planOf(seen).some((p) => p.day === yesterday) && !planOf(seen).some((p) => p.day === today);
        })
      : [];
  // A task that reopens stays in the list, checked, until its next round opens.
  const resting =
    filter === 'all'
      ? liveTasks(doc).filter((x) => !x.done && x.repeat?.mode === 'reopen' && taskRound(x, now)?.done)
      : [];
  const ids = dragging ?? rows.map((x) => x.id);
  const byId = new Map(rows.map((x) => [x.id, x]));
  const move = (id: string, dir: -1 | 1) => {
    const list = rows.map((x) => x.id);
    const i = list.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    store.commit((d, c) => reorderTasks(d, c, list));
  };
  const rowProps = (task: Task) => ({
    task,
    now,
    expanded: expanded === task.id,
    toggle: () => setExpanded(expanded === task.id ? null : task.id),
    indent: !!task.linkTo && rows.some((r) => r.id === task.linkTo),
  });

  return (
    <div className="stack">
      <Capture ref={captureRef} />
      <ProposalsBar now={now} focus={proposal} />
      {info.open && (
        <Popover anchor={info.open.el} onClose={info.close} label={t('“今天”包括什么', 'What “Today” includes')}>
          <div className="info-text">
            <p>{t('“今天”里是：', '“Today” holds:')}</p>
            <ul>
              <li>
                {t('今天截止或已经逾期的（步骤的截止也算）', 'what is due today or overdue (a step’s deadline counts)')}
              </li>
              <li>
                {t(
                  '安排在今天的（加到今天、哪天做、预留的时段）',
                  'what is planned for today (added to today, a day, a reserved time)',
                )}
              </li>
              <li>{t('原地重开的任务还没做完的这一轮', 'the open round of a task that reopens')}</li>
              <li>{t('按自己的节奏到了这一轮的步骤', 'steps whose own rhythm has come round')}</li>
            </ul>
            <p className="muted">
              {t(
                '暂缓的不在里面，除非截止已经到了。加到今天：每行的 ☀（手机上左滑，电脑上选中按 T）；第二天它自然离开今天，不算逾期。',
                'Snoozed tasks are left out unless their deadline has come. Add to today with a row’s ☀ (swipe left on a phone, or T on a selected row); the next day it simply leaves Today, without becoming overdue.',
              )}
            </p>
          </div>
        </Popover>
      )}
      {carry.length > 0 && (
        <div className="carry" role="note">
          <span>{t(`昨天计划了 ${carry.length} 件还没做`, `${carry.length} planned for yesterday, not done`)}</span>
          <button
            className="link-btn"
            onClick={() => {
              store.commit((d, c) => carry.reduce((acc, x) => toggleDay(acc, c, x.id, today), d));
              toast(t(`已把 ${carry.length} 件加到今天`, `Added ${carry.length} to today`), () => store.undo());
            }}
          >
            {t('都加到今天', 'Add them all to today')}
          </button>
        </div>
      )}
      <div className="list-bar">
        <div className="filters" role="group" aria-label={t('筛选', 'Filter')}>
          {chips.map(([k, n]) => (
            <span key={k} className="filter-wrap">
              <button className="filter" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {n} <span className="count">{count(k)}</span>
              </button>
              {k === 'today' && (
                <button
                  className="info"
                  aria-label={t('“今天”包括什么', 'What “Today” includes')}
                  aria-expanded={info.is('today')}
                  onClick={(e) => info.toggle('today', e.currentTarget)}
                >
                  ⓘ
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="seg small" role="radiogroup" aria-label={t('排序', 'Order')}>
          <button
            role="radio"
            aria-checked={!manual}
            onClick={() => store.commit((d, c2) => setSettings(d, c2, { listSort: 'smart' }))}
          >
            {t('智能', 'Smart')}
          </button>
          <button
            role="radio"
            aria-checked={manual}
            onClick={() => store.commit((d, c2) => setSettings(d, c2, { listSort: 'manual' }))}
          >
            {t('手动', 'By hand')}
          </button>
        </div>
      </div>
      <section className="list" aria-label={t('清单', 'List')}>
        {rows.length === 0 && resting.length === 0 && (
          <div className="empty">
            {open.length === 0 && done.length === 0
              ? t(
                  '还没有任务。在上面的输入框里写下第一件事，按回车。',
                  'No tasks yet. Type the first one above and press Enter.',
                )
              : t('这里没有任务。', 'Nothing here.')}
          </div>
        )}
        {manual ? (
          <Reorder.Group as="div" axis="y" values={ids} onReorder={setDragging}>
            {ids.map((id) => {
              const task = byId.get(id);
              return task ? (
                <DraggableRow
                  key={id}
                  {...rowProps(task)}
                  onMove={(dir) => move(id, dir)}
                  onDrop={() => {
                    if (dragging) store.commit((d, c2) => reorderTasks(d, c2, dragging));
                    setDragging(null);
                  }}
                />
              ) : null;
            })}
          </Reorder.Group>
        ) : (
          /* One keyed list, so a task that finishes its round moves down instead of leaving and reappearing. */
          <AnimatePresence initial={false}>
            {[...rows, ...resting].map((task) => (
              <Row key={task.id} {...rowProps(task)} />
            ))}
          </AnimatePresence>
        )}
        {manual && resting.map((task) => <Row key={task.id} {...rowProps(task)} indent={false} />)}
        {done.length > 0 && (
          <>
            <button className="done-head" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
              {showDone ? '▾' : '▸'} {t('已完成', 'Done')} {finishedTasks(doc).length}
            </button>
            {showDone &&
              done.map((task) => (
                <Row
                  key={task.id}
                  task={task}
                  now={now}
                  expanded={expanded === task.id}
                  toggle={() => setExpanded(expanded === task.id ? null : task.id)}
                  indent={false}
                />
              ))}
          </>
        )}
      </section>
    </div>
  );
});

function Row({
  task,
  now,
  expanded,
  toggle,
  indent,
  handle,
  onMove,
}: {
  task: Task;
  now: Date;
  expanded: boolean;
  toggle: () => void;
  indent: boolean;
  handle?: DragControls;
  onMove?: (dir: -1 | 1) => void;
}) {
  const { t, lang } = useT();
  const today = dayOf(now);
  const [completing, setCompleting] = useState(false);
  const round = taskRound(task, now);
  const due = effectiveDue(task, now);
  const queued = queuePosition(store.get().doc, task, now);
  const finished = !!task.done || !!round?.done;
  const snoozed = isSnoozed(task, today);
  const proposed = proposalsFor(store.get().doc, task.id, now).length > 0;
  const next = planOf(task).filter((p) => p.day >= today);
  const linkTarget = task.linkTo ? store.get().doc.tasks[task.linkTo] : undefined;
  // "My Day": an arrangement for today with no set time, toggled from the row.
  const inToday = plannedOn(task, today, now);
  const toggleToday = () => {
    const before = store.get().doc;
    store.commit((d, c) => toggleDay(d, c, task.id, today));
    if (store.get().doc === before) toast(t('今天已经有预留的时段', 'It already has a reserved time today'));
    else
      toast(
        inToday
          ? t(`已移出今天：${task.title}`, `Off today: ${task.title}`)
          : t(`已加到今天：${task.title}`, `Added to today: ${task.title}`),
        () => store.undo(),
      );
  };
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  // The tap that ends a swipe must not also open or complete the task underneath.
  const swiped = useRef(0);
  const onSwipe = (_: unknown, info: PanInfo) => {
    swiped.current = Date.now();
    if (info.offset.x < -64 && Math.abs(info.offset.y) < 40) toggleToday();
  };

  const onCheck = () => {
    if (finished) return store.commit((d, c) => uncomplete(d, c, task.id));
    setCompleting(true);
    setTimeout(() => {
      try {
        store.commit((d, c) => complete(d, c, task.id));
        toast(t(`完成了“${task.title}”`, `Done: “${task.title}”`), () => store.undo());
      } catch (e) {
        setCompleting(false);
        toast(e instanceof Error ? e.message : String(e));
      }
    }, 380);
  };

  return (
    <motion.div
      layout="position"
      className={`row${snoozed || queued > 0 ? ' snoozed' : ''}${finished ? ' done' : ''}${completing ? ' completing' : ''}${indent ? ' linked' : ''}`}
      data-task={task.id}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.24, ease }}
    >
      <div className="swipe-under" aria-hidden="true">
        ☀ {inToday ? t('移出今天', 'Off today') : t('加到今天', 'To today')}
      </div>
      <motion.div
        className={`row-main${handle ? ' with-handle' : ''}`}
        drag={touch && !expanded && !finished ? 'x' : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.5, right: 0 }}
        dragSnapToOrigin
        onDragStart={() => (swiped.current = Date.now())}
        onDragEnd={onSwipe}
        onClickCapture={(e) => {
          if (Date.now() - swiped.current < 400) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {handle && (
          <button
            className="handle"
            aria-label={`${t('拖动排序（也可用 ↑↓）', 'Drag to reorder (or ↑/↓)')}: ${task.title}`}
            onPointerDown={(e) => handle.start(e)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                onMove?.(e.key === 'ArrowUp' ? -1 : 1);
              }
            }}
          >
            ⠿
          </button>
        )}
        <button
          className={`check${finished || completing ? ' on' : ''}`}
          role="checkbox"
          aria-checked={finished || completing}
          aria-label={`${finished ? t('标为未完成', 'Mark not done') : t('完成', 'Complete')}: ${task.title}`}
          onClick={onCheck}
        />
        {expanded ? (
          <input
            className="row-title"
            autoFocus={false}
            defaultValue={task.title}
            key={task.fs.title?.rev}
            aria-label={t('任务名称', 'Task name')}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== task.title) store.commit((d, c) => setField(d, c, task.id, 'title', v));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') toggle();
            }}
          />
        ) : (
          <button
            className="title-btn"
            aria-expanded={false}
            onClick={toggle}
            onKeyDown={(e) => {
              if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey && !finished) {
                e.preventDefault();
                toggleToday();
              }
            }}
          >
            <span className="tt">{task.title}</span>
            {task.star && (
              <span className="st" aria-label={t('重要', 'Important')}>
                ★
              </span>
            )}
            {task.repeat && (
              <span className="rp" aria-hidden="true">
                ↻
              </span>
            )}
            {!indent && linkTarget && !linkTarget.deleted && <span className="lk">→ {linkTarget.title}</span>}
          </button>
        )}
        {expanded ? (
          <button className="collapse" aria-expanded={true} aria-label={t('收起', 'Collapse')} onClick={toggle}>
            {t('收起', 'Close')} ▴
          </button>
        ) : (
          <span className="meta">
            {queued > 0 && <span>{t(`排队中 · 前面还有 ${queued} 个`, `Queued · ${queued} before it`)}</span>}
            {(openConflict(task, 'note') || openConflict(task, 'title')) && (
              <span className="warn">{t('有两个版本', 'Two versions')}</span>
            )}
            {proposed && <span className="ai">{t('AI 提议', 'AI proposal')}</span>}
            {snoozed ? (
              <span>
                {task.snooze?.until
                  ? t(
                      `暂缓到${planLabel({ day: task.snooze.until }, today, lang)}`,
                      `Snoozed to ${planLabel({ day: task.snooze.until }, today, lang)}`,
                    )
                  : t('暂缓', 'Snoozed')}
              </span>
            ) : next[0] ? (
              <span className="plan">
                {planLabel(next[0], today, lang)}
                {next.length > 1 && <span className="plus"> +{next.length - 1}</span>}
              </span>
            ) : null}
            {round?.done && round.nextAt && (
              <span>
                {t('下一轮', 'Next round')} {planLabel({ day: dayOf(round.nextAt) }, today, lang)}
              </span>
            )}
            {due && !finished && (
              <span className={due.day < today ? 'late' : ''} title={due.step?.text}>
                {due.step ? `${due.step.text} · ` : ''}
                {dueLabel(due.day, today, lang)}
              </span>
            )}
          </span>
        )}
        {!expanded && !finished && (
          <button
            className={`myday-btn${inToday ? ' on' : ''}`}
            aria-pressed={inToday}
            aria-label={`${inToday ? t('移出今天', 'Off today') : t('加到今天', 'Add to today')}: ${task.title}`}
            title={inToday ? t('移出今天（T）', 'Off today (T)') : t('加到今天（T）', 'Add to today (T)')}
            onClick={toggleToday}
          >
            ☀
          </button>
        )}
      </motion.div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="d"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease }}
            style={{ overflow: 'hidden' }}
          >
            <TaskDetail task={task} now={now} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** A row in the list sorted by hand: dragged by its handle. */
function DraggableRow(props: Parameters<typeof Row>[0] & { onDrop: () => void; onMove: (dir: -1 | 1) => void }) {
  const controls = useDragControls();
  const { onDrop, ...rest } = props;
  return (
    <Reorder.Item as="div" value={props.task.id} dragListener={false} dragControls={controls} onDragEnd={onDrop}>
      <Row {...rest} handle={controls} />
    </Reorder.Item>
  );
}
