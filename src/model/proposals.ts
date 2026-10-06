import { applyChanges, changeTask, type Change } from './changes';
import { edit, type Ctx } from './doc';
import type { Doc, Proposal } from './types';

/** A pending proposal that nobody decided within two weeks is no longer offered. */
const LAPSE_DAYS = 14;

/** Keep an AI's proposed changes with the tasks, waiting for the owner. */
export function addProposal(
  doc: Doc,
  ctx: Ctx,
  p: { id: string; summary: string; client: string; changes: Change[] },
): Doc {
  return edit(doc, ctx, (e) => {
    e.doc.proposals = {
      ...e.doc.proposals,
      [p.id]: { ...p, created: ctx.now.toISOString(), status: 'pending', s: e.s },
    };
  });
}

/**
 * Approve (apply every change, then mark it applied) or reject a proposal. If a change can no longer be applied (its
 * task or step is gone), nothing is applied and the proposal is marked failed with the reason.
 */
export function decideProposal(doc: Doc, ctx: Ctx, id: string, approve: boolean): Doc {
  const p = doc.proposals?.[id];
  if (!p || p.status !== 'pending') return doc;
  let next = doc;
  let status: Proposal['status'] = 'rejected';
  let error: string | undefined;
  if (approve)
    try {
      next = applyChanges(doc, ctx, p.changes);
      status = 'applied';
    } catch (e) {
      status = 'failed';
      error = e instanceof Error ? e.message : String(e);
    }
  return edit(next, ctx, (e) => {
    e.doc.proposals = {
      ...e.doc.proposals,
      [id]: { ...p, status, decided: ctx.now.toISOString(), ...(error ? { error } : {}), s: e.s },
    };
  });
}

/** The AI that made a pending proposal takes it back; nothing in it is applied. */
export function withdrawProposal(doc: Doc, ctx: Ctx, id: string): Doc {
  const p = doc.proposals?.[id];
  if (!p || p.status !== 'pending') return doc;
  return edit(doc, ctx, (e) => {
    e.doc.proposals = {
      ...e.doc.proposals,
      [id]: { ...p, status: 'withdrawn', decided: ctx.now.toISOString(), s: e.s },
    };
  });
}

/** Proposals waiting for the owner, oldest first (lapsed ones left out). */
export const pendingProposals = (doc: Doc, now: Date): Proposal[] =>
  Object.values(doc.proposals ?? {})
    .filter((p) => p.status === 'pending' && now.getTime() - new Date(p.created).getTime() < LAPSE_DAYS * 864e5)
    .sort((a, b) => a.created.localeCompare(b.created));

/** The pending proposals that would change a task. */
export const proposalsFor = (doc: Doc, taskId: string, now: Date): Proposal[] =>
  pendingProposals(doc, now).filter((p) => p.changes.some((c) => changeTask(c) === taskId));
