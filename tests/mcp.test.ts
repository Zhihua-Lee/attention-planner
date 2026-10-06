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
      'find_time',
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

  it('proposes changes without making them; the app approves them all, or rejects them', async () => {
    const { decideProposal, pendingProposals, proposalsFor } = await import('../src/model/proposals');
    const remote = new MemoryRemote();
    remote.doc = seed();
    const { call } = await connect(remote);
    const paper = liveTasks(remote.doc).find((x) => x.title === '交论文')!;
    const changes: Change[] = [
      { type: 'update', task_id: paper.id, due: '2026-10-05', star: true },
      { type: 'plan', task_id: paper.id, day: '2026-09-30', start: '14:00' },
    ];
    const res = await call('propose_changes', { summary: '推迟论文并安排时间', changes });
    expect(res.body).toMatchObject({
      status: 'pending',
      review_link: `https://todo.example/?proposal=${res.body.proposal_id}`,
    });
    // Kept with the tasks; the task itself is unchanged until approved.
    const doc = remote.doc!;
    expect(doc.tasks[paper.id]).toMatchObject({ due: '2026-09-28' });
    expect(pendingProposals(doc, REAL).map((x) => x.summary)).toEqual(['推迟论文并安排时间']);
    expect(proposalsFor(doc, paper.id, REAL)).toHaveLength(1);
    const p = doc.proposals![res.body.proposal_id];
    expect(p).toMatchObject({ client: 'Test AI', status: 'pending', created: REAL.toISOString() });
    const zh = (a: string) => a;
    expect(describeChange(doc, p.changes[0], zh)).toBe('修改 「交论文」：截止：9/28（周一） → 10/5（周一）；标为重要');
    expect(describeChange(doc, p.changes[1], zh)).toBe('安排 「交论文」 在 9/30（周三） 14:00，1 小时 30 分钟');
    const approved = decideProposal(doc, wallCtx(), p.id, true);
    expect(approved.tasks[paper.id]).toMatchObject({ due: '2026-10-05', star: true });
    expect(approved.tasks[paper.id].plan[0]).toMatchObject({ day: '2026-09-30', start: '14:00', minutes: 90 });
    expect(approved.proposals![p.id].status).toBe('applied');
    const rejected = decideProposal(doc, wallCtx(), p.id, false);
    expect(rejected.tasks[paper.id].due).toBe('2026-09-28');
    expect(rejected.proposals![p.id].status).toBe('rejected');
    expect((await call('get_proposal', { id: p.id })).body.status).toBe('pending');
    // A change that can no longer be applied leaves everything as it was and says why.
    const gone = {
      ...doc,
      proposals: { x: { ...p, id: 'x', changes: [{ type: 'complete' as const, task_id: 'gone' }] } },
    };
    const failed = decideProposal(gone, wallCtx(), 'x', true);
    expect(failed.proposals!.x).toMatchObject({ status: 'failed', error: 'There is no task gone.' });
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

describe('add_task repeats', () => {
  it('a repeat in words becomes the task’s repeat, the same way the app reads it', async () => {
    const remote = new MemoryRemote();
    remote.doc = seed();
    const { call } = await connect(remote);
    await call('add_task', { text: '每周五交周报' });
    await call('add_task', { text: '每天 看邮件' });
    const byTitle = (title: string) => liveTasks(remote.doc!).find((x) => x.title === title)!;
    expect(byTitle('交周报')).toMatchObject({
      due: '2026-10-02',
      repeat: { mode: 'copy', rule: { freq: 'weekly', weekdays: [5], start: '2026-10-02' } },
    });
    expect(byTitle('看邮件').repeat).toMatchObject({ mode: 'reopen', rule: { freq: 'daily', every: 1 } });
  });
});

describe('the full set of operations', () => {
  it('reads and makes links; adds a task with an explicit repeat', async () => {
    const remote = new MemoryRemote();
    remote.doc = seed();
    const { call } = await connect(remote);
    const paper = liveTasks(remote.doc).find((x) => x.title === '交论文')!;
    const res = await call('add_task', {
      text: '画图',
      link_to: paper.id,
      repeat: { mode: 'reopen', rule: { freq: 'weekly', weekdays: [1, 3] } },
    });
    expect(res.body.task).toMatchObject({ linked_to: { id: paper.id, title: '交论文' } });
    const fig = liveTasks(remote.doc!).find((x) => x.title === '画图')!;
    expect(fig.repeat).toMatchObject({ mode: 'reopen', rule: { freq: 'weekly', weekdays: [1, 3], every: 1 } });
    const back = await call('get_task', { id: paper.id });
    expect(back.body.linked_here).toEqual([{ id: fig.id, title: '画图' }]);
    expect((await call('add_task', { text: 'x', link_to: 'nope' })).error).toBe(true);
  });

  it('proposes and applies step, plan, link, repeat and project changes, with words for each', async () => {
    const { addStep, addPlan, addProject } = await import('../src/model/doc');
    const remote = new MemoryRemote();
    let d = seed();
    const paper = liveTasks(d).find((x) => x.title === '交论文')!;
    const mail = liveTasks(d).find((x) => x.title === '回邮件')!;
    d = addStep(d, wallCtx(), paper.id, '写摘要');
    d = addStep(d, wallCtx(), paper.id, '画图');
    d = addPlan(d, wallCtx(), paper.id, { day: '2026-09-30', part: 'am' });
    [d] = addProject(d, wallCtx(), '论文');
    remote.doc = d;
    const [abstract, figure] = liveTasks(d).find((x) => x.id === paper.id)!.steps;
    const plan = d.tasks[paper.id].plan[0];
    const changes: Change[] = [
      { type: 'edit_step', task_id: paper.id, step_id: abstract.id, due: '2026-10-01', effort_minutes: 45 },
      { type: 'promote_step', task_id: paper.id, step_id: figure.id },
      { type: 'move_plan', task_id: paper.id, plan_id: plan.id, start: '14:00', minutes: 60 },
      { type: 'link', task_id: mail.id, to: paper.id },
      { type: 'set_repeat', task_id: mail.id, repeat: { mode: 'reopen', rule: { freq: 'daily' } } },
      { type: 'update_project', project: '论文', name: '毕业论文', one_after_another: true },
    ];
    const zh = (a: string) => a;
    expect(changes.map((c) => describeChange(d, c, zh))).toEqual([
      '修改 「交论文」 的步骤 「写摘要」：截止：无 → 10/1（周四）；用时：无 → 45 分钟',
      '把 「交论文」 的步骤 「画图」 独立成任务',
      '把 「交论文」 的安排从 9/30（周三） 上午 改到 9/30（周三） 14:00，1 小时',
      '把 「回邮件」 关联到「交论文」',
      '「回邮件」 改为重复：每天，原地重开',
      '项目 「论文」：改名为「毕业论文」；按顺序做',
    ]);
    const after = applyChanges(d, wallCtx(), changes);
    const p = after.tasks[paper.id];
    expect(p.steps.find((s) => s.id === abstract.id)).toMatchObject({ due: '2026-10-01', effort: 45 });
    expect(p.steps.find((s) => s.id === figure.id)!.deleted).toBe(true);
    expect(liveTasks(after).some((t) => t.title === '画图' && t.linkTo === paper.id)).toBe(true);
    expect(p.plan[0]).toMatchObject({ day: '2026-09-30', start: '14:00', minutes: 60 });
    expect(p.plan[0].part).toBeUndefined();
    expect(after.tasks[mail.id]).toMatchObject({
      linkTo: paper.id,
      repeat: { mode: 'reopen', rule: { freq: 'daily' } },
    });
    expect(Object.values(after.projects)[0]).toMatchObject({ name: '毕业论文', sequential: true });
    // A wrong id is reported when proposing, not on approval.
    const { call } = await connect(remote);
    const bad = await call('propose_changes', {
      summary: 'x',
      changes: [{ type: 'remove_step', task_id: paper.id, step_id: 'nope' }],
    });
    expect(bad).toMatchObject({ error: true, raw: 'There is no step nope.' });
  });
});

describe('notifying the owner', () => {
  it('a new proposal asks for a notification with only its id', async () => {
    const remote = new MemoryRemote();
    remote.doc = seed();
    const sent: string[] = [];
    const workspace = new Workspace(remote, TZ, { clock: () => REAL });
    const server = createServer({
      workspace,
      proposals: memoryProposals(),
      origin: 'https://todo.example',
      client: 'Test AI',
      canWrite: true,
      notify: async (id) => void sent.push(id),
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(b);
    const paper = liveTasks(remote.doc).find((x) => x.title === '交论文')!;
    const res = (await client.callTool({
      name: 'propose_changes',
      arguments: { summary: 's', changes: [{ type: 'complete', task_id: paper.id }] },
    })) as { content: { text: string }[] };
    expect(sent).toEqual([JSON.parse(res.content[0].text).proposal_id]);
  });
});

describe('the long-term goal', () => {
  it('what_now gives the AI the goal when there is one', async () => {
    const remote = new MemoryRemote();
    remote.doc = setSettings(seed(), wallCtx(), { goal: '做出能被用起来的科研\n身体健康地读完博士' });
    const { call } = await connect(remote);
    expect((await call('what_now')).body.long_term_goal).toBe('做出能被用起来的科研\n身体健康地读完博士');
    remote.doc = setSettings(remote.doc!, wallCtx(), { goal: undefined });
    expect((await call('what_now')).body.long_term_goal).toBeUndefined();
  });
});
