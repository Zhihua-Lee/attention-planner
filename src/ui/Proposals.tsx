import { useEffect, useRef, useState } from 'react';
import { applyChanges, changeTask, describeChange } from '../model/changes';
import { dayOf } from '../model/dates';
import { effectiveDue, isFinished, isSnoozed, planOf, stepDone, stepsOf, taskEffort } from '../model/doc';
import { decideProposal, pendingProposals, proposalsFor } from '../model/proposals';
import type { Doc, Proposal, Task } from '../model/types';
import { store, useStore } from '../store/store';
import { toast } from './common';
import { dueLabel, duration, planLabel, ruleLabel, useT } from './text';

/** Approve or reject a whole proposal; both are ordinary edits, so they sync and can be undone. */
function decide(p: Proposal, approve: boolean, t: ReturnType<typeof useT>['t']) {
  store.commit((d, c) => decideProposal(d, c, p.id, approve));
  const after = store.get().doc.proposals?.[p.id];
  if (after?.status === 'failed') toast(t(`没能套用：${after.error}`, `Could not apply: ${after.error}`));
  else toast(approve ? t('已批准并套用', 'Approved and applied') : t('已拒绝', 'Rejected'), () => store.undo());
}

/** The tasks a proposal would change, as they would be after it: the touched ones first, then new ones. */
function afterProposal(doc: Doc, p: Proposal, now: Date): { after: Doc; ids: string[] } | null {
  try {
    const after = applyChanges(doc, { now, device: 'preview' }, p.changes);
    const touched = p.changes.map(changeTask).filter((id): id is string => !!id);
    const ids = [...new Set([...touched, ...Object.keys(after.tasks)])].filter(
      (id) => after.tasks[id] && after.tasks[id] !== doc.tasks[id],
    );
    return { after, ids };
  } catch {
    // A task or step is gone: the words say so.
    return null;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A task as it would be after a proposal, drawn like its row in the list: a new task is outlined with a dashed line,
 * a deleted one is struck through, and on a changed one what changes is highlighted, with the old value struck
 * through beside it. Steps are listed when they change.
 */
function PreviewTask({ before, after, doc, now }: { before?: Task; after: Task; doc: Doc; now: Date }) {
  const { t, lang } = useT();
  const today = dayOf(now);
  // On a new task everything is new; only an existing task marks single changes.
  const chg = (changed: boolean) => (before && changed ? ' chg' : '');
  const was = (show: boolean, text: string) => before && show && <s className="was">{text}</s>;
  const finished = isFinished(after, now);
  const plans = (x?: Task) => (x ? planOf(x).filter((p) => p.day >= today) : []);
  const planText = (x?: Task) => {
    const next = plans(x);
    return next[0] ? planLabel(next[0], today, lang) + (next.length > 1 ? ` +${next.length - 1}` : '') : '';
  };
  const dueText = (x?: Task) => {
    const due = x && effectiveDue(x, now);
    return due ? (due.step ? `${due.step.text} · ` : '') + dueLabel(due.day, today, lang) : '';
  };
  const snoozeText = (x?: Task) =>
    x && isSnoozed(x, today)
      ? x.snooze?.until
        ? t(
            `暂缓到${planLabel({ day: x.snooze.until }, today, lang)}`,
            `Snoozed to ${planLabel({ day: x.snooze.until }, today, lang)}`,
          )
        : t('暂缓', 'Snoozed')
      : '';
  const effortText = (x?: Task) => {
    const m = x && taskEffort(x);
    return m ? t('用时 ', '') + duration(m, lang) : '';
  };
  const groupText = (x?: Task) =>
    [x?.areaId && doc.areas[x.areaId]?.name, x?.projectId && doc.projects[x.projectId]?.name]
      .filter(Boolean)
      .join(' · ');
  const repeatText = (x?: Task) => (x?.repeat ? `↻ ${ruleLabel(x.repeat.rule, lang)}` : '');
  const linkText = (x?: Task) => (x?.linkTo ? `→ ${doc.tasks[x.linkTo]?.title ?? ''}` : '');
  // A field shown only when there is something to show or it changed; the old value struck through before it.
  const field = (text: (x?: Task) => string, always = true) => {
    const cur = text(after);
    const old = text(before);
    const changed = !!before && cur !== old;
    if (!changed && (!always || !cur)) return null;
    return (
      <span className={`pv-field${chg(changed)}`}>
        {was(changed && !!old, old)}
        {cur && <span>{cur}</span>}
      </span>
    );
  };

  const oldSteps = before ? stepsOf(before) : [];
  const newSteps = stepsOf(after);
  const removed = oldSteps.filter((s) => !newSteps.some((n) => n.id === s.id));
  const stepsChanged =
    removed.length > 0 ||
    newSteps.some((s) => {
      const o = oldSteps.find((x) => x.id === s.id);
      return (
        !o ||
        o.text !== s.text ||
        o.due !== s.due ||
        o.effort !== s.effort ||
        stepDone(before!, o, now) !== stepDone(after, s, now)
      );
    });
  const noteChanged = !!before && (before.note ?? '') !== (after.note ?? '');

  return (
    <div className={`pv-task${after.deleted ? ' gone' : !before ? ' new' : ''}`}>
      <div className="row-main">
        <span
          className={`check${finished ? ' on' : ''}${chg(!!before && isFinished(before, now) !== finished)}`}
          aria-hidden="true"
        />
        <span className="title-btn">
          {was(!!before && before.title !== after.title, before?.title ?? '')}
          <span className={`tt${chg(!!before && before.title !== after.title)}`}>{after.title}</span>
          {(after.star || before?.star) &&
            (after.star ? (
              <span className={`st${chg(!before?.star)}`} aria-label={t('重要', 'Important')}>
                ★
              </span>
            ) : (
              <s className="was">★</s>
            ))}
          {!before || !same(before.repeat, after.repeat)
            ? field(repeatText)
            : after.repeat && (
                <span className="rp" aria-hidden="true">
                  ↻
                </span>
              )}
          {field(linkText)}
        </span>
        <span className="meta">
          {field(snoozeText)}
          {field(planText)}
          {!finished && field(dueText)}
          {field(effortText, !before)}
          {field(groupText, !before)}
        </span>
      </div>
      {(stepsChanged || (!before && newSteps.length > 0)) && (
        <ul className="pv-steps">
          {newSteps.map((s) => {
            const o = oldSteps.find((x) => x.id === s.id);
            const done = stepDone(after, s, now);
            const mark = !before ? '' : !o ? ' new' : '';
            return (
              <li key={s.id} className={`${done ? 'done' : ''}${mark}`}>
                <span className={`box${done ? ' on' : ''}${chg(!!o && stepDone(before!, o, now) !== done)}`} />
                {was(!!o && o.text !== s.text, o?.text ?? '')}
                <span className={`txt${chg(!!o && o.text !== s.text)}`}>{s.text}</span>
                {(s.due || o?.due) && (
                  <span className={`tag${chg(!!o && o.due !== s.due)}`}>
                    {was(!!o && !!o.due && o.due !== s.due, o?.due ? dueLabel(o.due, today, lang) : '')}
                    {s.due && dueLabel(s.due, today, lang)}
                  </span>
                )}
                {(s.effort || o?.effort) && (
                  <span className={`tag${chg(!!o && o.effort !== s.effort)}`}>
                    {was(!!o && !!o.effort && o.effort !== s.effort, o?.effort ? duration(o.effort, lang) : '')}
                    {s.effort && duration(s.effort, lang)}
                  </span>
                )}
              </li>
            );
          })}
          {removed.map((s) => (
            <li key={s.id} className="gone">
              <span className="box" />
              <span className="txt">{s.text}</span>
            </li>
          ))}
        </ul>
      )}
      {(noteChanged || (!before && after.note)) && (
        <p className={`pv-note${chg(noteChanged)}`}>{after.note || t('（清空备注）', '(note cleared)')}</p>
      )}
    </div>
  );
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
  const now = new Date();
  const shown = afterProposal(doc, p, now);
  const ids = shown ? shown.ids.filter((id) => !only || id === only) : [];
  // Changes to a project or an area have no row to show; they stay in words.
  const words = shown ? lines.filter((c) => !changeTask(c) && c.type !== 'add_task') : lines;
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
      {shown && ids.length > 0 && (
        <div className="pv-list">
          {ids.map((id) => (
            <PreviewTask key={id} before={doc.tasks[id]} after={shown.after.tasks[id]} doc={shown.after} now={now} />
          ))}
        </div>
      )}
      {words.length > 0 && (
        <ul className="proposal-lines">
          {words.map((c, i) => (
            <li key={i}>{describeChange(doc, c, t)}</li>
          ))}
        </ul>
      )}
      {shown && (
        <details className="proposal-words">
          <summary>{t('明细', 'Details')}</summary>
          <ul className="proposal-lines">
            {lines.map((c, i) => (
              <li key={i}>{describeChange(doc, c, t)}</li>
            ))}
          </ul>
        </details>
      )}
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
