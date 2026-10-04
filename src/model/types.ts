/** A local calendar day, `YYYY-MM-DD`. */
export type Day = string;
/** A local wall-clock time, `HH:MM`. */
export type Time = string;

/**
 * Who changed something, and when. Larger `rev` wins; ties fall back to `at`, then `by`.
 * `rev` is a Lamport counter, so a device that has seen a change always stamps later edits higher.
 */
export type Stamp = { rev: number; at: string; by: string };

export type Part = 'am' | 'pm' | 'eve';

/** One arrangement: a day, optionally a part of the day or a reserved time. */
export type PlanEntry = {
  id: string;
  day: Day;
  part?: Part;
  start?: Time;
  minutes?: number;
  /** Minutes actually worked in this reserved time. */
  doneMin?: number;
  s: Stamp;
  deleted?: boolean;
};

export type Frequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type RepeatRule = {
  freq: Frequency;
  every: number;
  /** Count from the last completion instead of the calendar. */
  fromDone: boolean;
  /** ISO weekdays, 1 = Monday … 7 = Sunday (weekly calendar rules). */
  weekdays?: number[];
  /** Day of month, or -1 for the last day (monthly calendar rules). Defaults to the start's day. */
  monthDay?: number;
  start: Day;
  /** When a new round opens (reopen) — defaults to 00:00. */
  time?: Time;
  /** Last day a new occurrence may start, inclusive. */
  until?: Day;
  /** Occurrences left in a "new copy" series, including the current one. */
  count?: number;
};

/** Reopen: the same task starts a new round. Copy: completing it creates the next task. */
export type Repeat = { mode: 'reopen' | 'copy'; rule: RepeatRule; paused?: boolean };

export type Step = {
  id: string;
  text: string;
  order: number;
  /** Plain done flag (a step that does not repeat). */
  done?: boolean;
  /** For a repeating step: the round key it was checked in, and when. */
  doneIn?: string;
  doneAt?: string;
  /** A deadline for this step only, earlier than the task's own. */
  due?: Day;
  /** Estimated minutes for this step; when steps carry estimates, the task's effort is their sum. */
  effort?: number;
  /** `undefined` follows the task's repeat; `'none'` never resets; a rule resets on its own. */
  repeat?: 'none' | RepeatRule;
  s: Stamp;
  deleted?: boolean;
};

/** A finished round of a task that reopens in place. */
export type Round = { key: string; doneAt: string; s: Stamp; deleted?: boolean };

export type Snooze = { until?: Day; reason?: string };

export type Task = {
  id: string;
  title: string;
  note?: string;
  created: string;
  /** ISO time it was finished; the only status. */
  done?: string;
  star?: boolean;
  snooze?: Snooze;
  due?: Day;
  dueTime?: Time;
  /** Total estimated minutes. */
  effort?: number;
  areaId?: string;
  projectId?: string;
  /** Place in the list when it is sorted by hand (smaller first). */
  rank?: number;
  /** A pointer to another task; only affects how lists group them. */
  linkTo?: string;
  repeat?: Repeat;
  plan: PlanEntry[];
  steps: Step[];
  rounds: Round[];
  /** For text fields: the stamp of the version each edit replaced, to tell concurrent edits from later ones. */
  fb?: Partial<Record<TextField, Stamp>>;
  /** The other side of a concurrent text edit, kept until you choose; ignored once the field changes again. */
  conflicts?: Partial<Record<TextField, { value?: string; s: Stamp; against: Stamp }>>;
  /** Fields carried over from an import that this app does not use. */
  legacy?: Record<string, unknown>;
  /** Stamp of each scalar field, so concurrent edits to different fields both survive. */
  fs: Record<string, Stamp>;
  s: Stamp;
  deleted?: boolean;
};

export type Area = { id: string; name: string; order: number; s: Stamp; deleted?: boolean };
export type Project = {
  id: string;
  name: string;
  areaId?: string;
  order: number;
  done?: string;
  /** Tasks are done one after another, in the order they were added; only the first is suggested. */
  sequential?: boolean;
  s: Stamp;
  deleted?: boolean;
};

export type CalendarEvent = {
  id: string;
  title: string;
  day: Day;
  start: Time;
  end: Time;
  /** Shown in the all-day strip; never counted as busy time. */
  allDay?: boolean;
  location?: string;
};

export type StepTool = 'due' | 'effort' | 'repeat' | 'promote';

export type ChipKey = 'due' | 'plan' | 'effort' | 'star' | 'area' | 'repeat' | 'note';

export type Settings = {
  /** Hours the app may count as free time, e.g. 09:00–18:00. */
  workStart: Time;
  workEnd: Time;
  workDays: number[];
  /** Capture chips shown up front, in order; the rest sit under "more". */
  chips: ChipKey[];
  /** The list is ordered automatically, or by hand. */
  listSort?: 'smart' | 'manual';
  /** Reminder times: on a deadline's day, and minutes before a reserved time. */
  remind?: { dueAt?: Time; slotLead?: number };
  /** Buttons shown after each step (dragging and deleting are always there). */
  stepTools?: StepTool[];
  theme: 'system' | 'light' | 'dark';
  lang: 'zh' | 'en';
  s: Stamp;
};

export type Doc = {
  v: 1;
  clock: number;
  tasks: Record<string, Task>;
  areas: Record<string, Area>;
  projects: Record<string, Project>;
  settings: Settings;
  /** Calendar events imported from a file; device-local, not synced. */
  events?: CalendarEvent[];
};

/** Scalar task fields that carry their own stamp in `fs`. */
export const TASK_FIELDS = [
  'title',
  'note',
  'done',
  'star',
  'snooze',
  'due',
  'dueTime',
  'effort',
  'areaId',
  'projectId',
  'linkTo',
  'repeat',
  'rank',
] as const;
export type TaskField = (typeof TASK_FIELDS)[number];
/** Free text where two devices' edits can genuinely conflict. */
export const TEXT_FIELDS = ['title', 'note'] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
