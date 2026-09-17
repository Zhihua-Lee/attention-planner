/** The planner owns allocations and dated intentions, never task completion. */
import type { Task } from './types';

export type PlanStamp = { revision: number; manualRevision: number; updatedAt: string; deviceId: string; manualAt?: string; manualBy?: string };
export type BlockHistory = { startAt: string; durationMinutes: number; at: string; reason: string };
export type WorkBlock = PlanStamp & {
    id: string;
    startAt: string;
    timeZone: string;
    allocatedMinutes: number;
    completedMinutes: number;
    durationMinutes: number;
    state: 'scheduled' | 'pending' | 'done' | 'cancelled';
    origin: 'manual' | 'rollover' | 'legacy';
    reason?: string;
    history: BlockHistory[];
};
export type DayCommitment = PlanStamp & { date: string; selected: boolean };
export type TaskPlanner = {
    version: 1;
    contentStamp?: PlanStamp;
    blocks: WorkBlock[];
    days: DayCommitment[];
    /** Kept as evidence, NOT silently interpreted as today's commitment. */
    legacyFocus?: boolean;
    skippedAt?: string;
    legacySchedule?: string;
};
export type PlanningWindow = { days: number[]; start: string; end: string };
export type BusyPeriod = { start: string; end: string };
export type PlannerClock = { now: Date; deviceId: string };
const MINUTE = 60_000;
const validDate = (s: unknown): s is string => typeof s === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s));
const validMinutes = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100_000;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const localPlanDate = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const localPlanInput = (date: Date): string => `${localPlanDate(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
export function validPlanDay(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T12:00:00`);
    return Number.isFinite(d.getTime()) && localPlanDate(d) === value;
}
export function plannerTimeZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
function stamp(clock: PlannerClock, old?: PlanStamp, automatic = false): PlanStamp {
    return { revision: (old?.revision ?? 0) + 1, manualRevision: (old?.manualRevision ?? 0) + (automatic ? 0 : 1),
        updatedAt: clock.now.toISOString(), deviceId: clock.deviceId,
        manualAt: automatic ? old?.manualAt ?? old?.updatedAt : clock.now.toISOString(),
        manualBy: automatic ? old?.manualBy ?? old?.deviceId : clock.deviceId };
}
function validStamp(v: Record<string, unknown>): boolean {
    return Number.isSafeInteger(v.revision) && Number(v.revision) >= 0 && Number.isSafeInteger(v.manualRevision)
        && Number(v.manualRevision) >= 0 && validDate(v.updatedAt) && typeof v.deviceId === 'string';
}
/** Reject malformed metadata instead of silently erasing live allocations. */
export function readTaskPlanner(value: unknown): TaskPlanner | undefined {
    if (value === undefined || value === null) return undefined;
    if (!plain(value) || value.version !== 1 || !Array.isArray(value.blocks) || !Array.isArray(value.days)) throw new Error('Unsupported or invalid planner data; update the app or restore a backup.');
    if (value.contentStamp !== undefined && (!plain(value.contentStamp) || !validStamp(value.contentStamp))) throw new Error('Invalid planner content version.');
    const ids = new Set<string>();
    for (const b of value.blocks) {
        if (!plain(b) || typeof b.id !== 'string' || !b.id || ids.has(b.id) || !validStamp(b) || !validDate(b.startAt)
            || typeof b.timeZone !== 'string' || !validMinutes(b.allocatedMinutes) || b.allocatedMinutes <= 0
            || !validMinutes(b.completedMinutes) || b.completedMinutes > b.allocatedMinutes
            || !validMinutes(b.durationMinutes) || !['scheduled','pending','done','cancelled'].includes(String(b.state))
            || !['manual','rollover','legacy'].includes(String(b.origin)) || !Array.isArray(b.history)
            || b.history.some(h => !plain(h) || !validDate(h.startAt) || !validMinutes(h.durationMinutes) || !validDate(h.at) || typeof h.reason !== 'string')) {
            throw new Error('Invalid work block; planner data was not modified.');
        }
        ids.add(b.id);
    }
    const days = new Set<string>();
    for (const d of value.days) {
        if (!plain(d) || !validStamp(d) || typeof d.date !== 'string' || !validPlanDay(d.date) || days.has(d.date) || typeof d.selected !== 'boolean') throw new Error('Invalid dated commitment.');
        days.add(d.date);
    }
    return value as TaskPlanner;
}
/** Deterministic lazy migration. No write occurs until an explicit command. */
export function taskPlanner(task: Pick<Task, 'id' | 'planner' | 'scheduledAt' | 'startTime' | 'isFocusedToday' | 'timeEstimate' | 'updatedAt'>): TaskPlanner {
    if (task.planner) return readTaskPlanner(task.planner)!;
    const old = task.scheduledAt || (task.startTime?.includes('T') ? task.startTime : undefined);
    const iso = validDate(task.updatedAt) ? task.updatedAt : '1970-01-01T00:00:00.000Z';
    const minutes = estimateMinutes(task.timeEstimate) || 30;
    return { version: 1, days: [], legacyFocus: task.isFocusedToday || undefined, legacySchedule: old,
        blocks: old && validDate(old) ? [{ id: `legacy:${task.id}`, startAt: new Date(old).toISOString(), timeZone: 'UTC',
            allocatedMinutes: minutes, completedMinutes: 0, durationMinutes: minutes, state: 'scheduled', origin: 'legacy',
            revision: 0, manualRevision: 0, updatedAt: iso, deviceId: 'legacy', history: [] }] : [] };
}
export function estimateMinutes(value: Task['timeEstimate']): number | undefined {
    if (!value) return undefined;
    const n = value.startsWith('custom:') ? Number(value.slice(7)) : Number.parseFloat(value) * (value.includes('hr') ? 60 : 1);
    return validMinutes(n) && n > 0 ? n : undefined;
}
export function isCommittedOn(task: Task, day: string): boolean {
    return task.planner ? task.planner.days.some(d => d.date === day && d.selected) : false;
}
export function workBlocks(task: Task): WorkBlock[] { return taskPlanner(task).blocks; }
export function activeWorkBlocks(task: Task): WorkBlock[] {
    if (task.deletedAt || task.projectArchivedAt || ['done','archived','reference'].includes(task.status)) return [];
    return workBlocks(task).filter(b => b.state === 'scheduled' && b.completedMinutes < b.allocatedMinutes);
}
export const blockEnd = (b: WorkBlock): number => Date.parse(b.startAt) + b.durationMinutes * MINUTE;
export function plannerPatch(task: Task, planner: TaskPlanner): Partial<Task> {
    readTaskPlanner(planner);
    return { planner, scheduledAt: undefined,
        ...(task.startTime?.includes('T') ? { startTime: undefined, relativeStartOffset: undefined } : {}) };
}
export function commitToDay(task: Task, day: string, selected: boolean, clock: PlannerClock): Partial<Task> {
    if (!validPlanDay(day)) throw new Error('Choose a valid day.');
    const p = taskPlanner(task); const old = p.days.find(d => d.date === day);
    if (old?.selected === selected) return {};
    return plannerPatch(task, { ...p, legacyFocus: undefined, days: [...p.days.filter(d => d.date !== day), { date: day, selected, ...stamp(clock, old) }].sort((a,b)=>a.date.localeCompare(b.date)) });
}
/** Scheduling is an explicit command. It never changes total estimated effort. */
export function scheduleWork(task: Task, input: { id: string; startAt: string; durationMinutes: number; timeZone: string }, clock: PlannerClock): Partial<Task> {
    if (task.deletedAt || task.projectArchivedAt || ['done','archived','reference'].includes(task.status)) throw new Error('Reopen this task before arranging work.');
    if (!validDate(input.startAt) || !validMinutes(input.durationMinutes) || input.durationMinutes < 1 || !input.id) throw new Error('Choose a valid time and duration.');
    try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }); } catch { throw new Error('Choose a valid time zone.'); }
    const available = task.availableAt || (task.startTime && !task.startTime.includes('T') ? task.startTime : undefined);
    if (available && Date.parse(available.length === 10 ? `${available}T00:00:00` : available) > Date.parse(input.startAt)) throw new Error('The reservation is before this task becomes available.');
    const p = taskPlanner(task); const old = p.blocks.find(b => b.id === input.id);
    const progress = old?.completedMinutes ?? 0;
    const block: WorkBlock = { ...input, startAt: new Date(input.startAt).toISOString(), allocatedMinutes: progress + input.durationMinutes,
        completedMinutes: progress, state: 'scheduled', origin: 'manual', ...stamp(clock, old),
        history: old ? [...old.history, { startAt: old.startAt, durationMinutes: old.durationMinutes, at: clock.now.toISOString(), reason: 'manual' }] : [] };
    return plannerPatch(task, { ...p, blocks: [...p.blocks.filter(b => b.id !== input.id), block].sort((a,b)=>a.id.localeCompare(b.id)) });
}
export function changeWork(task: Task, id: string, action: 'complete' | 'cancel' | 'progress' | 'undo-rollover', clock: PlannerClock, minutes?: number): Partial<Task> {
    const p = taskPlanner(task); const old = p.blocks.find(b => b.id === id);
    if (!old) throw new Error('This work block no longer exists.');
    let block: WorkBlock = { ...old, ...stamp(clock, old), origin: 'manual', reason: undefined };
    if (action === 'complete') block = { ...block, state: 'done', completedMinutes: old.allocatedMinutes };
    if (action === 'cancel') block = { ...block, state: 'cancelled' };
    if (action === 'progress') {
        if (!validMinutes(minutes) || minutes > old.allocatedMinutes) throw new Error('Progress must be within this allocation.');
        block = { ...block, completedMinutes: minutes, durationMinutes: old.allocatedMinutes - minutes, state: minutes === old.allocatedMinutes ? 'done' : 'pending', reason: 'interrupted' };
    }
    if (action === 'undo-rollover') {
        const previous = old.history[old.history.length - 1];
        if (!previous || previous.reason !== 'rollover') throw new Error('There is no automatic move to undo.');
        // Keep it pending instead of immediately repeating the automatic move.
        block = { ...block, startAt: previous.startAt, durationMinutes: old.allocatedMinutes - old.completedMinutes,
            history: old.history.slice(0,-1), state: 'pending', reason: 'manual-hold' };
    }
    return plannerPatch(task, { ...p, blocks: p.blocks.map(b => b.id === id ? block : b) });
}
export function recordCompare(a: PlanStamp, b: PlanStamp): number {
    return a.manualRevision - b.manualRevision || (a.manualAt ?? a.updatedAt).localeCompare(b.manualAt ?? b.updatedAt) || (a.manualBy ?? a.deviceId).localeCompare(b.manualBy ?? b.deviceId) || a.revision - b.revision || a.updatedAt.localeCompare(b.updatedAt) || a.deviceId.localeCompare(b.deviceId);
}
/** Child identities merge independently from the task's content winner. */
export function mergeTaskPlanners(a: TaskPlanner | undefined, b: TaskPlanner | undefined): TaskPlanner | undefined {
    if (!a) return b ? readTaskPlanner(b) : undefined;
    if (!b) return readTaskPlanner(a);
    readTaskPlanner(a); readTaskPlanner(b);
    const merge = <T extends PlanStamp>(left: T[], right: T[], key: (v:T)=>string): T[] => {
        const m = new Map<string,T>();
        for (const item of [...left,...right]) {
            const prev = m.get(key(item));
            if (!prev || recordCompare(item,prev)>0 || (recordCompare(item,prev)===0 && JSON.stringify(item)>JSON.stringify(prev))) m.set(key(item),item);
        }
        return [...m.values()].sort((x,y)=>key(x).localeCompare(key(y)));
    };
    const contentStamp = !a.contentStamp ? b.contentStamp : !b.contentStamp ? a.contentStamp : recordCompare(a.contentStamp,b.contentStamp)>=0 ? a.contentStamp : b.contentStamp;
    return { version: 1, contentStamp, blocks: merge(a.blocks,b.blocks,v=>v.id), days: merge(a.days,b.days,v=>v.date),
        skippedAt: [a.skippedAt,b.skippedAt].filter((s):s is string=>!!s).sort().pop(),
        legacyFocus: a.legacyFocus || b.legacyFocus || undefined,
        legacySchedule: [a.legacySchedule,b.legacySchedule].filter((s):s is string=>!!s).sort()[0] };
}
function windowMinutes(value: string): number | null {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    const [h,m] = value.split(':').map(Number); return h*60+m;
}
export function validPlanningWindows(windows: PlanningWindow[]): boolean {
    return windows.every(w => Array.isArray(w.days) && w.days.length>0 && w.days.every(d=>Number.isInteger(d)&&d>=0&&d<=6)
        && windowMinutes(w.start)!==null && windowMinutes(w.end)!==null && windowMinutes(w.end)!>windowMinutes(w.start)!);
}
/** No assumed sleep schedule. No windows or untrusted calendar => pending. */
export function rolloverWork(task: Task, block: WorkBlock, options: PlannerClock & {
    windows: PlanningWindow[]; busy: BusyPeriod[]; calendarTrusted: boolean; blocked?: string | null;
}): WorkBlock {
    if (!['scheduled','pending'].includes(block.state) || block.reason==='manual-hold'
        || (block.state==='scheduled' && blockEnd(block)>options.now.getTime())) return block;
    const remaining = block.allocatedMinutes-block.completedMinutes;
    if (remaining<=0) return { ...block, state:'done' };
    let reason = options.blocked || (!options.calendarTrusted ? 'calendar-unavailable' : options.windows.length===0 ? 'configure-hours' : !validPlanningWindows(options.windows) ? 'invalid-hours' : 'no-space');
    let slot: Date | null = null;
    if (!options.blocked && options.calendarTrusted && options.windows.length && validPlanningWindows(options.windows)) {
        const rawAvailable = task.availableAt || (task.startTime && !task.startTime.includes('T') ? task.startTime : undefined);
        const available = rawAvailable ? Date.parse(rawAvailable.length===10 ? `${rawAvailable}T00:00:00` : rawAvailable) : -Infinity;
        const earliest = Math.max(options.now.getTime(),available);
        const busy = options.busy.map(b=>({start:Date.parse(b.start),end:Date.parse(b.end)})).filter(b=>Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>b.start).sort((a,b)=>a.start-b.start);
        for (let day=0; day<7 && !slot; day++) {
            const date = new Date(options.now); date.setDate(date.getDate()+day);
            for (const window of [...options.windows].sort((a,b)=>a.start.localeCompare(b.start))) {
                if (!window.days.includes(date.getDay())) continue;
                const lo = new Date(date), hi = new Date(date);
                const l=windowMinutes(window.start)!,h=windowMinutes(window.end)!;
                lo.setHours(Math.floor(l/60),l%60,0,0); hi.setHours(Math.floor(h/60),h%60,0,0);
                let start = Math.ceil(Math.max(lo.getTime(),earliest)/(5*MINUTE))*(5*MINUTE);
                for (const event of busy) {
                    if (event.end<=start) continue;
                    if (event.start>=start+remaining*MINUTE) break;
                    start = Math.ceil(event.end/(5*MINUTE))*(5*MINUTE);
                }
                if (start+remaining*MINUTE<=hi.getTime()) { slot=new Date(start); break; }
            }
        }
    }
    if (!slot) {
        if (block.state==='pending' && block.reason===reason) return block;
        return { ...block, state:'pending', reason, ...stamp(options,block,true) };
    }
    reason = 'rollover';
    return { ...block, startAt:slot.toISOString(), durationMinutes:remaining, state:'scheduled', origin:'rollover', reason,
        ...stamp(options,block,true), history:[...block.history,{startAt:block.startAt,durationMinutes:block.durationMinutes,at:options.now.toISOString(),reason}] };
}

/** One read model for allocations. It includes future and blocked plans. */
export function blocksOnDay(task: Task, day: string): WorkBlock[] {
    return workBlocks(task).filter(b => localPlanDate(new Date(b.startAt)) === day);
}
export function currentWorkBlock(task: Task, now: Date): WorkBlock | undefined {
    return activeWorkBlocks(task).filter(b => Date.parse(b.startAt) <= now.getTime() && blockEnd(b) > now.getTime())
        .sort((a,b) => a.startAt.localeCompare(b.startAt))[0];
}
export function hasFutureWork(task: Task, now: Date): boolean {
    return !currentWorkBlock(task, now) && activeWorkBlocks(task).some(b => Date.parse(b.startAt) > now.getTime());
}
/** Completion closes future reservations without asserting that time was worked. */
export function closeTaskWork(task: Task, clock: PlannerClock, reason = 'task-completed'): TaskPlanner | undefined {
    if (!task.planner) return undefined;
    return { ...task.planner, blocks: task.planner.blocks.map(b => ['done','cancelled'].includes(b.state) ? b : {
        ...b, state:'cancelled', origin:'manual', reason, ...stamp(clock,b),
    }) };
}
/** Different fields from a stale editor are never written back wholesale. */
export function contentDraftPatch(base: Partial<Task>, draft: Partial<Task>, latest: Task): Partial<Task> {
    const keys = ['title','description','checklist','dueDate','availableAt','timeEstimate','projectId','areaId','recurrence'] as const;
    const patch: Partial<Task> = {};
    for (const key of keys) {
        if (JSON.stringify(base[key]) === JSON.stringify(draft[key])) continue;
        if (JSON.stringify(base[key]) !== JSON.stringify(latest[key]) && JSON.stringify(draft[key]) !== JSON.stringify(latest[key])) {
            throw new Error(`This task's ${key} changed on another device. Keep this draft and reopen the latest task before saving.`);
        }
        Object.assign(patch, { [key]: draft[key] });
    }
    if (typeof patch.title === 'string' && !patch.title.trim()) throw new Error('Write a task name first.');
    for (const key of ['availableAt', 'dueDate'] as const) {
        const value = patch[key];
        if (value && !(validPlanDay(value) || validDate(value))) throw new Error('Choose a valid date or an unambiguous time.');
    }
    if (patch.timeEstimate && !estimateMinutes(patch.timeEstimate)) throw new Error('Use a positive total effort estimate.');
    return patch;
}

export function skipRecurringWork(task: Task, clock: PlannerClock): Partial<Task> {
    if (!task.recurrence || ['done','archived','reference'].includes(task.status)) throw new Error('There is no open recurring occurrence to skip.');
    const planner = closeTaskWork({ ...task, planner: taskPlanner(task) },clock,'occurrence-skipped')!;
    return { ...plannerPatch(task,{...planner,skippedAt:clock.now.toISOString()}), status:'archived', completedAt:undefined };
}

/** Automatic schedule edits cannot resurrect a task completed on another device. */
export function taskContentStamp(task: Task): PlanStamp {
    return task.planner?.contentStamp ?? { revision:task.rev??0, manualRevision:task.rev??0, updatedAt:task.updatedAt,deviceId:task.revBy??'legacy' };
}
export function stampPlannerContent(old: Task, updated: Task, clock: PlannerClock): Task {
    if (!updated.planner) return updated;
    const ignored=new Set(['planner','scheduledAt','startTime','relativeStartOffset','rev','revBy','updatedAt']);
    const contentChanged=Object.keys(updated).some(key=>!ignored.has(key)&&JSON.stringify(old[key as keyof Task])!==JSON.stringify(updated[key as keyof Task]));
    const previous=taskContentStamp(old);
    return {...updated,planner:{...updated.planner,contentStamp:contentChanged?stamp(clock,previous):previous}};
}
export function plannerContentWinner(a: Task,b: Task,fallback:Task):Task {
    if(!a.planner&&!b.planner)return fallback;
    const difference=recordCompare(taskContentStamp(a),taskContentStamp(b));
    const content=difference>0?a:difference<0?b:fallback;
    return {...content,rev:fallback.rev,revBy:fallback.revBy,updatedAt:fallback.updatedAt};
}

/** Validate a manual reservation against the known calendar; no optimistic empty-calendar fallback. */
export function assertReservationFree(input: { startAt: string; durationMinutes: number }, busy: BusyPeriod[], trusted: boolean): void {
    if (!trusted) throw new Error('Calendar is not ready. Refresh it before reserving this time.');
    const start = Date.parse(input.startAt), end = start + input.durationMinutes * MINUTE;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Choose a valid reservation.');
    for (const item of busy) {
        const from = Date.parse(item.start), to = Date.parse(item.end);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('Calendar contains an invalid interval. Refresh before scheduling.');
        if (from < end && to > start) throw new Error('This reservation overlaps a meeting or another work block. Choose a free time.');
    }
}
/** Restore only reservations that this completion cancelled; retain subsequent manual edits. */
export function restoreCompletedWork(before: Task, latest: Task, clock: PlannerClock): Partial<Task> {
    if (!before.planner || !latest.planner) return {};
    const blocks = latest.planner.blocks.map(block => {
        const old = before.planner!.blocks.find(b => b.id === block.id);
        if (!old || block.state !== 'cancelled' || block.reason !== 'task-completed'
            || block.manualRevision !== old.manualRevision + 1) return block;
        // Historic reservations are not silently reactivated by an undo days later.
        return { ...old, ...stamp(clock,block), state: blockEnd(old) <= clock.now.getTime() ? 'pending' as const : old.state,
            reason: blockEnd(old) <= clock.now.getTime() ? 'manual-hold' : old.reason };
    });
    return plannerPatch(latest,{...latest.planner,blocks});
}

/** Date-only values stay dates. Timed edits preserve the user's local wall clock. */
export function planDatePart(value?: string): string {
    if (!value) return '';
    return value.includes('T') ? localPlanDate(new Date(value)) : value;
}
export function planTimePart(value?: string): string {
    return value?.includes('T') ? localPlanInput(new Date(value)).slice(11) : '';
}
export function planDateValue(day: string, time = ''): string | undefined {
    if (!day) return undefined;
    if (!validPlanDay(day)) throw new Error('Choose a valid date.');
    if (!time) return day;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Choose a valid time.');
    const value = new Date(`${day}T${time}:00`);
    if (localPlanInput(value) !== `${day}T${time}`) throw new Error('This local time does not exist because of a clock change.');
    return value.toISOString();
}
