import type { ChecklistRefreshEnd, ChecklistRefreshPolicy, ChecklistRefreshSchedule, ChecklistRefreshTarget } from '@mindwtr/core';

/** A private, per-target working copy. The base never advances behind an unsaved edit. */
export type ChecklistRuleDraft = {
    base?: ChecklistRefreshPolicy;
    initial?: ChecklistRefreshSchedule;
    mode: ChecklistRefreshPolicy['mode'];
    schedule: ChecklistRefreshSchedule;
    end: ChecklistRefreshEnd;
    paused: boolean;
};
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const checklistRuleDraftKey = (target: ChecklistRefreshTarget) =>
    `attention-planner:checklist-rule-draft:v1:${JSON.stringify([target.taskId, target.itemId ?? null])}`;

export function checklistRuleDraftDirty(draft: ChecklistRuleDraft): boolean {
    return draft.mode !== (draft.base?.mode ?? 'inherit')
        || JSON.stringify(draft.end) !== JSON.stringify(draft.base?.end ?? { mode: 'inherit' })
        || draft.paused !== !!draft.base?.pausedAt
        || draft.mode === 'custom' && JSON.stringify(draft.schedule) !== JSON.stringify(draft.initial);
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validMode = (value: unknown) => ['inherit', 'custom', 'off'].includes(String(value));
// Drafts intentionally allow incomplete dates, times and timezones. Semantic validation belongs to Save.
const validEnd = (value: unknown) => record(value) && ['inherit', 'never', 'date'].includes(String(value.mode))
    && (value.date === undefined || typeof value.date === 'string');
const validSchedule = (value: unknown) => record(value) && typeof value.id === 'string'
    && (value.anchor === undefined || value.anchor === 'completion')
    && ['hourly', 'daily', 'weekly', 'monthly', 'yearly'].includes(String(value.frequency)) && typeof value.interval === 'number'
    && ['startDate', 'time', 'timeZone'].every(key => typeof value[key] === 'string')
    && ['weekdays', 'monthDays'].every(key => value[key] === undefined
        || Array.isArray(value[key]) && (value[key] as unknown[]).every(day => typeof day === 'number'));
function validDraft(value: unknown): value is ChecklistRuleDraft {
    if (!record(value) || !validMode(value.mode) || !validSchedule(value.schedule) || !validEnd(value.end)
        || typeof value.paused !== 'boolean' || value.initial !== undefined && !validSchedule(value.initial)) return false;
    const base = value.base;
    return base === undefined || record(base) && validMode(base.mode) && validEnd(base.end)
        && typeof base.revision === 'number' && typeof base.updatedAt === 'string' && typeof base.deviceId === 'string'
        && (base.pausedAt === undefined || typeof base.pausedAt === 'string')
        && (base.schedule === undefined || validSchedule(base.schedule));
}

/** The memory fallback survives target changes and detail unmounts even when browser storage is denied. */
export function createChecklistRuleDraftStore(getStorage: () => DraftStorage, onVolatileChange: (hasDrafts: boolean) => void = () => undefined) {
    const memory = new Map<string, ChecklistRuleDraft | null>();
    const volatile = new Set<string>();
    const cleared = (key: string): boolean => {
        // A tombstone prevents a failed remove from restoring stale storage in this session.
        memory.set(key, null);
        volatile.delete(key);
        onVolatileChange(volatile.size > 0);
        try { getStorage().removeItem(key); return true; } catch { return false; }
    };
    return {
        load(target: ChecklistRefreshTarget): { draft?: ChecklistRuleDraft; error?: 'storage' | 'invalid' } {
            const key = checklistRuleDraftKey(target);
            if (memory.has(key)) {
                const draft = memory.get(key);
                return { draft: draft ? structuredClone(draft) : undefined, ...(volatile.has(key) ? { error: 'storage' as const } : {}) };
            }
            try {
                const raw = getStorage().getItem(key);
                if (!raw) return {};
                const stored: unknown = JSON.parse(raw);
                if (!record(stored) || stored.version !== 1 || stored.taskId !== target.taskId
                    || stored.itemId !== (target.itemId ?? null) || !validDraft(stored.draft)) return { error: 'invalid' };
                if (!checklistRuleDraftDirty(stored.draft)) return {};
                memory.set(key, structuredClone(stored.draft));
                return { draft: structuredClone(stored.draft) };
            } catch (error) { return { error: error instanceof SyntaxError ? 'invalid' : 'storage' }; }
        },
        save(target: ChecklistRefreshTarget, draft: ChecklistRuleDraft): boolean {
            const key = checklistRuleDraftKey(target);
            if (!checklistRuleDraftDirty(draft)) return cleared(key);
            memory.set(key, structuredClone(draft));
            try {
                getStorage().setItem(key, JSON.stringify({ version: 1, taskId: target.taskId, itemId: target.itemId ?? null, draft }));
                volatile.delete(key);
                onVolatileChange(volatile.size > 0);
                return true;
            } catch {
                volatile.add(key);
                onVolatileChange(true);
                return false;
            }
        },
        clear(target: ChecklistRefreshTarget): boolean { return cleared(checklistRuleDraftKey(target)); },
        hasDrafts(targets: readonly ChecklistRefreshTarget[]): boolean {
            return targets.some(target => !!this.load(target).draft);
        },
    };
}

const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
export const checklistRuleDrafts = createChecklistRuleDraftStore(() => window.localStorage, hasDrafts => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('beforeunload', warnBeforeUnload);
    if (hasDrafts) window.addEventListener('beforeunload', warnBeforeUnload);
});
