import { taskFromText } from '../../src/model/capture';
import { addTask } from '../../src/model/doc';
import type { Workspace } from './workspace';

/**
 * The capture link: a personal address that writes one line into the list without opening the app, for an iPhone
 * Shortcut (and so Siri), a launcher or a script. It can only add tasks; it cannot read anything. One link at a time:
 * making a new one, or turning it off, ends the old one. Only a hash of the key is stored.
 */
export const CAPTURE_KEY_PREFIX = 'ap-capture:';
export const CAPTURE_CURRENT = 'ap-capture-current';

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The line to write down, from a query (`text=`), a form, JSON (`{"text": …}`) or a plain-text body. */
export async function lineFrom(request: Request): Promise<string> {
  const url = new URL(request.url);
  const query = url.searchParams.get('text');
  if (query) return query;
  if (request.method !== 'POST') return '';
  const type = request.headers.get('Content-Type') ?? '';
  if (type.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as { text?: unknown };
    return typeof body.text === 'string' ? body.text : '';
  }
  if (type.includes('form')) return String((await request.formData()).get('text') ?? '');
  return (await request.text()).slice(0, 2000);
}

/** Write one line down as a task; returns its title, or null when the line was empty. */
export async function captureLine(ws: Workspace, line: string): Promise<string | null> {
  const text = line.trim().slice(0, 500);
  if (!text) return null;
  return ws.change((doc, ctx) => {
    const input = taskFromText(text, ctx.now);
    if (!input) return [doc, null];
    return [addTask(doc, ctx, input)[0], input.title];
  });
}
