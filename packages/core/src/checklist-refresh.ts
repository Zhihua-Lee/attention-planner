import type { Task, ChecklistItem } from './types';

/** Stored inside the already-synced planner JSON; never a separate task or timer job. */
export type ChecklistRefreshSchedule = {
    id: string;
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval: number;
    weekdays?: number[]; // ISO weekdays: Monday=1, Sunday=7.
    monthDays?: number[]; // 1..31 or -1 (last day).
    startDate: string;
    time: string;
    timeZone: string;
};
export type ChecklistRefreshEnd = { mode: 'inherit' | 'never' | 'date'; date?: string };
export type ChecklistRefreshStamp = { revision: number; updatedAt: string; deviceId: string };
export type ChecklistRefreshPolicy = ChecklistRefreshStamp & {
    mode: 'inherit' | 'off' | 'custom';
    schedule?: ChecklistRefreshSchedule;
    end: ChecklistRefreshEnd;
    pausedAt?: string;
};
export type ChecklistRefreshMark = ChecklistRefreshStamp & {
    completed: boolean;
    dueAt: string;
    day: string;
};
export type ChecklistRefreshData = {
    version: 1;
    defaults?: ChecklistRefreshPolicy;
    items: Record<string, ChecklistRefreshPolicy>;
    marks: Record<string, Record<string, ChecklistRefreshMark>>;
};
export type ChecklistRefreshTarget = { taskId: string; itemId?: string };
export type ChecklistCycle = { id: string; day: string; dueAt: string };
export type ChecklistItemState = {
    recurring: boolean;
    completed: boolean;
    cycle?: ChecklistCycle;
    next?: ChecklistCycle;
    paused: boolean;
    ended: boolean;
    schedule?: ChecklistRefreshSchedule;
    endDate?: string;
};
export type ChecklistDraftState = Record<string, { completed: boolean; cycleId?: string; mark?: ChecklistRefreshMark; recurring: boolean }>;
const DAY = 86_400_000, MINUTE = 60_000;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const safeKey = (s: string) => s !== '__proto__' && s !== 'prototype' && s !== 'constructor';
const iso = (n: number) => new Date(n).toISOString().slice(0, 10);
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;
export const validChecklistDay = (date: unknown): date is string => typeof date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(dayNumber(date)) && iso(dayNumber(date) * DAY) === date;
const stampValid = (v: Record<string, unknown>) => Number.isSafeInteger(v.revision) && Number(v.revision) >= 0
    && typeof v.updatedAt === 'string' && Number.isFinite(Date.parse(v.updatedAt)) && typeof v.deviceId === 'string';
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
    let fmt = formatters.get(zone);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        if (formatters.size > 128) formatters.clear();
        formatters.set(zone, fmt);
    }
    return fmt;
}
function wallParts(at: number, zone: string) {
    const p = Object.fromEntries(formatter(zone).formatToParts(at).map(part => [part.type, part.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
export function checklistLocalDay(now: Date, zone: string) { return wallParts(now.getTime(), zone).day; }
export function validateChecklistSchedule(value: unknown): asserts value is ChecklistRefreshSchedule {
    if (!record(value) || typeof value.id !== 'string' || !value.id || !safeKey(value.id)
        || !['daily', 'weekly', 'monthly', 'yearly'].includes(String(value.frequency))
        || !Number.isInteger(value.interval) || Number(value.interval) < 1 || Number(value.interval) > 999
        || !validChecklistDay(value.startDate) || typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)
        || typeof value.timeZone !== 'string') throw new Error('Invalid checklist refresh schedule.');
    formatter(value.timeZone);
    if (value.frequency === 'weekly' && (!Array.isArray(value.weekdays) || !value.weekdays.length)) throw new Error('Choose at least one weekday.');
    if (value.weekdays !== undefined && (!Array.isArray(value.weekdays)
        || value.weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7))) throw new Error('Invalid weekdays.');
    if (value.monthDays !== undefined && (!Array.isArray(value.monthDays) || !value.monthDays.length
        || value.monthDays.some(d => !Number.isInteger(d) || (d !== -1 && (d < 1 || d > 31))))) throw new Error('Invalid month days.');
}
export function validateChecklistEnd(end: unknown): asserts end is ChecklistRefreshEnd {
    if (!record(end) || !['inherit', 'never', 'date'].includes(String(end.mode))
        || (end.mode === 'date' && !validChecklistDay(end.date))) throw new Error('Choose a valid end date.');
}
export function validateChecklistRefresh(value: unknown): asserts value is ChecklistRefreshData | undefined {
    if (value === undefined) return;
    if (!record(value) || value.version !== 1 || !record(value.items) || !record(value.marks)) throw new Error('Unsupported checklist refresh data.');
    for (const policy of [value.defaults, ...Object.values(value.items)].filter(v => v !== undefined)) {
        if (!record(policy) || !stampValid(policy) || !['inherit', 'off', 'custom'].includes(String(policy.mode))) throw new Error('Invalid checklist refresh policy.');
        validateChecklistEnd(policy.end);
        if (policy.mode === 'custom') validateChecklistSchedule(policy.schedule);
        if (policy.pausedAt !== undefined && (typeof policy.pausedAt !== 'string' || !Number.isFinite(Date.parse(policy.pausedAt)))) throw new Error('Invalid pause date.');
    }
    for (const [itemId, marks] of Object.entries(value.marks)) {
        if (!safeKey(itemId) || !record(marks)) throw new Error('Invalid checklist history.');
        for (const [id, mark] of Object.entries(marks)) {
            if (!safeKey(id) || !record(mark) || !stampValid(mark) || typeof mark.completed !== 'boolean'
                || !validChecklistDay(mark.day) || typeof mark.dueAt !== 'string' || !Number.isFinite(Date.parse(mark.dueAt))) throw new Error('Invalid checklist history entry.');
        }
    }
    if (Object.keys(value.items).some(key => !safeKey(key))) throw new Error('Invalid checklist item identifier.');
}
export function checklistRefreshData(task: Task): ChecklistRefreshData {
    return task.planner?.checklistRefresh ?? { version: 1, items: {}, marks: {} };
}
function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (record(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}
function winner<T extends ChecklistRefreshStamp>(a: T | undefined, b: T | undefined): T | undefined {
    if (!a) return b;
    if (!b) return a;
    const compare = a.revision - b.revision || a.updatedAt.localeCompare(b.updatedAt)
        || a.deviceId.localeCompare(b.deviceId) || stable(a).localeCompare(stable(b));
    return compare >= 0 ? a : b;
}
/** Merge per policy and per (item, schedule version, occurrence), not one checklist-wide boolean. */
export function mergeChecklistRefresh(a?: ChecklistRefreshData, b?: ChecklistRefreshData): ChecklistRefreshData | undefined {
    validateChecklistRefresh(a); validateChecklistRefresh(b);
    if (!a) return b;
    if (!b) return a;
    const items: ChecklistRefreshData['items'] = {};
    for (const id of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) items[id] = winner(a.items[id], b.items[id])!;
    const marks: ChecklistRefreshData['marks'] = {};
    for (const id of new Set([...Object.keys(a.marks), ...Object.keys(b.marks)])) {
        marks[id] = {};
        for (const cycle of new Set([...Object.keys(a.marks[id] ?? {}), ...Object.keys(b.marks[id] ?? {})])) {
            marks[id][cycle] = winner(a.marks[id]?.[cycle], b.marks[id]?.[cycle])!;
        }
    }
    return { version: 1, defaults: winner(a.defaults, b.defaults), items, marks };
}
export function checklistDescendants(tasks: readonly Task[], rootId: string): Task[] {
    const children = new Map<string, Task[]>();
    for (const task of tasks) if (task.parentTaskId && !task.deletedAt && !task.purgedAt) {
        const siblings = children.get(task.parentTaskId) ?? []; siblings.push(task); children.set(task.parentTaskId, siblings);
    }
    const pending = [...(children.get(rootId) ?? [])], seen = new Set([rootId]), result: Task[] = [];
    while (pending.length) {
        const task = pending.shift()!;
        if (seen.has(task.id)) continue;
        seen.add(task.id); result.push(task); pending.push(...(children.get(task.id) ?? []));
    }
    return result;
}
const taskIndexes = new WeakMap<readonly Task[], Map<string, Task>>();
export function resolveChecklistRefresh(task: Task, itemId: string | undefined, tasks: readonly Task[], ignoreOwn = false) {
    let byId = taskIndexes.get(tasks);
    if (!byId) {
        byId = new Map(tasks.filter(t => !t.deletedAt && !t.purgedAt).map(t => [t.id, t]));
        taskIndexes.set(tasks, byId);
    }
    const chain: Task[] = [], seen = new Set<string>();
    let cursor: Task | undefined = task;
    while (cursor && !seen.has(cursor.id)) { seen.add(cursor.id); chain.push(cursor); cursor = cursor.parentTaskId ? byId.get(cursor.parentTaskId) : undefined; }
    let schedule: ChecklistRefreshSchedule | undefined, endDate: string | undefined, pausedAt: string | undefined;
    const policies = chain.reverse().map(t => ignoreOwn && itemId === undefined && t.id === task.id ? undefined : checklistRefreshData(t).defaults);
    if (itemId !== undefined && !ignoreOwn) policies.push(checklistRefreshData(task).items[itemId]);
    for (const policy of policies) {
        if (!policy) continue;
        if (policy.mode === 'off') schedule = undefined;
        if (policy.mode === 'custom') schedule = policy.schedule;
        if (policy.end.mode === 'date') endDate = policy.end.date;
        if (policy.end.mode === 'never') endDate = undefined;
        // Pausing a parent freezes its subtree, including independent child schedules.
        if (policy.pausedAt && (!pausedAt || policy.pausedAt < pausedAt)) pausedAt = policy.pausedAt;
    }
    return { schedule, endDate, pausedAt };
}
function matches(schedule: ChecklistRefreshSchedule, day: string): boolean {
    if (day < schedule.startDate) return false;
    const n = dayNumber(day), start = dayNumber(schedule.startDate), date = new Date(n * DAY), first = new Date(start * DAY);
    const weekday = date.getUTCDay() || 7;
    if (schedule.frequency === 'daily') return (n - start) % schedule.interval === 0;
    if (schedule.frequency === 'weekly') {
        const firstMonday = start - ((first.getUTCDay() || 7) - 1);
        return Math.floor((n - firstMonday) / 7) % schedule.interval === 0 && !!schedule.weekdays?.includes(weekday);
    }
    if (schedule.frequency === 'yearly') return (date.getUTCFullYear() - first.getUTCFullYear()) % schedule.interval === 0
        && date.getUTCMonth() === first.getUTCMonth() && date.getUTCDate() === first.getUTCDate();
    const months = (date.getUTCFullYear() - first.getUTCFullYear()) * 12 + date.getUTCMonth() - first.getUTCMonth();
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    return months % schedule.interval === 0 && (schedule.monthDays ?? [first.getUTCDate()]).some(d => date.getUTCDate() === (d === -1 ? last : d));
}
const boundaries = new Map<string, number | undefined>();
/** Earliest instant in a fold; first existing minute after a gap. The date key prevents a double reset. */
function boundary(day: string, time: string, zone: string): number | undefined {
    const key = `${zone}/${day}/${time}`;
    if (boundaries.has(key)) return boundaries.get(key);
    const [hour, minute] = time.split(':').map(Number), minutes = hour * 60 + minute;
    const naive = dayNumber(day) * DAY + minutes * MINUTE;
    const offsets = new Set<number>();
    for (const delta of [-36, -12, 0, 12, 36]) {
        const at = naive + delta * 60 * MINUTE, wall = wallParts(at, zone);
        offsets.add(dayNumber(wall.day) * DAY + wall.minutes * MINUTE - at);
    }
    const candidates = [...offsets].map(offset => naive - offset);
    const exact = candidates.filter(at => { const wall = wallParts(at, zone); return wall.day === day && wall.minutes === minutes; });
    let result = exact.length ? Math.min(...exact) : undefined;
    if (!exact.length) {
        const from = Math.min(...candidates), to = Math.max(...candidates);
        for (let at = from; at <= to; at += MINUTE) {
            const wall = wallParts(at, zone);
            if (wall.day === day && wall.minutes >= minutes) { result = at; break; }
        }
    }
    if (boundaries.size > 2048) boundaries.clear();
    boundaries.set(key, result);
    return result;
}
/** Bounded by calendar periods, not by the length of an offline absence. */
function findCycle(schedule: ChecklistRefreshSchedule, now: Date, direction: -1 | 1, endDate?: string): ChecklistCycle | undefined {
    const nowDay = checklistLocalDay(now, schedule.timeZone), anchor = direction === -1 && endDate && endDate < nowDay ? endDate : nowDay;
    const start = dayNumber(schedule.startDate), end = endDate ? dayNumber(endDate) : Infinity;
    let day = Math.max(direction === 1 ? start : -Infinity, dayNumber(anchor));
    if (direction === -1 && day < start || direction === 1 && day > end) return undefined;
    // Jump close to the applicable interval before scanning at most one calendar period.
    if (schedule.frequency === 'daily') {
        const elapsed = day - start;
        day = start + (direction === -1 ? Math.floor(elapsed / schedule.interval) : Math.ceil(elapsed / schedule.interval)) * schedule.interval;
    } else if (schedule.frequency === 'weekly') {
        const monday = start - ((new Date(start * DAY).getUTCDay() || 7) - 1), week = Math.floor((day - monday) / 7);
        const remainder = ((week % schedule.interval) + schedule.interval) % schedule.interval;
        if (remainder) day = direction === -1 ? monday + (week - remainder) * 7 + 6 : monday + (week + schedule.interval - remainder) * 7;
    }
    // Monthly/yearly searches skip whole inactive intervals, including leap-year gaps.
    for (let count = 0; count < 1600 && day >= start && day <= end; count++) {
        const date = new Date(day * DAY), first = new Date(start * DAY);
        if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999 || date.getUTCFullYear() < 1) return undefined;
        if (schedule.frequency === 'monthly') {
            const months = (date.getUTCFullYear() - first.getUTCFullYear()) * 12 + date.getUTCMonth() - first.getUTCMonth();
            const remainder = ((months % schedule.interval) + schedule.interval) % schedule.interval;
            if (remainder) {
                day = direction === -1 ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - remainder + 1, 0) / DAY
                    : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + schedule.interval - remainder, 1) / DAY;
                continue;
            }
        } else if (schedule.frequency === 'yearly') {
            const years = date.getUTCFullYear() - first.getUTCFullYear(), remainder = ((years % schedule.interval) + schedule.interval) % schedule.interval;
            if (remainder || date.getUTCMonth() !== first.getUTCMonth()) {
                let year = date.getUTCFullYear() + (remainder ? (direction === -1 ? -remainder : schedule.interval - remainder) : 0);
                if (!remainder && ((direction === -1 && date.getUTCMonth() < first.getUTCMonth()) || (direction === 1 && date.getUTCMonth() > first.getUTCMonth()))) year += direction * schedule.interval;
                day = Date.UTC(year, first.getUTCMonth() + (direction === -1 ? 1 : 0), direction === -1 ? 0 : 1) / DAY;
                continue;
            }
        }
        const text = iso(day * DAY);
        if (matches(schedule, text)) {
            const at = boundary(text, schedule.time, schedule.timeZone);
            if (at !== undefined && (direction === -1 ? at <= now.getTime() : at > now.getTime())) return { id: `${schedule.id}/${text}`, day: text, dueAt: new Date(at).toISOString() };
        }
        if (schedule.frequency === 'daily') day += direction * schedule.interval;
        else {
            day += direction;
            if (schedule.frequency === 'weekly') {
                const weekday = new Date(day * DAY).getUTCDay() || 7;
                if (direction === 1 && weekday === 1) day += (schedule.interval - 1) * 7;
                if (direction === -1 && weekday === 7) day -= (schedule.interval - 1) * 7;
            }
        }
    }
    return undefined;
}
export function checklistItemState(task: Task, item: ChecklistItem, tasks: readonly Task[], now = new Date()): ChecklistItemState {
    if (task.deletedAt || task.purgedAt) return { recurring: false, completed: item.isCompleted, paused: false, ended: true };
    const { schedule, endDate, pausedAt } = resolveChecklistRefresh(task, item.id, tasks);
    if (!schedule) return { recurring: false, completed: item.isCompleted, paused: false, ended: false };
    const closedAt = ['done', 'archived', 'reference'].includes(task.status) ? task.completedAt || task.updatedAt : undefined;
    const clock = new Date(Math.min(now.getTime(), pausedAt ? Date.parse(pausedAt) : Infinity, closedAt ? Date.parse(closedAt) : Infinity));
    const cycle = findCycle(schedule, clock, -1, endDate);
    const ended = !!closedAt || !!endDate && checklistLocalDay(now, schedule.timeZone) > endDate;
    const mark = cycle ? checklistRefreshData(task).marks[item.id]?.[cycle.id] : undefined;
    return { recurring: true, completed: mark?.completed ?? false, cycle,
        next: pausedAt || ended ? undefined : findCycle(schedule, now, 1, endDate), paused: !!pausedAt, ended, schedule, endDate };
}
export function projectChecklist(task: Task, tasks: readonly Task[], now = new Date()): ChecklistItem[] | undefined {
    return task.checklist?.map(item => ({ ...item, isCompleted: checklistItemState(task, item, tasks, now).completed }));
}
export function hasRecurringChecklist(task: Task, tasks: readonly Task[], now = new Date()): boolean {
    return !!task.checklist?.some(item => { const state = checklistItemState(task, item, tasks, now); return state.recurring; });
}
export function checklistDraftState(task: Task, tasks: readonly Task[], now = new Date()): ChecklistDraftState {
    return Object.fromEntries((task.checklist ?? []).map(item => {
        const state = checklistItemState(task, item, tasks, now);
        return [item.id, { completed: state.completed, recurring: state.recurring, cycleId: state.cycle?.id,
            mark: state.cycle ? checklistRefreshData(task).marks[item.id]?.[state.cycle.id] : undefined }];
    }));
}
export function changeChecklistCompletion(task: Task, tasks: readonly Task[], changes: Array<{ itemId: string; completed: boolean; cycleId?: string }>, now: Date, deviceId: string) {
    const data = checklistRefreshData(task), marks = { ...data.marks }, checklist = [...(task.checklist ?? [])];
    for (const change of changes) {
        const index = checklist.findIndex(item => item.id === change.itemId);
        if (index < 0 || !safeKey(change.itemId)) throw new Error('This checklist item no longer exists.');
        const state = checklistItemState(task, checklist[index], tasks, now);
        if (state.recurring) {
            if (!state.cycle || change.cycleId !== state.cycle.id) throw new Error('The checklist period changed. Review the current period before saving.');
            const old = data.marks[change.itemId]?.[state.cycle.id];
            if (state.completed === change.completed) continue;
            marks[change.itemId] = { ...marks[change.itemId], [state.cycle.id]: { completed: change.completed,
                dueAt: state.cycle.dueAt, day: state.cycle.day, revision: (old?.revision ?? 0) + 1, updatedAt: now.toISOString(), deviceId } };
        } else {
            if (change.cycleId) throw new Error('The refresh rule changed. Review this item before saving.');
            checklist[index] = { ...checklist[index], isCompleted: change.completed };
        }
    }
    return { checklist, refresh: { ...data, marks } };
}
export function makeChecklistPolicy(previous: ChecklistRefreshPolicy | undefined, values: Pick<ChecklistRefreshPolicy, 'mode' | 'schedule' | 'end'> & { paused: boolean }, now: Date, deviceId: string): ChecklistRefreshPolicy {
    const result: ChecklistRefreshPolicy = { mode: values.mode, schedule: values.mode === 'custom' ? values.schedule : undefined,
        end: values.end, pausedAt: values.paused ? previous?.pausedAt ?? now.toISOString() : undefined,
        revision: (previous?.revision ?? 0) + 1, updatedAt: now.toISOString(), deviceId };
    validateChecklistRefresh({ version: 1, defaults: result, items: {}, marks: {} });
    if (result.mode === 'custom' && result.end.mode === 'date' && result.end.date! < result.schedule!.startDate) throw new Error('End date must not be earlier than the start date.');
    return result;
}
export function checklistTargetPolicy(task: Task, itemId?: string) {
    const data = checklistRefreshData(task);
    return itemId === undefined ? data.defaults : data.items[itemId];
}
export function updateChecklistPolicy(task: Task, itemId: string | undefined, policy: ChecklistRefreshPolicy): ChecklistRefreshData {
    if (task.deletedAt || task.purgedAt) throw new Error('This task is no longer available.');
    if (itemId !== undefined && (!safeKey(itemId) || !task.checklist?.some(item => item.id === itemId))) throw new Error('This checklist item no longer exists.');
    const data = checklistRefreshData(task);
    return itemId === undefined ? { ...data, defaults: policy } : { ...data, items: { ...data.items, [itemId]: policy } };
}
export function checklistEndPreview(tasks: readonly Task[], targets: ChecklistRefreshTarget[]) {
    const byId = new Map(tasks.map(task => [task.id, task]));
    return targets.map(target => {
        const task = byId.get(target.taskId);
        if (!task || task.deletedAt || task.purgedAt || target.itemId !== undefined && !task.checklist?.some(item => item.id === target.itemId)) throw new Error('A selected destination is no longer available.');
        return { ...target, fingerprint: stable({ parentTaskId: task.parentTaskId, policy: checklistTargetPolicy(task, target.itemId), effective: resolveChecklistRefresh(task, target.itemId, tasks) }),
            title: target.itemId === undefined ? task.title : `${task.title} / ${task.checklist!.find(item => item.id === target.itemId)!.title}`,
            end: checklistTargetPolicy(task, target.itemId)?.end ?? { mode: 'inherit' as const } };
    });
}
/** Preview snapshots are checked before any batch mutation; unrelated marks are preserved. */
export function checklistEndUpdates(tasks: readonly Task[], preview: ReturnType<typeof checklistEndPreview>, end: ChecklistRefreshEnd, now: Date, deviceId: string) {
    validateChecklistEnd(end);
    if (!preview.length) throw new Error('Select at least one destination.');
    const fresh = checklistEndPreview(tasks, preview);
    if (fresh.some((target, i) => target.fingerprint !== preview[i].fingerprint)) throw new Error('A selected rule changed after the preview. Review the selection again.');
    const result = new Map<string, ChecklistRefreshData>();
    for (const target of preview) {
        const original = tasks.find(task => task.id === target.taskId)!;
        const task = { ...original, planner: { version: 1 as const, blocks: [], days: [], ...original.planner, checklistRefresh: result.get(target.taskId) ?? checklistRefreshData(original) } };
        const old = checklistTargetPolicy(task, target.itemId);
        const policy = makeChecklistPolicy(old, { mode: old?.mode ?? 'inherit', schedule: old?.schedule, end, paused: !!old?.pausedAt }, now, deviceId);
        result.set(task.id, updateChecklistPolicy(task, target.itemId, policy));
    }
    return result;
}
/** Include indirect inheritors in the confirmation, without writing their own overrides. */
export function checklistEndImpact(tasks: readonly Task[], preview: ReturnType<typeof checklistEndPreview>, end: ChecklistRefreshEnd) {
    const changes = checklistEndUpdates(tasks, preview, end, new Date('2000-01-01T00:00:00Z'), 'preview');
    const after = tasks.map(task => changes.has(task.id) ? { ...task, planner: { version: 1 as const, blocks: [], days: [], ...task.planner, checklistRefresh: changes.get(task.id)! } } : task);
    const impact: Array<ChecklistRefreshTarget & { title: string; before?: string; after?: string }> = [];
    const afterById = new Map(after.map(task => [task.id, task]));
    for (const task of tasks) {
        if (task.deletedAt || task.purgedAt) continue;
        for (const itemId of [undefined, ...(task.checklist ?? []).map(item => item.id)]) {
            const before = resolveChecklistRefresh(task, itemId, tasks).endDate;
            const next = resolveChecklistRefresh(afterById.get(task.id)!, itemId, after).endDate;
            if (before !== next) impact.push({ taskId: task.id, itemId, before, after: next,
                title: itemId === undefined ? task.title : `${task.title} / ${task.checklist!.find(item => item.id === itemId)!.title}` });
        }
    }
    return impact;
}
export function checklistHistory(task: Task, item: ChecklistItem, tasks: readonly Task[], now: Date, limit = 8) {
    const state = checklistItemState(task, item, tasks, now), history = new Map<string, { id: string; day: string; dueAt: string; completed: boolean; current: boolean }>();
    for (const [id, mark] of Object.entries(checklistRefreshData(task).marks[item.id] ?? {})) {
        history.set(id, { id, day: mark.day, dueAt: mark.dueAt, completed: mark.completed, current: id === state.cycle?.id });
    }
    if (state.schedule && state.cycle) {
        let cycle: ChecklistCycle | undefined = state.cycle;
        for (let count = 0; cycle && count < limit; count++) {
            if (!history.has(cycle.id)) history.set(cycle.id, { ...cycle, completed: false, current: cycle.id === state.cycle?.id });
            cycle = findCycle(state.schedule, new Date(Date.parse(cycle.dueAt) - 1), -1, state.endDate);
        }
    }
    return [...history.values()].sort((a, b) => b.dueAt.localeCompare(a.dueAt) || a.id.localeCompare(b.id)).slice(0, limit);
}
