import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { applyChanges, describeChange, type Change } from '../mcp/src/changes';
import { eventToZone, realTimes, wallClock } from '../mcp/src/clock';
import { memoryProposals } from '../mcp/src/proposals';
import { createServer } from '../mcp/src/tools';
import { Workspace } from '../mcp/src/workspace';
import { dayOf } from '../src/model/dates';
import { addTask, emptyDoc, liveTasks, setSettings, type Ctx } from '../src/model/doc';
import type { Doc } from '../src/model/types';
import { ConflictError, MemoryRemote } from '../src/store/sync';

const TZ = 'America/Chicago';
const REAL = new Date('2026-09-29T15:00:00.000Z'); // 10:00 on Tuesday 29 September in Chicago
const wallCtx = (): Ctx => ({ now: wallClock(TZ, REAL), device: 'phone' });

function seed(): Doc {
  let d = emptyDoc(wallCtx());
  const add = (title: string, extra = {}) => ([d] = addTask(d, wallCtx(), { title, ...extra }));
  add('交论文', { due: '2026-09-28', effort: 90 });
  add('读文献', { star: true });
  add('回邮件');
  return d;
}

async function connect(remote: MemoryRemote, canWrite = true, fetcher?: typeof fetch) {
  const proposals = memoryProposals();
  const workspace = new Workspace(remote, TZ, { clock: () => REAL, fetcher, device: 'ai' });
  const server = createServer({ workspace, proposals, origin: 'https://todo.example', client: 'Test AI', canWrite });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const raw = res.content[0].text;
    return { error: !!res.isError, raw, body: res.isError ? null : JSON.parse(raw) };
  };
  return { call, proposals, client };
}

describe('the owner’s clock in a UTC Worker', () => {
  it('reads wall-clock fields in the owner’s zone and saves real instants', () => {
    const wall = wallClock(TZ, REAL);
    expect([dayOf(wall), wall.getHours(), wall.getMinutes()]).toEqual(['2026-09-29', 10, 0]);
    const doc = { created: wall.toISOString(), s: { at: wall.toISOString() } } as unknown as Doc;
    expect(realTimes(doc, wall, REAL)).toEqual({ created: REAL.toISOString(), s: { at: REAL.toISOString() } });
  });

  it('moves a timed calendar event into the owner’s zone', () => {
    const instant = new Date('2026-09-29T18:30:00Z'); // 13:30 in Chicago
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = { day: dayOf(instant), start: `${pad(instant.getHours())}:${pad(instant.getMinutes())}` };
    const e = eventToZone({ id: 'e', title: 'Seminar', ...local, end: local.start }, TZ);
    expect([e.day, e.start]).toEqual(['2026-09-29', '13:30']);
    const allDay = { id: 'h', title: 'Holiday', day: '2026-10-12', start: '00:00', end: '23:59', allDay: true };
    expect(eventToZone(allDay, TZ)).toEqual(allDay);
  });
});

describe('MCP tools', () => {
  it('lists the tools, says what to do now, lists and gets tasks', async () => {
    const remote = new MemoryRemote();
    remote.doc = seed();
    const { call, client } = await connect(remote);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'add_task',
      'agenda',
      'get_proposal',
      'get_task',
      'list_areas_and_projects',
      'list_tasks',
      'propose_changes',
      'what_now',
    ]);
    const now = await call('what_now');
    expect(now.body.now).toContain('2026-09-29 10:00');
    expect(now.body.do_now.title).toBe('交论文');
    expect(now.body.do_now.why).toBe('overdue by 1 day');
    const due = await call('list_tasks', { filter: 'due' });
    expect(due.body.tasks.map((t: { title: string }) => t.title)).toEqual(['交论文']);
    const found = await call('list_tasks', { query: '文献' });
    expect(found.body.tasks[0]).toMatchObject({ title: '读文献', important: true });
    const one = await call('get_task', { id: found.body.tasks[0].id });
    expect(one.body.link).toBe(`https://todo.example/?open=${found.body.tasks[0].id}`);
    expect((await call('get_task', { id: 'nope' })).error).toBe(true);
  });

  it('adds a task at once, with the app’s quick words, in the owner’s time, stamped with the real instant', async () => {
    const remote = new MemoryRemote();
    remote.doc = seed();
    const { call } = await connect(remote);
    const res = await call('add_task', { text: '周五交表格 2小时 !', steps: ['填数', '签字'], area: '研究' });
    expect(res.body.saved).toBe(true);
    const t = liveTasks(remote.doc!).find((x) => x.title === '交表格')!;
    expect(t).toMatchObject({ due: '2026-10-02', effort: 120, star: true, created: REAL.toISOString() });
    expect(t.steps.map((s) => s.text)).toEqual(['填数', '签字']);
    expect(remote.doc!.areas[t.areaId!].name).toBe('研究');
    expect(t.s.by).toBe('ai');
  });

  it('proposes changes without making them; approving applies them all', async () => {
    const remote = new MemoryRemote();
    remote.doc = seed();
    const { call, proposals } = await connect(remote);
    const paper = liveTasks(remote.doc).find((x) => x.title === '交论文')!;
    const changes: Change[] = [
      { type: 'update', task_id: paper.id, due: '2026-10-05', star: true },
      { type: 'plan', task_id: paper.id, day: '2026-09-30', start: '14:00' },
    ];
    const res = await call('propose_changes', { summary: '推迟论文并安排时间', changes });
    expect(res.body).toMatchObject({ status: 'pending', review_link: expect.stringMatching(/\/api\/ai\/review\//) });
    expect(remote.writes).toBe(0);
    const p = (await proposals.get(res.body.proposal_id))!;
    const zh = (a: string) => a;
    expect(describeChange(remote.doc!, p.changes[0], zh)).toBe(
      '修改 「交论文」：截止：9/28（周一） → 10/5（周一）；标为重要',
    );
    expect(describeChange(remote.doc!, p.changes[1], zh)).toBe('安排 「交论文」 在 9/30（周三） 14:00，1 小时 30 分钟');
    const after = applyChanges(remote.doc!, wallCtx(), p.changes);
    expect(after.tasks[paper.id]).toMatchObject({ due: '2026-10-05', star: true });
    expect(after.tasks[paper.id].plan[0]).toMatchObject({ day: '2026-09-30', start: '14:00', minutes: 90 });
    expect((await call('get_proposal', { id: p.id })).body.status).toBe('pending');
    expect(() => applyChanges(remote.doc!, wallCtx(), [{ type: 'complete', task_id: 'gone' }])).toThrow();
  });

  it('a read-only connection cannot add or propose', async () => {
    const remote = new MemoryRemote();
    remote.doc = seed();
    const { call } = await connect(remote, false);
    expect((await call('add_task', { text: '不该保存' })).error).toBe(true);
    expect(remote.writes).toBe(0);
  });

  it('reads subscribed calendars into the agenda, in the owner’s time', async () => {
    const remote = new MemoryRemote();
    remote.doc = setSettings(seed(), wallCtx(), {
      calendars: [{ id: 'c', name: '课表', url: 'webcal://cal.example/a.ics' }],
    });
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:1',
      'SUMMARY:Numerical Methods',
      'DTSTART:20260929T183000Z',
      'DTEND:20260929T192000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const asked: string[] = [];
    const fetcher = (async (url: string) => (asked.push(url), new Response(ics))) as unknown as typeof fetch;
    const { call } = await connect(remote, true, fetcher);
    const res = await call('agenda', { start: '2026-09-29' });
    expect(asked).toEqual(['https://cal.example/a.ics']);
    expect(res.body[0].events).toEqual([{ title: 'Numerical Methods', time: '13:30–14:20' }]);
    expect(res.body[0].deadlines).toBeUndefined();
  });

  it('retries when another device saves in between', async () => {
    const remote = new MemoryRemote();
    remote.doc = seed();
    let first = true;
    const flaky = {
      read: () => remote.read(),
      write: async (doc: Doc, version?: string) => {
        if (first) {
          first = false;
          throw new ConflictError();
        }
        return remote.write(doc, version);
      },
    };
    const ws = new Workspace(flaky, TZ, { clock: () => REAL });
    await ws.change((d, ctx) => [addTask(d, ctx, { title: '再试一次' })[0], null]);
    expect(liveTasks(remote.doc!).some((t) => t.title === '再试一次')).toBe(true);
  });
});

describe('the browser pages', () => {
  it('keep the Origin header on their own form posts (no "no-referrer"), and cannot be framed', async () => {
    const { page } = await import('../mcp/src/pages');
    const res = page('连接 AI', '<form method="post"></form>');
    expect(res.headers.get('Referrer-Policy')).toBe('same-origin');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
});
