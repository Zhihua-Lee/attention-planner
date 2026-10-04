import { useState } from 'react';
import { openConflict, resolveConflict } from '../model/doc';
import type { Task, TextField } from '../model/types';
import { store } from '../store/store';
import { toast } from './common';
import { useT } from './text';

/**
 * Another device changed the same text at the same time. The later version is shown; the other is kept here until
 * you keep one of them. Both choices are ordinary edits, so they sync and can be undone.
 */
export function ConflictNotice({ task, field }: { task: Task; field: TextField }) {
  const { t } = useT();
  const [compare, setCompare] = useState(false);
  const c = openConflict(task, field);
  if (!c) return null;
  const name = field === 'note' ? t('正文', 'note') : t('标题', 'title');
  const choose = (use: 'current' | 'other') => {
    store.commit((d, ctx) => resolveConflict(d, ctx, task.id, field, use));
    toast(t('已保留所选的一版', 'Kept the version you chose'), () => store.undo());
  };
  return (
    <div className="conflict" role="alert">
      <div>
        {t(
          `另一台设备同时改了${name}。现在显示的是较晚的一版。`,
          `Another device changed the ${name} at the same time. The later version is shown.`,
        )}
      </div>
      <div className="conflict-actions">
        <button className="btn" onClick={() => choose('current')}>
          {t('保留这一版', 'Keep this one')}
        </button>
        <button className="btn" onClick={() => choose('other')}>
          {t('换成另一版', 'Use the other')}
        </button>
        <button className="link-btn" aria-expanded={compare} onClick={() => setCompare((v) => !v)}>
          {compare ? t('收起对照', 'Hide') : t('对照两版', 'Compare')}
        </button>
      </div>
      {compare && (
        <div className="conflict-compare">
          <div>
            <span className="muted">{t('现在这一版', 'Shown')}</span>
            <pre>{task[field] ?? t('（空）', '(empty)')}</pre>
          </div>
          <div>
            <span className="muted">{t('另一版', 'The other')}</span>
            <pre>{c.value ?? t('（空）', '(empty)')}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
