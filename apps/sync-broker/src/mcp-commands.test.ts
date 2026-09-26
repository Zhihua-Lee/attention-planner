import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData, Task } from '../../../packages/core/src/types';
import { activeWorkBlocks, scheduleWork } from '../../../packages/core/src/planner';
import { applyMcpCommand, McpCommandConflict, parseMcpCommand, prepareMcpCommand } from './mcp-commands';

const now = new Date('2026-09-26T15:00:00.000Z');
const task = (id: string, props: Partial<Task> = {}): Task => ({
    id, title: `Task ${id}`, status: 'next', tags: [], contexts: [],
    createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z', rev: 3,
    ...props,
});
const snapshot = (...tasks: Task[]): AppData => ({ tasks, projects: [], sections: [], areas: [], settings: {} });
const options = { now, operationId: 'fixture-operation' };
const withBlock = (item: Task, id: string, startAt = '2026-09-27T15:00:00Z'): Task => ({
    ...item, ...scheduleWork(item, { id, startAt, timeZone: 'America/Chicago', durationMinutes: 30 },
        { now, deviceId: 'fixture-device' }),
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe('MCP command allowlist and snapshot isolation', () => {
    it('rejects raw patches, lifecycle fields on drafts, unbounded text and ambiguous dates', () => {
        const invalid = [
            { type: 'create_draft', title: 'New', status: 'done' },
            { type: 'create_draft', title: 'New', parentTaskId: 'p' },
            { type: 'create_draft', title: 'New', checklist: [{ title: 'Step', isCompleted: true }] },
            { type: 'update_content', taskId: 'a', title: 'New', settings: {} },
            { type: 'update_content', taskId: 'a' },
            { type: 'update_content', taskId: 'a', description: 'a'.repeat(50_001) },
            { type: 'set_dates', taskId: 'a', availableAt: '2026-02-30' },
            { type: 'set_dates', taskId: 'a', dueDate: '2026-09-27T12:30:00' },
            { type: 'schedule_work', taskId: 'a', startAt: '2026-09-27T12:30:00Z', durationMinutes: 30, timeZone: 'Not/AZone' },
        ];
        for (const input of invalid) expect(() => parseMcpCommand(input)).toThrow();
    });

    it('creates only an Inbox draft and preserves unknown fields and settings exactly', async () => {
        const data = { ...snapshot(task('existing', { attachments: [{ id: 'secret', kind: 'link', title: 'Private link',
            uri: 'https://example.invalid/private-token', createdAt: now.toISOString(), updatedAt: now.toISOString() }] })),
            futureExtension: { version: 42 }, settings: { deviceId: 'local-pwa', futureSetting: 'keep' } };
        const before = structuredClone(data);
        const prepared = await prepareMcpCommand(data, { type: 'create_draft', title: '  Draft  ',
            description: 'A proposed outline', checklist: [{ title: 'Read' }] }, options);
        expect(data).toEqual(before);
        expect(JSON.stringify(prepared)).not.toContain('private-token');
        const result = await applyMcpCommand(data, prepared);
        expect(result.createdTaskId).toBe(prepared.generatedTaskId);
        expect(result.data.tasks[1]).toMatchObject({ id: prepared.generatedTaskId, title: 'Draft', status: 'inbox',
            description: 'A proposed outline', rev: 1, revBy: 'attention-planner-mcp',
            checklist: [{ title: 'Read', isCompleted: false }] });
        expect(result.data.settings).toEqual(before.settings);
        expect(result.data).toHaveProperty('futureExtension.version', 42);
        expect(result.data.tasks[0]).toEqual(before.tasks[0]);
        expect(data).toEqual(before);
        const retry = await applyMcpCommand(data, prepared);
        expect(retry.createdTaskId).toBe(result.createdTaskId);
        await expect(applyMcpCommand(result.data, prepared)).rejects.toBeInstanceOf(McpCommandConflict);
    });

    it('rejects stale body edits even when the client failed to increment a revision', async () => {
        const data = snapshot(task('a', { description: 'Before' }));
        const prepared = await prepareMcpCommand(data, { type: 'update_content', taskId: 'a', description: 'Proposed' }, options);
        const changed = structuredClone(data);
        changed.tasks[0].description = 'Changed on phone';
        await expect(applyMcpCommand(changed, prepared)).rejects.toBeInstanceOf(McpCommandConflict);
        changed.tasks[0].description = 'Before';
        changed.tasks.push(task('unrelated'));
        await expect(applyMcpCommand(changed, prepared)).rejects.toBeInstanceOf(McpCommandConflict);
    });

    it('does not treat JSON property order or omitted undefined keys as data changes', async () => {
        const data = snapshot(task('a'));
        const prepared = await prepareMcpCommand(data, { type: 'update_content', taskId: 'a', title: 'Edited' }, options);
        const reordered = { ...data, tasks: data.tasks.map(item => Object.fromEntries(Object.entries(item).reverse()) as Task) };
        await expect(applyMcpCommand(reordered, prepared)).resolves.toMatchObject({ changedTaskIds: ['a'] });
    });

    it('has no state leaks across parallel snapshots', async () => {
        const [a, b] = await Promise.all(['Alice', 'Bob'].map(async title => {
            const data = snapshot(task('same-id', { title }));
            const prepared = await prepareMcpCommand(data, { type: 'update_content', taskId: 'same-id', description: `${title} draft` }, options);
            return (await applyMcpCommand(data, prepared)).data;
        }));
        expect(a.tasks[0]).toMatchObject({ title: 'Alice', description: 'Alice draft' });
        expect(b.tasks[0]).toMatchObject({ title: 'Bob', description: 'Bob draft' });
    });
});

describe('MCP existing-task commands reuse core business rules', () => {
    it('preserves checklist identities, completion states and future item fields', async () => {
        const item = { id: 'step', title: 'Before', isCompleted: true, futureField: 'keep' };
        const data = snapshot(task('a', { checklist: [item] }));
        const prepared = await prepareMcpCommand(data, { type: 'update_content', taskId: 'a', checklist: [
            { id: 'step', title: 'Edited' }, { title: 'New step' },
        ] }, options);
        const result = await applyMcpCommand(data, prepared);
        expect(result.data.tasks[0].checklist).toEqual([
            { ...item, title: 'Edited' }, expect.objectContaining({ title: 'New step', isCompleted: false }),
        ]);
        await expect(prepareMcpCommand(data, { type: 'update_content', taskId: 'a', checklist: [
            { id: 'unknown', title: 'Bad' },
        ] }, options)).rejects.toThrow('Unknown checklist');
        expect(() => parseMcpCommand({ type: 'update_content', taskId: 'a', checklist: [item, item] })).toThrow();
    });

    it('rejects parent cycles and supports moving an independent child back out', async () => {
        const data = snapshot(task('parent'), task('child', { parentTaskId: 'parent' }));
        await expect(prepareMcpCommand(data, { type: 'move_task', taskId: 'parent', parentTaskId: 'child' }, options)).rejects.toThrow('descendants');
        const prepared = await prepareMcpCommand(data, { type: 'move_task', taskId: 'child', parentTaskId: null }, options);
        const result = await applyMcpCommand(data, prepared);
        expect(result.data.tasks[1].parentTaskId).toBeUndefined();
        expect(result.data.tasks[0]).toEqual(data.tasks[0]);
    });

    it('soft-deletes only the selected parent and keeps independent children and attachments', async () => {
        const data = snapshot(task('parent'), task('child', { parentTaskId: 'parent' }));
        const prepared = await prepareMcpCommand(data, { type: 'delete_task', taskId: 'parent' }, options);
        expect(prepared.warnings.join(' ')).toContain('独立子任务仍会保留');
        const result = await applyMcpCommand(data, prepared);
        expect(result.data.tasks[0].deletedAt).toBe(now.toISOString());
        expect(result.data.tasks[0].purgedAt).toBeUndefined();
        expect(result.data.tasks[1]).toEqual(data.tasks[1]);
        expect(result.data.settings.attachments).toBeUndefined();
    });

    it('completes through the shared recurrence engine and closes remaining reservations', async () => {
        const data = snapshot(withBlock(task('parent', { recurrence: { rule: 'daily' }, dueDate: '2026-09-26',
            checklist: [{ id: 'step', title: 'Step', isCompleted: true }] }), 'block'), task('child', { parentTaskId: 'parent' }));
        const prepared = await prepareMcpCommand(data, { type: 'complete_task', taskId: 'parent' }, options);
        const result = await applyMcpCommand(data, prepared);
        expect(result.data.tasks[0]).toMatchObject({ status: 'done', completedAt: now.toISOString(), rev: 4 });
        expect(activeWorkBlocks(result.data.tasks[0])).toEqual([]);
        expect(result.data.tasks[0].planner?.blocks[0]).toMatchObject({ state: 'cancelled', reason: 'task-completed' });
        expect(result.data.tasks[1]).toEqual(data.tasks[1]);
        expect(result.data.tasks[2]).toMatchObject({ title: 'Task parent', dueDate: '2026-09-27', status: 'next', rev: 1,
            checklist: [{ title: 'Step', isCompleted: false }] });
        expect(prepared.additionalTasks[0].id).toBe(result.data.tasks[2].id);
        const second = await applyMcpCommand(data, prepared);
        expect(second.data.tasks[2].id).toBe(result.data.tasks[2].id);
    });

    it('uses core follow-up de-duplication and recurrence count limits', async () => {
        const original = task('a', { recurrence: { rule: 'daily' }, dueDate: '2026-09-26' });
        const data = snapshot(original, task('already-next', { title: original.title, recurrence: { rule: 'daily', seriesId: 'a' }, dueDate: '2026-09-27' }));
        const prepared = await prepareMcpCommand(data, { type: 'complete_task', taskId: 'a' }, options);
        const result = await applyMcpCommand(data, prepared);
        expect(result.data.tasks).toHaveLength(2);
        const limited = snapshot(task('a', { recurrence: { rule: 'daily', count: 1 }, dueDate: '2026-09-26' }));
        const final = await prepareMcpCommand(limited, { type: 'complete_task', taskId: 'a' }, options);
        expect(final.additionalTasks).toEqual([]);
    });

    it('pins the approved completion and next-occurrence dates even if approval happens later', async () => {
        const data = snapshot(task('a', { recurrence: { rule: 'daily', strategy: 'fluid' }, dueDate: '2026-09-26' }));
        const prepared = await prepareMcpCommand(data, { type: 'complete_task', taskId: 'a' }, options);
        vi.setSystemTime(new Date('2026-09-27T03:00:00Z'));
        const result = await applyMcpCommand(data, prepared);
        expect(result.data.tasks[0].completedAt).toBe(prepared.after.completedAt);
        expect(result.data.tasks[1].dueDate).toBe(prepared.additionalTasks[0].dueDate);
        expect(result.data.tasks[1].id).toBe(prepared.additionalTasks[0].id);
    });

    it('reopens without deleting the next occurrence or reactivating cancelled reservations', async () => {
        const data = snapshot(withBlock(task('a'), 'block'));
        const completed = await applyMcpCommand(data, await prepareMcpCommand(data, { type: 'complete_task', taskId: 'a' }, options));
        const prepared = await prepareMcpCommand(completed.data, { type: 'reopen_task', taskId: 'a' }, options);
        const result = await applyMcpCommand(completed.data, prepared);
        expect(result.data.tasks[0]).toMatchObject({ status: 'next' });
        expect(result.data.tasks[0].completedAt).toBeUndefined();
        expect(result.data.tasks[0].planner?.blocks[0].state).toBe('cancelled');
    });
});

describe('MCP dates and work reservations', () => {
    it('clears legacy availability without resurrecting it or cancelling independent blocks', async () => {
        const data = snapshot(withBlock(task('a', { startTime: '2026-09-26', availableAt: '2026-09-26', status: 'inbox' }), 'block'));
        const prepared = await prepareMcpCommand(data, { type: 'set_dates', taskId: 'a', availableAt: null }, options);
        const result = await applyMcpCommand(data, prepared);
        expect(result.data.tasks[0].availableAt).toBeUndefined();
        expect(result.data.tasks[0].startTime).toBeUndefined();
        expect(result.data.tasks[0].status).toBe('inbox');
        expect(activeWorkBlocks(result.data.tasks[0])).toHaveLength(1);
    });

    it('rejects invalid dates and protects a reference note from discarded schedule writes', async () => {
        const data = snapshot(task('a', { status: 'reference' }));
        await expect(prepareMcpCommand(data, { type: 'set_dates', taskId: 'a', dueDate: '2026-09-27' }, options)).rejects.toThrow('Reference notes');
        await expect(prepareMcpCommand(data, { type: 'set_dates', taskId: 'a', dueDate: '2026-02-30' }, options)).rejects.toThrow();
    });

    it('schedules planner blocks, discloses external-calendar uncertainty and detects known overlaps', async () => {
        const data = snapshot(task('a'), withBlock(task('b'), 'busy'));
        const command = { type: 'schedule_work', taskId: 'a', startAt: '2026-09-27T15:15:00Z', durationMinutes: 30, timeZone: 'America/Chicago' };
        await expect(prepareMcpCommand(data, command, options)).rejects.toThrow('overlaps');
        const prepared = await prepareMcpCommand(data, { ...command, startAt: '2026-09-27T16:00:00Z' }, options);
        expect(prepared.warnings.join(' ')).toContain('尚未检查 Outlook');
        const result = await applyMcpCommand(data, prepared);
        expect(result.data.tasks[0].scheduledAt).toBeUndefined();
        expect(result.data.tasks[0].startTime).toBeUndefined();
        expect(result.data.tasks[0].planner?.blocks[0]).toMatchObject({ id: prepared.generatedBlockId,
            startAt: '2026-09-27T16:00:00.000Z', durationMinutes: 30, timeZone: 'America/Chicago' });
        const cancelled = await applyMcpCommand(result.data, await prepareMcpCommand(result.data,
            { type: 'cancel_work', taskId: 'a', blockId: prepared.generatedBlockId }, options));
        expect(activeWorkBlocks(cancelled.data.tasks[0])).toEqual([]);
    });

    it('moves one reservation without overlapping itself or changing total effort', async () => {
        const data = snapshot(withBlock(task('a', { timeEstimate: '2hr' }), 'existing'));
        const prepared = await prepareMcpCommand(data, { type: 'schedule_work', taskId: 'a', blockId: 'existing',
            startAt: '2026-09-27T15:15:00Z', durationMinutes: 45, timeZone: 'America/Chicago' }, options);
        const result = await applyMcpCommand(data, prepared);
        expect(result.data.tasks[0].timeEstimate).toBe('2hr');
        expect(result.data.tasks[0].planner?.blocks).toHaveLength(1);
        expect(result.data.tasks[0].planner?.blocks[0].history).toHaveLength(1);
    });
});
