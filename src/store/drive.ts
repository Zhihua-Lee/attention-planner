import type { Doc } from '../model/types';
import { ConflictError, type Remote } from './sync';

/**
 * The document as one JSON file in Google Drive's hidden app folder.
 * It is a new file (`attention-planner-v3.json`); the previous app's file is never written.
 * Writes are conditional on the file's ETag, so two devices cannot overwrite each other.
 */
export const DRIVE_FILE = 'attention-planner-v3.json';

export type TokenSource = () => Promise<string>;

/**
 * Access tokens from the sync broker, which keeps the Google refresh token server-side.
 * The broker lives on the app's own origin (`/api`), accepts same-origin POSTs only, and returns
 * `{ accessToken, expiresIn }`. Tokens are reused until a minute before they expire.
 */
export const trimSlash = (s: string) => (s.endsWith('/') ? s.slice(0, -1) : s);

export function brokerTokens(base: string, fetcher: typeof fetch = fetch.bind(globalThis)): TokenSource {
  let cached: { token: string; until: number } | null = null;
  return async () => {
    if (cached && Date.now() < cached.until) return cached.token;
    const res = await fetcher(`${trimSlash(base)}/google/token`, { method: 'POST', credentials: 'same-origin' });
    if (res.status === 401 || res.status === 403) throw new Error('Sign in to Google Drive again.');
    if (!res.ok) throw new Error(`The sync broker answered ${res.status}.`);
    const body = (await res.json()) as { accessToken?: string; access_token?: string; expiresIn?: number };
    const token = body.accessToken ?? body.access_token;
    if (!token) throw new Error('The sync broker returned no access token.');
    cached = { token, until: Date.now() + Math.max(60, (body.expiresIn ?? 3600) - 60) * 1000 };
    return token;
  };
}

/** Whether this browser is signed in to the broker and Google Drive is connected. */
export async function brokerStatus(
  base: string,
): Promise<'connected' | 'signed-out' | 'not-connected' | 'unavailable'> {
  try {
    const res = await fetch(`${trimSlash(base)}/google/status`, { credentials: 'same-origin' });
    if (res.status === 401 || res.status === 403) return 'signed-out';
    if (!res.ok) return 'unavailable';
    const body = (await res.json()) as { connected?: boolean };
    return body.connected ? 'connected' : 'not-connected';
  } catch {
    return 'unavailable';
  }
}

export class DriveRemote implements Remote {
  private fileId: string | null = null;
  constructor(
    private token: TokenSource,
    private fetcher: typeof fetch = fetch.bind(globalThis),
  ) {}

  private async call(url: string, init: RequestInit = {}) {
    const token = await this.token();
    const res = await this.fetcher(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 412) throw new ConflictError();
    if (!res.ok) throw new Error(`Google Drive answered ${res.status}.`);
    return res;
  }

  private async findFile(): Promise<string | null> {
    if (this.fileId) return this.fileId;
    const q = encodeURIComponent(`name='${DRIVE_FILE}' and trashed=false`);
    const res = await this.call(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`,
    );
    const { files } = (await res.json()) as { files: { id: string }[] };
    this.fileId = files[0]?.id ?? null;
    return this.fileId;
  }

  async read() {
    const id = await this.findFile();
    if (!id) return { doc: null };
    const meta = await this.call(`https://www.googleapis.com/drive/v2/files/${id}?fields=etag`);
    const { etag } = (await meta.json()) as { etag: string };
    const body = await this.call(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    const doc = (await body.json()) as Doc;
    if (doc?.v !== 1) throw new Error('The Drive file is not an Attention Planner document.');
    return { doc, version: etag };
  }

  async write(doc: Doc, version?: string) {
    const id = await this.findFile();
    const body = JSON.stringify(doc);
    if (!id) {
      const boundary = 'ap' + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({ name: DRIVE_FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
      const res = await this.call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`,
      });
      this.fileId = ((await res.json()) as { id: string }).id;
      return { version: '' };
    }
    const res = await this.call(`https://www.googleapis.com/upload/drive/v2/files/${id}?uploadType=media`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(version ? { 'If-Match': version } : {}) },
      body,
    });
    const { etag } = (await res.json()) as { etag: string };
    return { version: etag };
  }
}

/**
 * The Outlook calendar export that a Power Automate flow keeps up to date in Google Drive.
 * The file was created by this sync broker's Google client (marked with an app property), so the same
 * `drive.file` permission can read it. Returns null when there is no such file.
 */
export async function readOutlookExport(
  token: TokenSource,
  fetcher: typeof fetch = fetch.bind(globalThis),
): Promise<unknown | null> {
  const auth = { Authorization: `Bearer ${await token()}` };
  const q = encodeURIComponent(
    "appProperties has { key='attentionPlannerRole' and value='outlookCalendarExport' } and trashed = false",
  );
  const list = await fetcher(
    `https://www.googleapis.com/drive/v3/files?spaces=drive&orderBy=modifiedTime%20desc&pageSize=1&fields=files(id)&q=${q}`,
    { headers: auth },
  );
  if (!list.ok) throw new Error(`Google Drive answered ${list.status}.`);
  const id = ((await list.json()) as { files?: { id: string }[] }).files?.[0]?.id;
  if (!id) return null;
  const body = await fetcher(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: auth });
  if (!body.ok) throw new Error(`Google Drive answered ${body.status}.`);
  return body.json();
}
