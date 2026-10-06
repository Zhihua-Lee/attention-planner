import type { NewTask } from './doc';
import { parseCapture } from './parse';
import type { Repeat } from './types';

/**
 * A task from one line of text, read the way the capture box reads it: dates, times, lengths, "!" and repeats come
 * out of the title. A repeat with a deadline makes a new copy each time; without one, the task reopens in place.
 * Used by links that add a task (`/?add=…`, the share sheet, the capture link) so they match the box exactly.
 */
export function taskFromText(text: string, now: Date): NewTask | null {
  const p = parseCapture(text, now);
  const title = (p.title || text).trim();
  if (!title) return null;
  const due = p.due;
  const said = typeof p.repeat === 'object' ? p.repeat : undefined;
  const repeat: Repeat | undefined = said
    ? { mode: due ? 'copy' : 'reopen', rule: { ...said, start: due ?? p.plan?.day ?? said.start } }
    : undefined;
  return {
    title,
    ...(due ? { due } : {}),
    ...(p.effort ? { effort: p.effort } : {}),
    ...(p.star ? { star: true } : {}),
    ...(repeat ? { repeat } : {}),
    plan: p.plan ? [{ ...p.plan, ...(p.plan.start ? { minutes: Math.min(p.effort ?? 60, 120) } : {}) }] : [],
  };
}
