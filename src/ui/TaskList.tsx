import { AnimatePresence, motion, Reorder, useDragControls, type DragControls } from 'motion/react';
import { forwardRef, useState } from 'react';
import { dayOf } from '../model/dates';
import { finishedTasks, listTasks, matches, openTasks, type Filter, queuePosition } from '../model/derive';
import { reorderTasks, setSettings } from '../model/doc';
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
import { toast } from './common';
import { Capture } from './Capture';
import { TaskDetail } from './TaskDetail';
import { dueLabel, planLabel, useT } from './text';

const ease = [0.2, 0.8, 0.2, 1] as const;

export const TaskList = forwardRef<
  HTMLInputElement,
  { now: Date; expanded: string | null; setExpanded: (id: string | null) => void }
>(function TaskList({ now, expanded, setExpanded }, captureRef) {
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
        ...(shown.has('new') ? [['new', t('新加的', 'New')]] : []),
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
      <div className="list-bar">
        <div className="filters" role="group" aria-label={t('筛选', 'Filter')}>
          {chips.map(([k, n]) => (
            <button key={k} className="filter" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {n} <span className="count">{count(k)}</span>
            </button>
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
  const next = planOf(task).filter((p) => p.day >= today);
  const linkTarget = task.linkTo ? store.get().doc.tasks[task.linkTo] : undefined;

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
      <div className={`row-main${handle ? ' with-handle' : ''}`}>
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
          <button className="title-btn" aria-expanded={false} onClick={toggle}>
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
      </div>
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
