import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import * as z from 'zod';
import { addDays, dayOf, isoWeekday, nowMinutes, timeOf } from '../../src/model/dates';
import {
  capacity,
  findTimes,
  stillToReserve,
  agenda as dayAgenda,
  eventsOn,
  finishedTasks,
  listTasks,
  nowCandidates,
  queuePosition,
  stepProgress,
  type Filter,
  type Reason,
} from '../../src/model/derive';
import {
  addTask,
  effectiveDue,
  inRounds,
  isFinished,
  isSnoozed,
  liveTasks,
  planOf,
  stepDone,
  stepsOf,
  taskEffort,
} from '../../src/model/doc';
import { parseCapture } from '../../src/model/parse';
import type { CalendarEvent, Doc, Task } from '../../src/model/types';
import { changeSchema, daySchema, partSchema, resolveGroup, timeSchema } from './changes';
import { isExpired, randomId, type ProposalStore } from './proposals';
import type { Workspace } from './workspace';

export type ToolContext = {
  workspace: Workspace;
  proposals: ProposalStore;
  /** Where the app lives, for links back to it. */
  origin: string;
  /** The AI client, as it named itself when it connected. */
  client: string;
  /** Whether this connection may add tasks and propose changes. */
  canWrite: boolean;
};

const INSTRUCTIONS = `Attention Planner is one person's to-do list that plans itself: they write things down and do them; it
remembers, orders and reminds. Every unfinished task is in one list. A task may have a deadline (due), plans (a day, a
part of a day, or a reserved time), an effort estimate, an "important" star, a snooze (until a day, with a reason),
steps, and a repeat. "what_now" answers what to do at this moment. Days are YYYY-MM-DD and times HH:MM in the owner's
time zone. New tasks are saved at once. Changes to existing tasks are proposals: the owner approves them in the browser,
so give them the review link that propose_changes returns, and do not claim a change is made until get_proposal says so.`;

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const clean = <T extends object>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== false && v !== '' && !(Array.isArray(v) && !v.length)),
  ) as T;
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

function reasonWords(r: Reason): string {
  switch (r.kind) {
    case 'slot':
      return `reserved time now, until ${r.until}`;
    case 'part':
      return `planned for this ${{ am: 'morning', pm: 'afternoon', eve: 'evening' }[r.part]}`;
    case 'overdue':
      return `overdue by ${r.days} day${r.days === 1 ? '' : 's'}${r.step ? ` (step: ${r.step})` : ''}`;
    case 'dueToday':
      return `due today${r.step ? ` (step: ${r.step})` : ''}`;
    case 'today':
      return 'planned for today';
    case 'star':
      return 'important';
    case 'oldest':
      return 'waiting longest';
  }
}

const groupName = (doc: Doc, kind: 'areas' | 'projects', id?: string) =>
  id && !doc[kind][id]?.deleted ? doc[kind][id]?.name : undefined;

/** A task in a list: enough to choose, without the note or each step. */
export function brief(doc: Doc, t: Task, now: Date) {
  const today = dayOf(now);
  const due = effectiveDue(t, now);
  const steps = stepProgress(t, now);
  return clean({
    id: t.id,
    title: t.title,
    due: t.due,
    due_time: t.dueTime,
    earlier_step_deadline: due && due.step ? { day: due.day, step: due.step.text } : undefined,
    effort_minutes: taskEffort(t),
    important: !!t.star,
    snoozed: isSnoozed(t, today)
      ? clean({ until: t.snooze?.until ?? 'further notice', reason: t.snooze?.reason })
      : undefined,
    area: groupName(doc, 'areas', t.areaId),
    project: groupName(doc, 'projects', t.projectId),
    waiting_in_project_queue: queuePosition(doc, t, now) > 0,
    plans: planOf(t).length
      ? planOf(t).map((p) => clean({ id: p.id, day: p.day, part: p.part, start: p.start, minutes: p.minutes }))
      : undefined,
    steps: steps.total ? `${steps.done}/${steps.total} done` : undefined,
    next_step: steps.next?.text,
    repeat: t.repeat
      ? `${t.repeat.rule.freq}${t.repeat.rule.every > 1 ? ` (every ${t.repeat.rule.every})` : ''}, ${t.repeat.mode === 'reopen' ? 'reopens in place' : 'a new copy each time'}${t.repeat.paused ? ', paused' : ''}`
      : undefined,
    finished: isFinished(t, now) ? (t.done ?? 'this round') : undefined,
  });
}

/** One task in full. */
export function full(doc: Doc, t: Task, now: Date, origin: string) {
  return clean({
    ...brief(doc, t, now),
    note: t.note,
    created: t.created,
    steps: stepsOf(t).map((s) =>
      clean({ id: s.id, text: s.text, done: stepDone(t, s, now), due: s.due, effort_minutes: s.effort }),
    ),
    two_versions_of: t.conflicts && Object.keys(t.conflicts).length ? Object.keys(t.conflicts) : undefined,
    link: `${origin}/?open=${encodeURIComponent(t.id)}`,
  });
}

const eventWords = (e: CalendarEvent) =>
  clean({ title: e.title, time: e.allDay ? 'all day' : `${e.start}–${e.end}`, location: e.location });

const FILTERS = ['all', 'today', 'soon', 'due', 'new', 'snoozed'] as const;

export function createServer(c: ToolContext): McpServer {
  const server = new McpServer(
    { name: 'attention-planner', version: '0.2.0' },
    {
      instructions: INSTRUCTIONS,
      // Workers forbid generating code at run time, which the default validator does.
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
    },
  );
  const ws = c.workspace;
  // Tasks as their current round sees them: a task that reopens shows this round's dates.
  const load = async () => inRounds(await ws.read(), ws.now());
  const guard =
    <A>(fn: (args: A) => Promise<ReturnType<typeof text>>) =>
    async (args: A) => {
      try {
        return await fn(args);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    };
  const read = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    'what_now',
    {
      title: 'What to do now',
      description:
        'The task to do at this moment and why, a few alternatives, the current and next calendar event, and a warning if a deadline will not fit.',
      inputSchema: {},
      annotations: read,
    },
    guard(async () => {
      const doc = await load();
      const now = ws.now();
      const today = dayOf(now);
      const withEvents: Doc = { ...doc, events: await ws.events(doc, today, today) };
      const m = nowMinutes(now);
      const timed = eventsOn(withEvents, today);
      const current = timed.find((e) => e.start <= timeOf(m) && timeOf(m) < e.end);
      const next = timed.filter((e) => e.start > timeOf(m)).sort((a, b) => a.start.localeCompare(b.start))[0];
      const picks = nowCandidates(withEvents, now).slice(0, 5);
      const short = capacity(withEvents, now);
      return text(
        clean({
          now: `${today} ${timeOf(m)} (${WEEK[isoWeekday(today) - 1]}, ${ws.timeZone})`,
          in_event_now: current && eventWords(current),
          next_event: next && eventWords(next),
          do_now: picks[0] && { ...brief(doc, picks[0].task, now), why: reasonWords(picks[0].reason) },
          alternatives: picks.slice(1).map((p) => ({ ...brief(doc, p.task, now), why: reasonWords(p.reason) })),
          deadline_will_not_fit: short
            ? { task: short.task.title, due: short.task.due, minutes_short: short.missing }
            : undefined,
        }),
      );
    }),
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'Unfinished tasks, in the order the app shows them. Narrow with a filter (today: due or planned today, overdue, open rounds of repeating tasks; soon: deadline within 7 days; due: any deadline; new: captured this week and not yet given a day; snoozed), an area or project, or words in the title, note or steps. With include_finished, finished tasks matching the words come after.',
      inputSchema: {
        filter: z.enum(FILTERS).optional(),
        area: z.string().max(100).optional().describe('Area name or id.'),
        project: z.string().max(100).optional().describe('Project name or id.'),
        query: z.string().max(200).optional(),
        include_finished: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Default 30.'),
      },
      annotations: read,
    },
    guard(
      async (a: {
        filter?: (typeof FILTERS)[number];
        area?: string;
        project?: string;
        query?: string;
        include_finished?: boolean;
        limit?: number;
      }) => {
        const doc = await load();
        const now = ws.now();
        const find = (kind: 'areas' | 'projects', ref: string) => {
          const hit = Object.values(doc[kind]).find(
            (g) => !g.deleted && (g.id === ref || g.name.toLowerCase() === ref.trim().toLowerCase()),
          );
          if (!hit) throw new Error(`There is no ${kind === 'areas' ? 'area' : 'project'} "${ref}".`);
          return hit.id;
        };
        let rows = listTasks(doc, now, (a.filter ?? 'all') as Filter);
        if (a.area) rows = rows.filter((t) => listTasks(doc, now, `a:${find('areas', a.area!)}`).includes(t));
        if (a.project) rows = rows.filter((t) => t.projectId === find('projects', a.project!));
        const q = a.query?.trim().toLowerCase();
        const hits = (t: Task) =>
          !q || [t.title, t.note ?? '', ...stepsOf(t).map((s) => s.text)].some((x) => x.toLowerCase().includes(q));
        rows = rows.filter(hits);
        if (a.include_finished) rows = [...rows, ...finishedTasks(doc).filter(hits)];
        const limit = a.limit ?? 30;
        return text({
          count: rows.length,
          shown: Math.min(limit, rows.length),
          tasks: rows.slice(0, limit).map((t) => brief(doc, t, now)),
        });
      },
    ),
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get a task',
      description: 'One task in full: note, steps (with ids), plans (with ids), and a link that opens it in the app.',
      inputSchema: { id: z.string().min(1).max(100) },
      annotations: read,
    },
    guard(async ({ id }: { id: string }) => {
      const doc = await load();
      const t = doc.tasks[id];
      if (!t || t.deleted) throw new Error(`There is no task ${id}.`);
      return text(full(doc, t, ws.now(), c.origin));
    }),
  );

  server.registerTool(
    'agenda',
    {
      title: 'Agenda',
      description:
        'Day by day: calendar events (Outlook and subscribed calendars), reserved times, plans without a time, and deadlines.',
      inputSchema: {
        start: daySchema.optional().describe('First day; default today.'),
        days: z.number().int().min(1).max(14).optional().describe('Default 1.'),
      },
      annotations: read,
    },
    guard(async (a: { start?: string; days?: number }) => {
      const doc = await load();
      const now = ws.now();
      const first = a.start ?? dayOf(now);
      const last = addDays(first, (a.days ?? 1) - 1);
      const withEvents: Doc = { ...doc, events: await ws.events(doc, first, last) };
      const out = [];
      for (let day = first; day <= last; day = addDays(day, 1)) {
        const items = dayAgenda(withEvents, day, now);
        out.push(
          clean({
            day: `${day} (${WEEK[isoWeekday(day) - 1]})`,
            all_day: eventsOn(withEvents, day, true)
              .filter((e) => e.allDay)
              .map((e) => e.title),
            events: items.flatMap((x) => (x.kind === 'event' ? [eventWords(x.event)] : [])),
            reserved: items.flatMap((x) =>
              x.kind === 'slot'
                ? [
                    {
                      time: `${timeOf(x.start)}–${timeOf(x.end)}`,
                      task: x.task.title,
                      task_id: x.task.id,
                      plan_id: x.entryId,
                    },
                  ]
                : [],
            ),
            planned: items.flatMap((x) =>
              x.kind === 'loose'
                ? [clean({ task: x.task.title, task_id: x.task.id, part: x.part, plan_id: x.entryId })]
                : [],
            ),
            deadlines: items.flatMap((x) =>
              x.kind === 'due' ? [clean({ task: x.task.title, task_id: x.task.id, step: x.step })] : [],
            ),
          }),
        );
      }
      return text(out);
    }),
  );

  server.registerTool(
    'find_time',
    {
      title: 'Find time for a task',
      description:
        'Free times for a task, earliest first: within working hours, around calendar events and other reserved times, before its deadline (or in the next two weeks). Each is as long as what is still to reserve (its estimate, or one hour, less what is already reserved), up to two hours. To reserve one, propose a "plan" change with its day, start and minutes.',
      inputSchema: { id: z.string().min(1).max(100) },
      annotations: read,
    },
    guard(async ({ id }: { id: string }) => {
      const doc = await load();
      const t = doc.tasks[id];
      if (!t || t.deleted) throw new Error(`There is no task ${id}.`);
      const now = ws.now();
      const today = dayOf(now);
      const withEvents: Doc = { ...doc, events: await ws.events(doc, today, addDays(today, 13)) };
      return text({
        still_to_reserve_minutes: stillToReserve(t),
        times: findTimes(withEvents, t, now).map((s) => ({
          day: `${s.day} (${WEEK[isoWeekday(s.day) - 1]})`,
          start: s.start,
          minutes: s.minutes,
        })),
      });
    }),
  );

  server.registerTool(
    'list_areas_and_projects',
    {
      title: 'Areas and projects',
      description: 'The areas (lasting parts of life or work) and projects (finite outcomes), with open task counts.',
      inputSchema: {},
      annotations: read,
    },
    guard(async () => {
      const doc = await load();
      const now = ws.now();
      const open = liveTasks(doc).filter((t) => !isFinished(t, now));
      const live = <G extends { deleted?: boolean; order: number }>(g: Record<string, G>) =>
        Object.values(g)
          .filter((x) => !x.deleted)
          .sort((x, y) => x.order - y.order);
      return text({
        areas: live(doc.areas).map((g) => ({
          id: g.id,
          name: g.name,
          open: open.filter((t) => t.areaId === g.id).length,
        })),
        projects: live(doc.projects).map((g) =>
          clean({
            id: g.id,
            name: g.name,
            area: groupName(doc, 'areas', g.areaId),
            one_after_another: !!g.sequential,
            finished: !!g.done,
            open: open.filter((t) => t.projectId === g.id).length,
          }),
        ),
      });
    }),
  );

  const needsWrite = () => {
    if (!c.canWrite)
      throw new Error('This connection may only read. Reconnect and allow adding tasks and proposing changes.');
  };

  server.registerTool(
    'add_task',
    {
      title: 'Add a task',
      description:
        'Write a new task down; it is saved at once. "text" may carry the app\'s quick words, which are taken out of the title: 今天/明天/后天/周五/下周三 or today/tomorrow/fri (a deadline when next to 截止/交/之前/due/by, otherwise a plan), 上午/下午/晚上 or a time like 15点/3pm, a length like 2小时/30分钟/2h, a repeat like 每天/每周一三/每月15号/工作日 or daily/every mon (with a deadline word each time is a new copy, otherwise the task reopens in place), and " ! " for important. Fields given explicitly win over the quick words.',
      inputSchema: {
        text: z.string().trim().min(1).max(500),
        note: z.string().max(20000).optional().describe('Markdown; references and links go here.'),
        due: daySchema.optional(),
        due_time: timeSchema.optional(),
        effort_minutes: z.number().int().min(1).max(10000).optional(),
        important: z.boolean().optional(),
        area: z.string().max(100).optional().describe('Name or id; a new name creates the area.'),
        project: z.string().max(100).optional().describe('Name or id; a new name creates the project.'),
        steps: z.array(z.string().trim().min(1).max(2000)).max(50).optional(),
        plan: z
          .object({
            day: daySchema,
            part: partSchema.optional(),
            start: timeSchema.optional(),
            minutes: z
              .number()
              .int()
              .min(5)
              .max(24 * 60)
              .optional(),
          })
          .optional()
          .describe('When to do it: a day, optionally a part of the day or a reserved time.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    guard(
      async (a: {
        text: string;
        note?: string;
        due?: string;
        due_time?: string;
        effort_minutes?: number;
        important?: boolean;
        area?: string;
        project?: string;
        steps?: string[];
        plan?: { day: string; part?: 'am' | 'pm' | 'eve'; start?: string; minutes?: number };
      }) => {
        needsWrite();
        const result = await ws.change((doc, ctx) => {
          const parsed = parseCapture(a.text, ctx.now);
          const effort = a.effort_minutes ?? parsed.effort;
          const plan = a.plan ?? parsed.plan;
          let d = doc;
          let areaId: string | undefined;
          let projectId: string | undefined;
          if (a.area) [d, areaId] = resolveGroup(d, ctx, 'areas', a.area);
          if (a.project) [d, projectId] = resolveGroup(d, ctx, 'projects', a.project);
          const title = parsed.title || a.text.trim();
          const due = a.due ?? parsed.due;
          // As in the app: a repeat with a deadline makes a new copy each time; without one, the task reopens.
          const said = typeof parsed.repeat === 'object' ? parsed.repeat : undefined;
          const [next, id] = addTask(d, ctx, {
            title,
            note: a.note?.trim() ? a.note : undefined,
            due,
            dueTime: a.due_time,
            repeat: said
              ? { mode: due ? 'copy' : 'reopen', rule: { ...said, start: due ?? plan?.day ?? said.start } }
              : undefined,
            effort,
            star: a.important ?? parsed.star ?? undefined,
            areaId,
            projectId,
            steps: a.steps,
            plan: plan
              ? [
                  clean({
                    day: plan.day,
                    part: plan.start ? undefined : plan.part,
                    start: plan.start,
                    minutes: plan.start
                      ? ('minutes' in plan && plan.minutes) || Math.min(effort ?? 60, 120)
                      : undefined,
                  }) as { day: string },
                ]
              : [],
          });
          return [next, { id, doc: next, now: ctx.now }] as const;
        });
        return text({ saved: true, task: full(result.doc, result.doc.tasks[result.id], result.now, c.origin) });
      },
    ),
  );

  server.registerTool(
    'propose_changes',
    {
      title: 'Propose changes',
      description:
        'Propose changes to existing tasks (edit fields, complete, reopen, snooze, plan or unplan, add or check steps, delete). Nothing changes until the owner approves all of them together at the review link this returns; show them the link. Use ids from list_tasks/get_task.',
      inputSchema: {
        summary: z.string().trim().min(1).max(300).describe('One line for the owner: what and why.'),
        changes: z.array(changeSchema).min(1).max(30),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    guard(async (a: { summary: string; changes: z.infer<typeof changeSchema>[] }) => {
      needsWrite();
      const doc = await load();
      for (const ch of a.changes) {
        const t = doc.tasks[ch.task_id];
        if (!t || t.deleted) throw new Error(`There is no task ${ch.task_id}.`);
      }
      const id = randomId();
      await c.proposals.put({
        id,
        summary: a.summary,
        changes: a.changes,
        client: c.client,
        createdAt: new Date().toISOString(),
        status: 'pending',
        nonce: randomId(),
      });
      return text({
        proposal_id: id,
        status: 'pending',
        review_link: `${c.origin}/api/ai/review/${id}`,
        note: 'Nothing has changed yet. Ask the owner to open the review link and approve; check with get_proposal.',
      });
    }),
  );

  server.registerTool(
    'get_proposal',
    {
      title: 'Check a proposal',
      description: 'Whether a proposal is still waiting, was applied, rejected, failed or lapsed.',
      inputSchema: { id: z.string().min(1).max(100) },
      annotations: read,
    },
    guard(async ({ id }: { id: string }) => {
      const p = await c.proposals.get(id);
      if (!p) throw new Error(`There is no proposal ${id} (they are kept for two weeks).`);
      return text(
        clean({
          proposal_id: p.id,
          status: isExpired(p) ? 'lapsed' : p.status,
          decided_at: p.decidedAt,
          error: p.error,
          review_link: p.status === 'pending' ? `${c.origin}/api/ai/review/${p.id}` : undefined,
        }),
      );
    }),
  );

  return server;
}
