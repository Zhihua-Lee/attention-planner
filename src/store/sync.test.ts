import { describe, expect, it } from 'vitest';
import { addTask, emptyDoc, setField } from '../model/doc';
import type { Doc } from '../model/types';
import { stable } from '../model/merge';
import { DriveRemote } from './drive';
import { ConflictError, MemoryRemote, syncOnce, type Remote } from './sync';

const now = new Date(2026, 8, 29, 10);
const ctx = (device: string) => ({ now, device });

describe('sync', () => {
  it('two devices converge through the remote', async () => {
    const remote = new MemoryRemote();
    let [a, id] = addTask(emptyDoc(ctx('a')), ctx('a'), { title: 'Report' });
    a = await syncOnce(a, remote, now);
    let b = await syncOnce(emptyDoc(ctx('b')), remote, now);
    expect(b.tasks[id].title).toBe('Report');
    a = setField(a, ctx('a'), id, 'star', true);
    b = setField(b, ctx('b'), id, 'due', '2026-10-02');
    a = await syncOnce(a, remote, now);
    b = await syncOnce(b, remote, now);
    a = await syncOnce(a, remote, now);
    expect(a.tasks[id]).toMatchObject({ star: true, due: '2026-10-02' });
    expect(stable(a.tasks)).toBe(stable(b.tasks));
  });

  it('does not write when nothing changed', async () => {
    const remote = new MemoryRemote();
    const [a] = addTask(emptyDoc(ctx('a')), ctx('a'), { title: 'x' });
    await syncOnce(a, remote, now);
    await syncOnce(a, remote, now);
    expect(remote.writes).toBe(1);
  });

  it('retries after a concurrent write and keeps both changes', async () => {
    const remote = new MemoryRemote();
    const [other] = addTask(emptyDoc(ctx('b')), ctx('b'), { title: 'From B' });
    let raced = false;
    const racing: Remote = {
      read: () => remote.read(),
      write: async (doc, version) => {
        if (!raced) {
          raced = true;
          await remote.write(other); // another device saves between our read and write
        }
        return remote.write(doc, version);
      },
    };
    const [mine] = addTask(emptyDoc(ctx('a')), ctx('a'), { title: 'From A' });
    const merged = await syncOnce(mine, racing, now);
    expect(
      Object.values(merged.tasks)
        .map((t) => t.title)
        .sort(),
    ).toEqual(['From A', 'From B']);
    expect(Object.values(remote.doc!.tasks)).toHaveLength(2);
  });

  it('never uploads device-local calendar events', async () => {
    const remote = new MemoryRemote();
    const local: Doc = {
      ...emptyDoc(ctx('a')),
      events: [{ id: 'e', title: 'Class', day: '2026-09-29', start: '09:00', end: '10:00' }],
    };
    const merged = await syncOnce(local, remote, now);
    expect(remote.doc!.events).toBeUndefined();
    expect(merged.events).toHaveLength(1);
  });
});

describe('Google Drive remote', () => {
  it('uses a new file, conditional writes and maps 412 to a conflict', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let stored = '';
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes('/drive/v3/files?spaces')) return json({ files: stored ? [{ id: 'f1' }] : [] });
      if (url.includes('uploadType=multipart')) return ((stored = String(init!.body)), json({ id: 'f1' }));
      if (url.includes('/drive/v2/files/f1?fields=etag')) return json({ etag: '"e1"' });
      if (url.includes('alt=media')) return json(emptyDoc(ctx('a')));
      if (url.includes('/upload/drive/v2/files/f1')) {
        return (init!.headers as Record<string, string>)['If-Match'] === '"stale"'
          ? json({}, 412)
          : json({ etag: '"e2"' });
      }
      return json({}, 404);
    }) as typeof fetch;
    const drive = new DriveRemote(async () => 'token', fake);
    expect((await drive.read()).doc).toBeNull();
    await drive.write(emptyDoc(ctx('a')));
    expect(stored).toContain('attention-planner-v3.json');
    expect((await drive.read()).version).toBe('"e1"');
    await expect(drive.write(emptyDoc(ctx('a')), '"stale"')).rejects.toBeInstanceOf(ConflictError);
    expect(calls.every((c) => (c.init?.headers as Record<string, string>).Authorization === 'Bearer token')).toBe(true);
  });
});

describe('sync broker tokens', () => {
  it('posts to the broker once and reuses the token until it nearly expires', async () => {
    const { brokerTokens } = await import('./drive');
    let calls = 0;
    const fake = (async (url: string, init?: RequestInit) => {
      calls++;
      expect(url).toBe('/api/google/token');
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ accessToken: 'abc', expiresIn: 3600 }));
    }) as typeof fetch;
    const tokens = brokerTokens('/api/', fake);
    expect(await tokens()).toBe('abc');
    expect(await tokens()).toBe('abc');
    expect(calls).toBe(1);
  });
});

describe('Outlook export in Google Drive', () => {
  it('finds the file by its marker and returns its JSON, or null when there is none', async () => {
    const { readOutlookExport } = await import('./drive');
    let files: { id: string }[] = [];
    const fake = (async (url: string) => {
      if (url.includes('/files?')) {
        expect(decodeURIComponent(url)).toContain("key='attentionPlannerRole' and value='outlookCalendarExport'");
        return new Response(JSON.stringify({ files }));
      }
      return new Response(JSON.stringify({ events: [{ subject: 'x' }] }));
    }) as typeof fetch;
    expect(await readOutlookExport(async () => 't', fake)).toBeNull();
    files = [{ id: 'f' }];
    expect(await readOutlookExport(async () => 't', fake)).toEqual({ events: [{ subject: 'x' }] });
  });
});

describe('concurrent text edits', () => {
  it('keeps the other version when two devices edit the same note without seeing each other', async () => {
    const { openConflict, resolveConflict } = await import('../model/doc');
    const remote = new MemoryRemote();
    let [a, id] = addTask(emptyDoc(ctx('a')), ctx('a'), { title: 'Report', note: 'v1' });
    a = await syncOnce(a, remote, now);
    let b = await syncOnce(emptyDoc(ctx('b')), remote, now);
    a = setField(a, ctx('a'), id, 'note', 'from A');
    b = setField(b, ctx('b'), id, 'note', 'from B');
    a = await syncOnce(a, remote, now);
    b = await syncOnce(b, remote, now);
    a = await syncOnce(a, remote, now);
    const shownB = b.tasks[id].note;
    const other = openConflict(b.tasks[id], 'note')?.value;
    expect([shownB, other].sort()).toEqual(['from A', 'from B']);
    expect(openConflict(a.tasks[id], 'note')?.value).toBe(other);
    b = resolveConflict(b, ctx('b'), id, 'note', 'other');
    expect(b.tasks[id].note).toBe(other);
    b = await syncOnce(b, remote, now);
    a = await syncOnce(a, remote, now);
    expect(a.tasks[id].note).toBe(other);
    expect(openConflict(a.tasks[id], 'note')).toBeUndefined();
  });

  it('does not flag edits made one after another', async () => {
    const { openConflict } = await import('../model/doc');
    const remote = new MemoryRemote();
    let [a, id] = addTask(emptyDoc(ctx('a')), ctx('a'), { title: 'Report', note: 'v1' });
    a = await syncOnce(a, remote, now);
    let b = await syncOnce(emptyDoc(ctx('b')), remote, now);
    a = setField(a, ctx('a'), id, 'note', 'v2 from A');
    a = await syncOnce(a, remote, now);
    b = await syncOnce(b, remote, now);
    b = setField(b, ctx('b'), id, 'note', 'v3 from B');
    b = await syncOnce(b, remote, now);
    a = await syncOnce(a, remote, now);
    expect(a.tasks[id].note).toBe('v3 from B');
    expect(openConflict(a.tasks[id], 'note')).toBeUndefined();
    expect(openConflict(b.tasks[id], 'note')).toBeUndefined();
  });
});
