import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData, Task } from '../../../packages/core/src/types';
import { scheduleWork } from '../../../packages/core/src/planner';
import { projectTask } from './mcp-projection';
import { createMcpService, type McpActor, type McpOperation } from './mcp-service';

const NOW = new Date('2026-09-26T12:00:00.000Z');
const PRIVATE = 'PRIVATE_FUTURE_EXTENSION_FIXTURE';
const actor: McpActor = {
    email: 'owner@example.invalid', clientId: 'fixture-client', grantId: 'fixture-grant',
    scopes: ['tasks:read', 'tasks:propose'],
};

function task(): Task {
    return { id: 'task-one', title: 'Fixture task', status: 'next', tags: [], contexts: [],
        createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
        description: 'Visible task body', rev: 1 };
}

function withPrivateExtensions(): Task {
    const original = task();
    const planned = { ...original, ...scheduleWork(original, {
        id: 'block-one', startAt: '2026-09-30T15:00:00Z', durationMinutes: 30, timeZone: 'America/Chicago',
    }, { now: NOW, deviceId: 'fixture-device' }) };
    return {
        ...planned,
        futureTaskExtension: PRIVATE,
        checklist: [{ id: 'step-one', title: 'Visible checklist step', isCompleted: false, futureItemExtension: PRIVATE }],
        recurrence: { rule: 'daily', byDay: ['MO'], futureRecurrenceExtension: PRIVATE },
        planner: {
            ...planned.planner!, futurePlannerExtension: PRIVATE,
            blocks: planned.planner!.blocks.map(block => ({ ...block, futureBlockExtension: PRIVATE,
                history: [{ startAt: block.startAt, durationMinutes: 30, at: NOW.toISOString(), reason: 'manual', futureHistoryExtension: PRIVATE }] })),
            days: [{ date: '2026-09-30', selected: true, revision: 1, manualRevision: 1,
                updatedAt: NOW.toISOString(), deviceId: 'fixture-device', futureDayExtension: PRIVATE }],
        },
    } as unknown as Task;
}

function harness(initial: Task) {
    let data: AppData = { tasks: [structuredClone(initial)], projects: [], sections: [], areas: [], settings: {} };
    const operations = new Map<string, McpOperation>();
    const write = vi.fn(async (_snapshot: unknown, next: AppData) => { data = structuredClone(next); return '2'; });
    const service = createMcpService({
        origin: 'https://todo.example.invalid', now: () => NOW.getTime(),
        grantActive: async () => true,
        store: {
            get: async id => { const value = operations.get(id); return value && structuredClone(value); },
            put: async value => { operations.set(value.id, structuredClone(value)); },
        },
        read: async () => ({ data: structuredClone(data), fileId: 'fixture-file', revision: '1', etag: '"fixture-etag"' }),
        write,
    });
    return { service, write, operations, data: () => data };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe('MCP display projections', () => {
    it('omits private extensions from every nested display object without mutating stored data', () => {
        const original = withPrivateExtensions();
        const before = structuredClone(original);
        const projected = projectTask(original);
        expect(JSON.stringify(projected)).not.toContain(PRIVATE);
        expect(projected).toMatchObject({ title: 'Fixture task', description: 'Visible task body',
            checklist: [{ id: 'step-one', title: 'Visible checklist step', isCompleted: false }],
            recurrence: { rule: 'daily', byDay: ['MO'] },
            planner: { blocks: [{ id: 'block-one', durationMinutes: 30,
                history: [{ reason: 'manual', durationMinutes: 30 }] }], days: [{ date: '2026-09-30', selected: true }] } });
        expect(original).toEqual(before);
    });

    it('keeps unknown stored fields while excluding them from reads, proposal responses and previews', async () => {
        const original = withPrivateExtensions();
        const h = harness(original);
        const read = await h.service.call(actor, 'get_task', { id: original.id });
        expect(JSON.stringify(read)).not.toContain(PRIVATE);
        const operation = await h.service.call(actor, 'propose_change', {
            idempotencyKey: 'projection-fixture-key-001',
            command: { type: 'update_content', taskId: original.id, description: 'Approved fixture body' },
        }) as { id: string; status: string };
        expect(operation.status).toBe('pending');
        expect(JSON.stringify(operation)).not.toContain(PRIVATE);
        expect(JSON.stringify(h.operations.get(operation.id)?.prepared)).not.toContain(PRIVATE);
        expect(h.write).not.toHaveBeenCalled();
        await h.service.decide(actor.email, operation.id, 'approve');
        const saved = h.data().tasks[0] as Task & { futureTaskExtension: string };
        expect(saved.description).toBe('Approved fixture body');
        expect(saved.futureTaskExtension).toBe(PRIVATE);
        expect(saved.checklist).toEqual(original.checklist);
        expect(saved.recurrence).toEqual(original.recurrence);
        expect(saved.planner?.blocks).toEqual(original.planner?.blocks);
        expect(saved.planner?.days).toEqual(original.planner?.days);
        expect(saved.planner).toHaveProperty('futurePlannerExtension', PRIVATE);
    });

    it('shows a legacy availability date before asking the owner to clear it', async () => {
        const original = { ...task(), startTime: '2026-09-30' };
        const h = harness(original);
        const operation = await h.service.call(actor, 'propose_change', {
            idempotencyKey: 'projection-fixture-key-002',
            command: { type: 'set_dates', taskId: original.id, availableAt: null },
        }) as { id: string; changes: Array<{ fields: Array<{ name: string; before: unknown; after: unknown }> }> };
        expect(operation.changes[0].fields).toContainEqual({ name: 'availableAt', before: '2026-09-30', after: null });
        expect(h.write).not.toHaveBeenCalled();
        await h.service.decide(actor.email, operation.id, 'approve');
        expect(h.data().tasks[0].startTime).toBeUndefined();
        expect(projectTask(h.data().tasks[0]).availableAt).toBeUndefined();
    });

    it('retains supported legacy string recurrence in read projections', () => {
        expect(projectTask({ ...task(), recurrence: 'daily' }).recurrence).toBe('daily');
    });
});
