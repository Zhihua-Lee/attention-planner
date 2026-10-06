import { useEffect, useRef, useState } from 'react';
import { changeTask, describeChange } from '../model/changes';
import { decideProposal, pendingProposals, proposalsFor } from '../model/proposals';
import type { Proposal, Task } from '../model/types';
import { store, useStore } from '../store/store';
import { toast } from './common';
import { useT } from './text';

/** Approve or reject a whole proposal; both are ordinary edits, so they sync and can be undone. */
function decide(p: Proposal, approve: boolean, t: ReturnType<typeof useT>['t']) {
  store.commit((d, c) => decideProposal(d, c, p.id, approve));
  const after = store.get().doc.proposals?.[p.id];
  if (after?.status === 'failed') toast(t(`没能套用：${after.error}`, `Could not apply: ${after.error}`));
  else toast(approve ? t('已批准并套用', 'Approved and applied') : t('已拒绝', 'Rejected'), () => store.undo());
}

function ProposalCard({ p, only, highlight }: { p: Proposal; only?: string; highlight?: boolean }) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center' });
  }, [highlight]);
  // In a task's details, the lines about that task; the rest of the proposal is counted.
  const lines = p.changes.filter((c) => !only || changeTask(c) === only);
  const others = p.changes.length - lines.length;
  return (
    <article ref={ref} className={`proposal${highlight ? ' focus' : ''}`} aria-label={p.summary}>
      <div className="proposal-head">
        <strong>{p.summary}</strong>
        <span className="muted">
          {p.client} ·{' '}
          {new Date(p.created).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </span>
      </div>
      <ul className="proposal-lines">
        {lines.map((c, i) => (
          <li key={i}>{describeChange(doc, c, t)}</li>
        ))}
      </ul>
      {others > 0 && (
        <p className="muted">
          {t(`同一组里还有 ${others} 条改动别的任务。`, `${others} more in this proposal change other tasks.`)}
        </p>
      )}
      <div className="proposal-actions">
        <button className="btn primary" onClick={() => decide(p, true, t)}>
          {p.changes.length > 1
            ? t(`批准全部 ${p.changes.length} 条`, `Approve all ${p.changes.length}`)
            : t('批准', 'Approve')}
        </button>
        <button className="btn" onClick={() => decide(p, false, t)}>
          {t('拒绝', 'Reject')}
        </button>
      </div>
    </article>
  );
}

/**
 * Changes an AI proposed, at the top of the list: a single line when folded, the proposals with what each would do
 * when opened. A link to one proposal (`/?proposal=<id>`) opens it.
 */
export function ProposalsBar({ now, focus }: { now: Date; focus: string | null }) {
  const { doc } = useStore();
  const { t } = useT();
  const list = pendingProposals(doc, now);
  const [open, setOpen] = useState(!!focus);
  useEffect(() => {
    if (focus) setOpen(true);
  }, [focus]);
  if (!list.length) return null;
  return (
    <section className="proposals" aria-label={t('AI 提议', 'AI proposals')}>
      <button className="proposals-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>
          {t('AI 提议', 'AI proposals')} · {list.length}
        </span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && list.map((p) => <ProposalCard key={p.id} p={p} highlight={p.id === focus} />)}
    </section>
  );
}

/** In a task's details: what pending proposals would change in this task, with approve and reject. */
export function ProposalNotice({ task, now }: { task: Task; now: Date }) {
  const { doc } = useStore();
  const list = proposalsFor(doc, task.id, now);
  if (!list.length) return null;
  return (
    <div className="proposal-notice">
      {list.map((p) => (
        <ProposalCard key={p.id} p={p} only={task.id} />
      ))}
    </div>
  );
}
