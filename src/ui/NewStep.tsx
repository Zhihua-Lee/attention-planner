import { useState } from 'react';
import { dayOf } from '../model/dates';
import { addStep } from '../model/doc';
import { parseCapture } from '../model/parse';
import type { Step, Task } from '../model/types';
import { store } from '../store/store';
import { toast } from './common';
import { duration, dueLabel, ruleLabel, useT } from './text';

type Field = 'due' | 'effort' | 'repeat';

/**
 * The box under a task's steps. It reads the same quick words as the capture box, for a step: a date is its deadline,
 * a length its estimate, and "每天"/"每周一"/"不重复" its repeat. What it recognised shows under the box; tapping a tag
 * gives those words back to the step's text.
 */
export function NewStep({ task, now }: { task: Task; now: Date }) {
  const { t, lang } = useT();
  const [text, setText] = useState('');
  const [kept, setKept] = useState<Set<Field>>(new Set());
  const today = dayOf(now);
  const parsed = parseCapture(text, now, { step: true });
  const reopen = task.repeat?.mode === 'reopen';
  const use = (f: Field) => !kept.has(f) && parsed[f] !== undefined;
  // "不重复" only means something in a task that reopens; elsewhere steps never reset anyway.
  const repeat: Step['repeat'] = !use('repeat')
    ? undefined
    : parsed.repeat === 'none'
      ? reopen
        ? 'none'
        : undefined
      : (parsed.repeat as Exclude<Step['repeat'], 'none'>);
  const tags: [Field, string][] = [];
  if (use('due')) tags.push(['due', `${t('截止', 'Due')} ${dueLabel(parsed.due!, today, lang)}`]);
  if (use('effort')) tags.push(['effort', duration(parsed.effort!, lang)]);
  if (use('repeat') && (parsed.repeat !== 'none' || reopen))
    tags.push([
      'repeat',
      parsed.repeat === 'none' ? t('不重复', 'No repeat') : `↻ ${ruleLabel(parsed.repeat as never, lang)}`,
    ]);

  // The step's text: the typed line without the words that were used.
  let title = ` ${text} `;
  for (const f of ['due', 'effort', 'repeat'] as const)
    if (use(f) && parsed.tokens[f]) title = title.replace(parsed.tokens[f]!, ' ');
  title = title.replace(/\s+/g, ' ').trim();

  const save = () => {
    if (!title && !tags.length) return;
    try {
      store.commit((d, c) =>
        addStep(d, c, task.id, title || text.trim(), undefined, {
          ...(use('due') ? { due: parsed.due } : {}),
          ...(use('effort') ? { effort: parsed.effort } : {}),
          ...(repeat ? { repeat } : {}),
        }),
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
    setText('');
    setKept(new Set());
  };

  return (
    <>
      <input
        className="step-new"
        value={text}
        placeholder={t('+ 添加步骤', '+ Add a step')}
        aria-label={t('添加步骤', 'Add a step')}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value) setKept(new Set());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim()) save();
        }}
      />
      {tags.length > 0 && (
        <div className="step-new-tags" aria-live="polite">
          {tags.map(([f, label]) => (
            <button
              key={f}
              type="button"
              className="chip set"
              aria-label={`${label}，${t('再点一下撤掉', 'tap to undo')}`}
              onClick={() => setKept((k) => new Set(k).add(f))}
            >
              {label}
              <span className="x" aria-hidden="true">
                ×
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
