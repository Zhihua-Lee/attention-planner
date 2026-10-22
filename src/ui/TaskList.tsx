import { AnimatePresence, motion, Reorder, useDragControls, type DragControls, type PanInfo } from 'motion/react';
import { forwardRef, useRef, useState, type CSSProperties } from 'react';
import { addDays, dayOf } from '../model/dates';
import { byArea, finishedTasks, listTasks, matches, nextOnly, openTasks, type Filter } from '../model/derive';
import {
  addArea,
  addPlan,
  inRound,
  plannedOn,
  remainingEffort,
  removeTask,
  reorderTasks,
  setSettings,
  toggleDay,
} from '../model/doc';
import { stillToReserve } from '../model/derive';
import {
  complete,
  isFinished,
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
import { local, store, useStore } from '../store/store';
import { Popover, toast, usePopover } from './common';
import { Capture } from './Capture';
import { proposalsFor } from '../model/proposals';
import { ProposalsBar } from './Proposals';
import { FindTime, TaskDetail } from './TaskDetail';
import { AreaPicker, DayOptions, EffortPicker, LinkPicker, PlanPicker, RepeatEditor } from './pickers';
import { ContextMenu, leaveToBrowser, useLongPress, useMenu, type MenuItem } from './RightMenu';
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
  // The dragged order until it is saved. Motion reports the drop a frame after the handle is let go, while the list
  // already shows the new order; a key pressed in between takes it over, so the late drop must not save it again.
  const pending = useRef<string[] | null>(null);
  const drag = (order: string[]) => {
    pending.current = order;
    setDragging(order);
  };
  const drop = () => {
    const order = pending.current;
    pending.current = null;
    setDragging(null);
    if (order) store.commit((d, c) => reorderTasks(d, c, order));
  };
  const manual = doc.settings.listSort === 'manual';
  const listedAll = listTasks(doc, now, filter);
  // "Only the next one": under each parent task, its next unfinished subtask; the rest are counted on the parent.
  const hasSubtasks = listedAll.some((x) => x.linkTo && listedAll.some((y) => y.id === x.linkTo));
  const next = doc.settings.nextOnly ? nextOnly(listedAll) : null;
  const rows = next ? next.rows : listedAll;
  // "By area": "All" in sections, one per area; a section folded on this device stays folded.
  const grouped = !!doc.settings.groupByArea && filter === 'all';
  const hasAreas = Object.values(doc.areas).some((a) => !a.deleted);
  const [folded, setFolded] = useState<string[]>(() => {
    try {
      return JSON.parse(local.get('ap:folded-areas') ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const fold = (key: string) => {
    const next = folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key];
    setFolded(next);
    local.set('ap:folded-areas', JSON.stringify(next));
  };
  const done = finishedTasks(doc, now).slice(0, 50);
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
    // From the order shown, which right after a drag is the dragged one, not yet saved.
    const list = [...(pending.current ?? rows.map((x) => x.id))];
    const i = list.indexOf(id);
    const j = i + dir;
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
    else if (!pending.current) return;
    pending.current = null;
    setDragging(null);
    store.commit((d, c) => reorderTasks(d, c, list));
  };
  // How deep a subtask sits under listed parents (in its section, when grouped); the indent stops after three levels.
  const listed = new Map(rows.map((r) => [r.id, r]));
  const depth = (task: Task, within = listed) => {
    let n = 0;
    const seen = new Set([task.id]);
    for (let p = task.linkTo; p && within.has(p) && !seen.has(p) && n < 3; p = within.get(p)!.linkTo)
      (seen.add(p), n++);
    return n;
  };
  const rowProps = (task: Task, within?: Map<string, Task>) => ({
    task,
    now,
    expanded: expanded === task.id,
    toggle: () => setExpanded(expanded === task.id ? null : task.id),
    indent: depth(task, within),
    more: next?.hidden.get(task.id) ?? 0,
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
          {/* Not filters but ways of showing, set apart: they go with any filter. */}
          {(hasSubtasks || doc.settings.nextOnly) && (
            <button
              className="filter view"
              aria-pressed={!!doc.settings.nextOnly}
              onClick={() => store.commit((d, c2) => setSettings(d, c2, { nextOnly: !doc.settings.nextOnly }))}
            >
              {t('只看下一个', 'Next only')}
            </button>
          )}
          {filter === 'all' && (hasAreas || doc.settings.groupByArea) && (
            <button
              className="filter view"
              aria-pressed={!!doc.settings.groupByArea}
              onClick={() => store.commit((d, c2) => setSettings(d, c2, { groupByArea: !doc.settings.groupByArea }))}
            >
              {t('按区域分组', 'By area')}
            </button>
          )}
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
        {grouped ? (
          byArea(doc, manual ? ids.map((id) => byId.get(id)!).filter(Boolean) : [...rows, ...resting]).map((sec) => {
            const key = sec.areaId ?? 'none';
            const unfolded = !folded.includes(key);
            const within = new Map(sec.rows.map((r) => [r.id, r]));
            const secIds = sec.rows.map((r) => r.id);
            const name = sec.areaId ? doc.areas[sec.areaId].name : t('没有区域', 'No area');
            // The area runs down the left of its tasks; folding it collapses the tasks into one line, in one motion
            // (the rows stay mounted, so none of them animates out on its own).
            return (
              <div key={key} className={`area-sec${unfolded ? '' : ' folded'}`}>
                <button
                  className="area-rail"
                  aria-expanded={unfolded}
                  aria-label={t(`${name}，${sec.rows.length} 个任务`, `${name}, ${sec.rows.length} tasks`)}
                  title={unfolded ? t('收起', 'Fold') : t('展开', 'Unfold')}
                  onClick={() => fold(key)}
                >
                  <span className="area-name" aria-hidden="true">
                    {name}
                  </span>
                </button>
                <div className="area-body">
                  <motion.div
                    className="area-summary"
                    initial={false}
                    animate={{ height: unfolded ? 0 : 'auto', opacity: unfolded ? 0 : 1 }}
                    transition={{ duration: 0.24, ease }}
                    aria-hidden={unfolded}
                  >
                    <button tabIndex={unfolded ? -1 : 0} onClick={() => fold(key)}>
                      <span className="area-label">{name}</span>{' '}
                      <span className="count">· {t(`${sec.rows.length} 个已收起`, `${sec.rows.length} folded`)}</span>
                    </button>
                  </motion.div>
                  <motion.div
                    className="area-rows"
                    initial={false}
                    animate={{ height: unfolded ? 'auto' : 0, opacity: unfolded ? 1 : 0 }}
                    transition={{ duration: 0.24, ease }}
                    inert={!unfolded}
                  >
                    {manual ? (
                      // Dragging stays within a section; the whole list keeps one order.
                      <Reorder.Group
                        as="div"
                        axis="y"
                        values={secIds}
                        onReorder={(order) => {
                          let i = 0;
                          drag(ids.map((id) => (within.has(id) ? order[i++] : id)));
                        }}
                      >
                        {sec.rows.map((task) => (
                          <DraggableRow
                            key={task.id}
                            {...rowProps(task, within)}
                            onMove={(dir) => move(task.id, dir)}
                            onDrop={drop}
                          />
                        ))}
                      </Reorder.Group>
                    ) : (
                      <AnimatePresence initial={false}>
                        {sec.rows.map((task) => (
                          <Row key={task.id} {...rowProps(task, within)} />
                        ))}
                      </AnimatePresence>
                    )}
                  </motion.div>
                </div>
              </div>
            );
          })
        ) : manual ? (
          <Reorder.Group as="div" axis="y" values={ids} onReorder={drag}>
            {ids.map((id) => {
              const task = byId.get(id);
              return task ? (
                <DraggableRow key={id} {...rowProps(task)} onMove={(dir) => move(id, dir)} onDrop={drop} />
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
        {manual && resting.map((task) => <Row key={task.id} {...rowProps(task)} indent={0} />)}
        {done.length > 0 && (
          <>
            <button className="done-head" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
              {showDone ? '▾' : '▸'} {t('已完成', 'Done')} {finishedTasks(doc, now).length}
            </button>
            {showDone &&
              done.map((task) => (
                <Row
                  key={task.id}
                  task={task}
                  now={now}
                  expanded={expanded === task.id}
                  toggle={() => setExpanded(expanded === task.id ? null : task.id)}
                  indent={0}
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
  more = 0,
  handle,
  onMove,
}: {
  task: Task;
  now: Date;
  expanded: boolean;
  toggle: () => void;
  /** Levels under listed parent tasks. */
  indent: number;
  /** Subtasks left out of sight by "only the next one". */
  more?: number;
  handle?: DragControls;
  onMove?: (dir: -1 | 1) => void;
}) {
  const { t, lang } = useT();
  const today = dayOf(now);
  const [completing, setCompleting] = useState(false);
  const round = taskRound(task, now);
  const due = effectiveDue(task, now);
  const finished = isFinished(task, now);
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
  // The row's actions as a menu on right-click or a long press, if so chosen in Settings (instead of the ☀ button).
  const menuMode = store.get().doc.settings.rowActions === 'menu';
  const menu = useMenu();
  const pop = usePopover<RowPick>();
  const set = <K extends Parameters<typeof setField>[3]>(field: K, value: Task[K]) =>
    commit((d, c) => setField(d, c, task.id, field, value));
  const reopens = task.repeat?.mode === 'reopen';
  const items = (el: HTMLElement): MenuItem[] => [
    {
      label: finished
        ? reopens
          ? t('重新打开本轮', 'Reopen this round')
          : t('标为未完成', 'Mark not done')
        : reopens
          ? t('完成本轮', 'Finish this round')
          : t('完成', 'Done'),
      run: onCheck,
    },
    ...(!finished
      ? [{ label: inToday ? t('☀ 移出今天', '☀ Off today') : t('☀ 加到今天', '☀ Add to today'), run: toggleToday }]
      : []),
    'sep',
    { label: t('截止…', 'Deadline…'), run: () => pop.toggle('due', el) },
    { label: t('安排…', 'Plan…'), run: () => pop.toggle('plan', el) },
    ...(!finished && stillToReserve(task) > 0
      ? [{ label: t('找时间…', 'Find time…'), run: () => pop.toggle('find', el) }]
      : []),
    {
      label: task.star ? t('★ 取消重要', '★ Not important') : t('★ 标为重要', '★ Important'),
      run: () => set('star', task.star ? undefined : true),
    },
    {
      label: snoozed ? t('取消暂缓', 'Unsnooze') : t('暂缓', 'Snooze'),
      run: () => set('snooze', snoozed ? undefined : { until: undefined }),
    },
    { label: t('区域…', 'Area…'), run: () => pop.toggle('area', el) },
    { label: t('上级任务…', 'Parent task…'), run: () => pop.toggle('link', el) },
    'sep',
    { label: expanded ? t('收起', 'Close') : t('打开', 'Open'), run: toggle },
    {
      label: t('删除', 'Delete'),
      danger: true,
      run: () => {
        commit((d, c) => removeTask(d, c, task.id));
        toast(t(`已删除“${task.title}”`, `Deleted “${task.title}”`), () => store.undo());
      },
    },
  ];
  const press = useLongPress((at, el) => menu.openAt(at, el, task.title, items(el)));
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
      className={`row${snoozed ? ' snoozed' : ''}${finished ? ' done' : ''}${completing ? ' completing' : ''}${indent ? ' linked' : ''}`}
      style={indent ? ({ '--depth': indent } as CSSProperties) : undefined}
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
        onContextMenu={(e) => {
          if (!menuMode || leaveToBrowser(e)) return;
          e.preventDefault();
          menu.openAt(e, e.currentTarget, task.title, items(e.currentTarget));
        }}
        {...(menuMode
          ? {
              onPointerDown: press.onPointerDown,
              onPointerMove: press.onPointerMove,
              onPointerUp: press.onPointerUp,
              onPointerCancel: press.onPointerCancel,
            }
          : {})}
        onClickCapture={(e) => {
          if (Date.now() - swiped.current < 400 || press.fired()) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        // An open task's top line closes it where nothing else is: the space around the box, the name and "close".
        onClick={(e) => expanded && e.target === e.currentTarget && toggle()}
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
            {more > 0 && <span>{t(`还有 ${more} 个子任务`, `${more} more subtasks`)}</span>}
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
            {finished && round?.nextAt && (
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
        {!expanded && !finished && !menuMode && (
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
      {menu.menu && <ContextMenu menu={menu.menu} onClose={menu.close} />}
      {pop.open && <RowPicker task={task} now={now} which={pop.open.key} anchor={pop.open.el} close={pop.close} />}
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

const commit = (fn: Parameters<typeof store.commit>[0]) => {
  try {
    store.commit(fn);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
};

export type RowPick = 'due' | 'plan' | 'find' | 'area' | 'link' | 'effort' | 'repeat';

/**
 * What a choice in a row's menu (or a property on the NOW card) opens: the deadline, a plan, free times, the area, the
 * parent task, the estimate or the repeat.
 */
export function RowPicker({
  task,
  now,
  which,
  anchor,
  close,
}: {
  task: Task;
  now: Date;
  which: RowPick;
  anchor: HTMLElement;
  close: () => void;
}) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const today = dayOf(now);
  const id = task.id;
  return (
    <Popover anchor={anchor} onClose={close} label={task.title}>
      {which === 'due' && (
        <div className="menu">
          <DayOptions
            today={today}
            title={`${t('截止', 'Due')} · ${task.title}`}
            onPick={(day) => {
              commit((d, c) => setField(d, c, id, 'due', day));
              close();
            }}
          />
          {task.due && (
            <button
              className="link-btn danger"
              onClick={() => {
                commit((d, c) => setField(d, c, id, 'due', undefined));
                close();
              }}
            >
              {t('清除截止', 'Clear the deadline')}
            </button>
          )}
        </div>
      )}
      {which === 'plan' && (
        <PlanPicker
          doc={doc}
          today={today}
          effortLeft={remainingEffort(task)}
          onPick={(p) => {
            commit((d, c) => addPlan(d, c, id, p));
            close();
          }}
        />
      )}
      {which === 'find' && (
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
            close();
          }}
        />
      )}
      {which === 'area' && (
        <AreaPicker
          doc={doc}
          value={task.areaId}
          onPick={(areaId) => {
            commit((d, c) => setField(d, c, id, 'areaId', areaId));
            close();
          }}
          onCreate={(name) => {
            commit((d, c) => {
              const [n, gid] = addArea(d, c, name);
              return setField(n, c, id, 'areaId', gid);
            });
            close();
          }}
        />
      )}
      {which === 'effort' && (
        <EffortPicker
          value={task.effort}
          onPick={(m) => {
            commit((d, c) => setField(d, c, id, 'effort', m));
            close();
          }}
        />
      )}
      {which === 'repeat' && (
        <RepeatEditor task={task} today={today} onChange={(r) => commit((d, c) => setField(d, c, id, 'repeat', r))} />
      )}
      {which === 'link' && (
        <LinkPicker
          doc={doc}
          self={id}
          value={task.linkTo}
          onPick={(v) => {
            commit((d, c) => setField(d, c, id, 'linkTo', v));
            close();
          }}
        />
      )}
    </Popover>
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
