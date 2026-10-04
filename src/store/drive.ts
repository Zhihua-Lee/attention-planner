import type { Doc } from '../model/types';
import { ConflictError, type Remote } from './sync';

/**
 * The document as one JSON file in Google Drive's hidden app folder.
 * It is a new file (`attention-planner-v3.json`); the previous app's file is never written.
 * Writes are conditional on the file's ETag, so two devices cannot overwrite each other.
 */
export const DRIVE_FILE = 'attention-planner-v3.json';

export type TokenSource = () => Promise<string>;

/** Access tokens from the sync broker, which keeps the Google refresh token server-side. */
export function brokerTokens(base: string): TokenSource {
  return async () => {
    const res = await fetch(`${base.replace(/\/$/, '')}/google/token`, { credentials: 'include' });
    if (res.status === 401 || res.status === 403) throw new Error('Sign in to Google Drive again.');
    if (!res.ok) throw new Error(`The sync broker answered ${res.status}.`);
    const body = (await res.json()) as { access_token?: string; accessToken?: string };
    const token = body.access_token ?? body.accessToken;
    if (!token) throw new Error('The sync broker returned no access token.');
    return token;
  };
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
