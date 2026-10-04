import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, useState } from 'react';
import { dayOf } from '../model/dates';
import { finishedTasks, listTasks, matches, openTasks, type Filter } from '../model/derive';
import { complete, isSnoozed, liveTasks, planOf, setField, taskRound, uncomplete } from '../model/doc';
import type { Task } from '../model/types';
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
  const [group, setGroup] = useState<string>('');
  const [showDone, setShowDone] = useState(false);
  const groupSel = group.startsWith('p:')
    ? { projectId: group.slice(2) }
    : group.startsWith('a:')
      ? { areaId: group.slice(2) }
      : undefined;
  const rows = listTasks(doc, now, filter, groupSel);
  const done = finishedTasks(doc).slice(0, 50);
  const open = openTasks(doc, now);
  const count = (f: Filter) => open.filter((x) => matches(x, f, now)).length;
  const filters: [Filter, string][] = [
    ['all', t('全部', 'All')],
    ['today', t('今天', 'Today')],
    ['new', t('新加的', 'New')],
    ['due', t('有截止', 'Due')],
    ['snoozed', t('暂缓', 'Snoozed')],
  ];
  const areas = Object.values(doc.areas).filter((a) => !a.deleted);
  const projects = Object.values(doc.projects).filter((p) => !p.deleted && !p.done);
  // A task that reopens stays in the list, checked, until its next round opens.
  const resting =
    filter === 'all' && !groupSel
      ? liveTasks(doc).filter((x) => !x.done && x.repeat?.mode === 'reopen' && taskRound(x, now)?.done)
      : [];

  return (
    <div className="stack">
      <Capture ref={captureRef} />
      <div className="filters" role="group" aria-label={t('筛选', 'Filter')}>
        {filters.map(([k, n]) => (
          <button key={k} className="filter" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {n} <span className="count">{count(k)}</span>
          </button>
        ))}
        {(areas.length > 0 || projects.length > 0) && (
          <select
            className="filter-select"
            value={group}
            aria-label={t('按区域或项目', 'By area or project')}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="">{t('全部区域', 'All areas')}</option>
            {areas.map((a) => (
              <option key={a.id} value={`a:${a.id}`}>
                {a.name}
              </option>
            ))}
            {projects.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                {p.name}
              </option>
            ))}
          </select>
        )}
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
        {/* One keyed list, so a task that finishes its round moves down instead of leaving and reappearing. */}
        <AnimatePresence initial={false}>
          {[...rows, ...resting].map((task) => (
            <Row
              key={task.id}
              task={task}
              now={now}
              expanded={expanded === task.id}
              toggle={() => setExpanded(expanded === task.id ? null : task.id)}
              indent={!!task.linkTo && rows.some((r) => r.id === task.linkTo)}
            />
          ))}
        </AnimatePresence>
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
}: {
  task: Task;
  now: Date;
  expanded: boolean;
  toggle: () => void;
  indent: boolean;
}) {
  const { t, lang } = useT();
  const today = dayOf(now);
  const [completing, setCompleting] = useState(false);
  const round = taskRound(task, now);
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
      className={`row${snoozed ? ' snoozed' : ''}${finished ? ' done' : ''}${completing ? ' completing' : ''}${indent ? ' linked' : ''}`}
      data-task={task.id}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.24, ease }}
    >
      <div className="row-main">
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
            {task.due && !finished && (
              <span className={task.due < today ? 'late' : ''}>{dueLabel(task.due, today, lang)}</span>
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
