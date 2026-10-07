import * as z from 'zod';
import type { Change, RepeatInput, RuleInput } from '../../src/model/changes';

export {
  addNewTask,
  applyChange,
  applyChanges,
  changeTask,
  dayWords,
  describeChange,
  findGroup,
  fromRule,
  minutesWords,
  reservedMinutes,
  resolveGroup,
  ruleWords,
  toRepeat,
  toRule,
  type Change,
  type NewTaskInput,
} from '../../src/model/changes';

/** The schemas the AI's input is checked against; they must describe exactly the model's `Change`. */
export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A day is YYYY-MM-DD.');
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time is HH:MM (24-hour).');
export const partSchema = z.enum(['am', 'pm', 'eve']);
const taskId = z.string().min(1).max(100);

/** A repeat rule as the AI writes it. */
export const ruleSchema = z.object({
  freq: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'yearly']).describe('hourly only for a task that reopens'),
  every: z.number().int().min(1).max(365).optional().describe('Default 1.'),
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .max(7)
    .optional()
    .describe('Weekly: ISO weekdays, 1 = Monday … 7 = Sunday.'),
  month_day: z.number().int().min(-1).max(31).optional().describe('Monthly: day of the month, -1 = the last day.'),
  from_done: z.boolean().optional().describe('Count from each completion instead of the calendar.'),
  start: daySchema.optional().describe('First occurrence on or after this day; default the deadline, or today.'),
  until: daySchema.optional().describe('Last day a new occurrence may start.'),
  count: z.number().int().min(1).max(1000).optional().describe('New-copy series: how many in all.'),
});
export const repeatSchema = z.object({
  mode: z
    .enum(['reopen', 'copy'])
    .describe('reopen: the same task opens again each round (a checklist); copy: completing it creates the next one.'),
  rule: ruleSchema,
  lead_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe(
      'New copy with a deadline only: each new copy shows up this many days before its deadline (snoozed until then).',
    ),
});

const groupRef = z.string().min(1).max(100);

/** The details of a new task (add_task's, without the quick words). */
export const newTaskFields = {
  note: z.string().max(20000).optional().describe('Markdown; references and links go here.'),
  due: daySchema.optional(),
  due_time: timeSchema.optional(),
  effort_minutes: z.number().int().min(1).max(10000).optional(),
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
  link_to: taskId.optional().describe('Id of the task this one belongs with; the list shows it right after that task.'),
  repeat: repeatSchema.optional(),
};

/**
 * One change, as the AI proposes it. The owner approves a list of them together. The first adds a task, the last two
 * change a project or an area, and the rest change one task.
 */
export const changeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('add_task'),
      title: z.string().trim().min(1).max(500).describe('As it should read; quick words are not read here.'),
      star: z.boolean().optional().describe('Important.'),
      ...newTaskFields,
    })
    .describe('A new task.'),
  z.object({
    type: z.literal('update'),
    task_id: taskId,
    title: z.string().trim().min(1).max(500).optional(),
    note: z.string().max(20000).optional().describe('Replaces the whole note (Markdown).'),
    due: daySchema.nullable().optional().describe('Deadline day; null removes it.'),
    due_time: timeSchema.nullable().optional(),
    effort_minutes: z.number().int().min(1).max(10000).nullable().optional(),
    star: z.boolean().optional().describe('Important.'),
    area: z.string().max(100).nullable().optional().describe('Area name or id; a new name creates it; null clears.'),
    project: z
      .string()
      .max(100)
      .nullable()
      .optional()
      .describe('Project name or id; a new name creates it; null clears.'),
  }),
  z.object({ type: z.literal('complete'), task_id: taskId }),
  z.object({ type: z.literal('reopen'), task_id: taskId }),
  z.object({
    type: z.literal('snooze'),
    task_id: taskId,
    until: daySchema.optional().describe('Back on this day; leave out to snooze until further notice.'),
    reason: z.string().max(200).optional().describe('What it is waiting for.'),
  }),
  z.object({ type: z.literal('unsnooze'), task_id: taskId }),
  z.object({
    type: z.literal('plan'),
    task_id: taskId,
    day: daySchema,
    part: partSchema.optional().describe('am, pm or eve; leave out with a start time.'),
    start: timeSchema.optional().describe('Reserve a time from this start.'),
    minutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .optional()
      .describe('Length of the reserved time.'),
    step_id: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "For one step of the task: without a start it is that day's step (offered first in NOW); with one, time for it.",
      ),
  }),
  z.object({ type: z.literal('unplan'), task_id: taskId, plan_id: z.string().min(1).max(100) }),
  z.object({ type: z.literal('add_step'), task_id: taskId, text: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal('check_step'), task_id: taskId, step_id: z.string().min(1).max(100), done: z.boolean() }),
  z.object({
    type: z.literal('edit_step'),
    task_id: taskId,
    step_id: z.string().min(1).max(100),
    text: z.string().trim().min(1).max(2000).optional(),
    due: daySchema.nullable().optional().describe("The step's own deadline; null removes it."),
    effort_minutes: z.number().int().min(1).max(10000).nullable().optional(),
    repeat: z
      .union([z.enum(['follow', 'none']), ruleSchema])
      .optional()
      .describe('follow: resets with the task each round; none: never resets; or a rule of its own.'),
  }),
  z.object({ type: z.literal('remove_step'), task_id: taskId, step_id: z.string().min(1).max(100) }),
  z
    .object({
      type: z.literal('promote_step'),
      task_id: taskId,
      step_id: z.string().min(1).max(100),
    })
    .describe('Turn a step into its own task, linked to this one (it keeps its deadline and estimate).'),
  z.object({
    type: z.literal('move_plan'),
    task_id: taskId,
    plan_id: z.string().min(1).max(100),
    day: daySchema.optional(),
    start: timeSchema.nullable().optional().describe('A new start time; null makes it a plan without a time.'),
    part: partSchema.nullable().optional(),
    minutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .optional(),
  }),
  z.object({
    type: z.literal('link'),
    task_id: taskId,
    to: taskId.nullable().describe('The task this one belongs with (it is listed right after it); null unlinks.'),
  }),
  z.object({
    type: z.literal('set_repeat'),
    task_id: taskId,
    repeat: repeatSchema.nullable().describe('null stops repeating.'),
  }),
  z.object({ type: z.literal('delete'), task_id: taskId }),
  z.object({
    type: z.literal('update_project'),
    project: groupRef.describe('Project name or id.'),
    name: z.string().trim().min(1).max(100).optional(),
    one_after_another: z.boolean().optional().describe('Only the earliest unfinished one-off task is suggested.'),
  }),
  z.object({
    type: z.literal('rename_area'),
    area: groupRef.describe('Area name or id.'),
    name: z.string().trim().min(1).max(100),
  }),
]);

// The schemas and the model's types must agree, both ways.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const agree: [
  Same<z.infer<typeof changeSchema>, Change>,
  Same<z.infer<typeof ruleSchema>, RuleInput>,
  Same<z.infer<typeof repeatSchema>, RepeatInput>,
] = [true, true, true];
void agree;
