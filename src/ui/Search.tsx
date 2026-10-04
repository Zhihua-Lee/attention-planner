import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dayOf } from '../model/dates';
import { liveTasks, stepsOf } from '../model/doc';
import { useStore } from '../store/store';
import { dueLabel, useT } from './text';

/** One box: titles, notes and steps. Arrow keys choose, Enter opens. */
export function Search({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const today = dayOf(new Date());
  useEffect(() => input.current?.focus(), []);
  const needle = q.trim().toLowerCase();
  const results = !needle
    ? []
    : liveTasks(doc)
        .map((task) => {
          const inTitle = task.title.toLowerCase().includes(needle);
          const where = inTitle
            ? ''
            : [task.note ?? '', ...stepsOf(task).map((s) => s.text)].find((x) => x.toLowerCase().includes(needle));
          return inTitle || where ? { task, inTitle, where: where ?? '' } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => Number(!!a.task.done) - Number(!!b.task.done) || Number(b.inTitle) - Number(a.inTitle))
        .slice(0, 30);
  const mark = (s: string) => {
    const i = s.toLowerCase().indexOf(needle);
    if (i < 0) return s;
    return (
      <>
        {s.slice(0, i)}
        <mark>{s.slice(i, i + needle.length)}</mark>
        {s.slice(i + needle.length)}
      </>
    );
  };
  const excerpt = (s: string) => {
    const line = s.split('\n').find((l) => l.toLowerCase().includes(needle)) ?? s;
    const i = line.toLowerCase().indexOf(needle);
    return i > 30 ? '…' + line.slice(i - 20) : line;
  };
  const go = (id: string) => (onClose(), onOpen(id));
  return createPortal(
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search" role="dialog" aria-modal="true" aria-label={t('搜索', 'Search')}>
        <input
          ref={input}
          value={q}
          placeholder={t('搜索任务、正文和步骤', 'Search tasks, notes and steps')}
          aria-label={t('搜索', 'Search')}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="search-results"
          aria-activedescendant={results[sel] ? `res-${results[sel].task.id}` : undefined}
          onChange={(e) => (setQ(e.target.value), setSel(0))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (results.length)
                setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && results[sel]) go(results[sel].task.id);
          }}
        />
        <div className="results" id="search-results" role="listbox">
          {!needle && <div className="search-empty">{t('输入关键词，回车打开。', 'Type to search; Enter opens.')}</div>}
          {needle && !results.length && <div className="search-empty">{t('没有找到。', 'Nothing found.')}</div>}
          {results.map(({ task, where }, i) => (
            <button
              key={task.id}
              id={`res-${task.id}`}
              role="option"
              aria-selected={i === sel}
              className={`res${task.done ? ' is-done' : ''}`}
              onClick={() => go(task.id)}
              onPointerMove={() => setSel(i)}
            >
              <span className="n">{mark(task.title)}</span>
              <span className="m">
                {task.done ? t('已完成', 'Done') : task.due ? dueLabel(task.due, today, lang) : ''}
              </span>
              {where && <span className="s">{mark(excerpt(where))}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
