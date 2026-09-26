import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData, Task } from '../../../packages/core/src/types';
import { createMcpService, type McpActor, type McpOperation } from './mcp-service';
import type { McpSnapshot } from './mcp-drive';

const now = new Date('2026-09-26T15:00:00Z').getTime();
const actor: McpActor = { email: 'owner@example.invalid', clientId: 'client-a', grantId: 'grant-a',
    scopes: ['tasks:read', 'tasks:create', 'tasks:propose'] };
const task = (id: string, props: Partial<Task> = {}): Task => ({ id, title: `Task ${id}`, status: 'next',
    tags: [], contexts: [], createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), ...props });
const envelope = (command: unknown, idempotencyKey = 'fixture-request-key-0001') => ({ idempotencyKey, command });
type OperationReply = { id: string; status: string; confirmationUrl?: string; receipt?: { createdTaskId?: string } };

function harness(initial: Task[] = [task('a', { description: 'Original content' })]) {
    let time = now, revision = 1;
    let data: AppData = { tasks: structuredClone(initial), projects: [], sections: [], areas: [],
        settings: { ai: { apiKey: 'NEVER_EXPOSE_SETTINGS_TOKEN' } } };
    const operations = new Map<string, McpOperation>();
    const active = new Set([actor.grantId, 'grant-b']);
    let writeMode: 'ok' | 'conflict' | 'lost_reply' | 'offline' = 'ok';
    const store = {
        get: vi.fn(async (id: string) => {
            const op = operations.get(id);
            return op && structuredClone(op);
        }),
        put: vi.fn(async (op: McpOperation) => { operations.set(op.id, structuredClone(op)); }),
    };
    const read = vi.fn(async (): Promise<McpSnapshot> => ({ data: structuredClone(data), fileId: 'fixture-file',
        revision: String(revision), etag: `"revision-${revision}"`, modifiedTime: new Date(time).toISOString() }));
    const write = vi.fn(async (base: McpSnapshot, next: AppData): Promise<string> => {
        if (base.revision !== String(revision) || writeMode === 'conflict') throw Object.assign(new Error('Concurrent edit'), { status: 412 });
        if (writeMode === 'offline') throw Object.assign(new Error('Offline'), { status: 502 });
        data = structuredClone(next); revision++;
        if (writeMode === 'lost_reply') throw Object.assign(new Error('Response lost after accepted write'), { status: 502 });
        return String(revision);
    });
    const deps = { store, read, write, grantActive: async (principal: McpActor) => active.has(principal.grantId),
        origin: 'https://todo.example.invalid', now: () => time };
    return {
        service: createMcpService(deps), restart: () => createMcpService(deps), read, write, store, operations,
        data: () => data, setMode: (mode: typeof writeMode) => { writeMode = mode; },
        revoke: () => { active.delete(actor.grantId); }, advance: (milliseconds: number) => { time += milliseconds; },
        externalEdit: (body: string) => { data.tasks[0].description = body; revision++; },
    };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe('remote MCP read and authorization boundaries', () => {
    it('returns safe projections, paginates summaries and labels the last-synced source', async () => {
        const h = harness([task('a', { description: 'Body', attachments: [{ id: 'file', kind: 'link', title: 'Attachment',
            uri: 'https://example.invalid/NEVER_EXPOSE_ATTACHMENT', createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }] }),
        task('b'), task('deleted', { deletedAt: new Date(now).toISOString() })]);
        const list = await h.service.call(actor, 'list_tasks', { limit: 1 });
        expect(list).toMatchObject({ total: 2, nextOffset: 1, tasks: [{ id: 'a' }], revision: '1' });
        expect(JSON.stringify(list)).not.toContain('Body');
        expect(JSON.stringify(list)).toContain('unsynced device changes are not visible');
        const detail = await h.service.call(actor, 'get_task', { id: 'a' });
        expect(detail).toMatchObject({ task: { description: 'Body' } });
        expect(JSON.stringify(detail)).not.toContain('NEVER_EXPOSE');
        await expect(h.service.call(actor, 'get_task', { id: 'deleted' })).rejects.toMatchObject({ code: 'not_found' });
        expect(h.write).not.toHaveBeenCalled();
    });

    it('enforces read/create/propose scopes before reading Drive or changing data', async () => {
        const h = harness();
        const readOnly = { ...actor, scopes: ['tasks:read'] }, createOnly = { ...actor, scopes: ['tasks:create'] };
        await expect(h.service.call(createOnly, 'get_task', { id: 'a' })).rejects.toMatchObject({ code: 'insufficient_scope' });
        await expect(h.service.call(readOnly, 'create_draft', envelope({ type: 'create_draft', title: 'Draft' }))).rejects.toMatchObject({ code: 'insufficient_scope' });
        await expect(h.service.call(readOnly, 'propose_change', envelope({ type: 'delete_task', taskId: 'a' }))).rejects.toMatchObject({ code: 'insufficient_scope' });
        expect(h.read).not.toHaveBeenCalled();
        expect(h.write).not.toHaveBeenCalled();
    });

    it('cannot use propose-only permission to read the old body through a change preview', async () => {
        const h = harness();
        await expect(h.service.call({ ...actor, scopes: ['tasks:propose'] }, 'propose_change',
            envelope({ type: 'update_content', taskId: 'a', description: 'Probe' }))).rejects.toMatchObject({ code: 'insufficient_scope' });
        expect(h.read).not.toHaveBeenCalled();
    });

    it('binds operation reads to the issuing grant and requires current-token scopes', async () => {
        const h = harness();
        const operation = await h.service.call(actor, 'create_draft', envelope({ type: 'create_draft', title: 'Private draft' })) as OperationReply;
        await expect(h.service.call({ ...actor, grantId: 'grant-b', clientId: 'client-b' }, 'get_operation', { id: operation.id }))
            .rejects.toMatchObject({ code: 'not_found' });
        await expect(h.service.call({ ...actor, scopes: [] }, 'get_operation', { id: operation.id }))
            .rejects.toMatchObject({ code: 'insufficient_scope' });
        await expect(h.service.call(actor, 'get_operation', { id: operation.id })).resolves.toMatchObject({ status: 'applied' });
    });

    it('rejects revoked clients before read access', async () => {
        const h = harness(); h.revoke();
        await expect(h.service.call(actor, 'list_tasks', {})).rejects.toMatchObject({ code: 'revoked' });
        expect(h.read).not.toHaveBeenCalled();
    });
});

describe('remote MCP proposals, idempotency and human approval', () => {
    it('creates an Inbox draft directly once per key and rejects key reuse for different content', async () => {
        const h = harness();
        const input = envelope({ type: 'create_draft', title: 'Draft', description: 'Outline' });
        const first = await h.service.call(actor, 'create_draft', input) as OperationReply;
        const again = await h.service.call(actor, 'create_draft', input) as OperationReply;
        expect(first.status).toBe('applied');
        expect(again.receipt?.createdTaskId).toBe(first.receipt?.createdTaskId);
        expect(h.write).toHaveBeenCalledTimes(1);
        expect(h.data().tasks).toHaveLength(2);
        expect(h.data().tasks[1]).toMatchObject({ title: 'Draft', status: 'inbox', description: 'Outline' });
        await expect(h.service.call(actor, 'create_draft', envelope({ type: 'create_draft', title: 'Different' })))
            .rejects.toMatchObject({ code: 'key_reused' });
    });

    it('does not mutate an existing task until the authenticated owner approves', async () => {
        const h = harness();
        const op = await h.service.call(actor, 'propose_change', envelope({ type: 'update_content', taskId: 'a', description: 'Proposed body' })) as OperationReply;
        expect(op).toMatchObject({ status: 'pending', confirmationUrl: `https://todo.example.invalid/api/mcp/proposals/${op.id}` });
        expect(h.data().tasks[0].description).toBe('Original content');
        expect(h.write).not.toHaveBeenCalled();
        await expect(h.service.decide('stranger@example.invalid', op.id, 'approve')).rejects.toMatchObject({ code: 'not_found' });
        await expect(h.service.call(actor, 'approve', { id: op.id })).rejects.toMatchObject({ code: 'unknown_tool' });
        expect(h.write).not.toHaveBeenCalled();
        await expect(h.service.decide(actor.email, op.id, 'approve')).resolves.toMatchObject({ status: 'applied' });
        expect(h.data().tasks[0].description).toBe('Proposed body');
        await h.service.decide(actor.email, op.id, 'approve');
        expect(h.write).toHaveBeenCalledTimes(1);
    });

    it('rejects a proposal permanently without applying it', async () => {
        const h = harness();
        const op = await h.service.call(actor, 'propose_change', envelope({ type: 'delete_task', taskId: 'a' })) as OperationReply;
        await expect(h.service.decide(actor.email, op.id, 'reject')).resolves.toMatchObject({ status: 'rejected' });
        await expect(h.service.decide(actor.email, op.id, 'approve')).resolves.toMatchObject({ status: 'rejected' });
        expect(h.write).not.toHaveBeenCalled();
    });

    it('rechecks revocation between preview and approval', async () => {
        const h = harness();
        const op = await h.service.call(actor, 'propose_change', envelope({ type: 'complete_task', taskId: 'a' })) as OperationReply;
        h.revoke();
        await expect(h.service.decide(actor.email, op.id, 'approve')).rejects.toMatchObject({ code: 'revoked' });
        expect(h.write).not.toHaveBeenCalled();
    });

    it('rejects stale approvals after an external device edit instead of overwriting it', async () => {
        const h = harness();
        const op = await h.service.call(actor, 'propose_change', envelope({ type: 'update_content', taskId: 'a', description: 'AI draft' })) as OperationReply;
        h.externalEdit('New phone edit');
        await expect(h.service.decide(actor.email, op.id, 'approve')).rejects.toMatchObject({ code: 'conflict' });
        expect(h.operations.get(op.id)?.status).toBe('conflict');
        expect(h.data().tasks[0].description).toBe('New phone edit');
        expect(h.write).not.toHaveBeenCalled();
    });

    it('expires pending proposals before performing a write', async () => {
        const h = harness();
        const op = await h.service.call(actor, 'propose_change', envelope({ type: 'delete_task', taskId: 'a' })) as OperationReply;
        h.advance(24 * 60 * 60 * 1000 + 1);
        await expect(h.service.decide(actor.email, op.id, 'approve')).rejects.toMatchObject({ code: 'expired' });
        expect(h.write).not.toHaveBeenCalled();
    });
});

describe('remote MCP conditional writes and uncertain outcomes', () => {
    it('records a Drive precondition conflict without reporting an applied change', async () => {
        const h = harness();
        const op = await h.service.call(actor, 'propose_change', envelope({ type: 'complete_task', taskId: 'a' })) as OperationReply;
        h.setMode('conflict');
        await expect(h.service.decide(actor.email, op.id, 'approve')).resolves.toMatchObject({ status: 'conflict' });
        expect(h.data().tasks[0].status).toBe('next');
        await h.service.decide(actor.email, op.id, 'approve');
        expect(h.write).toHaveBeenCalledTimes(1);
    });

    it('reconciles an accepted write with a lost reply after restart without completing twice', async () => {
        const h = harness([task('a', { recurrence: { rule: 'daily' }, dueDate: '2026-09-26' })]);
        const op = await h.service.call(actor, 'propose_change', envelope({ type: 'complete_task', taskId: 'a' })) as OperationReply;
        h.setMode('lost_reply');
        await expect(h.service.decide(actor.email, op.id, 'approve')).resolves.toMatchObject({ status: 'uncertain' });
        expect(h.data().tasks).toHaveLength(2);
        expect(h.data().tasks[0].status).toBe('done');
        const restarted = h.restart();
        await expect(restarted.call(actor, 'get_operation', { id: op.id })).resolves.toMatchObject({ status: 'applied' });
        await restarted.decide(actor.email, op.id, 'approve');
        expect(h.write).toHaveBeenCalledTimes(1);
        expect(h.data().tasks).toHaveLength(2);
    });

    it('does not blindly retry an uncertain failure when no accepted write can be proven', async () => {
        const h = harness(); h.setMode('offline');
        const input = envelope({ type: 'create_draft', title: 'Draft' });
        const op = await h.service.call(actor, 'create_draft', input) as OperationReply;
        expect(op.status).toBe('uncertain');
        h.setMode('ok');
        await expect(h.service.call(actor, 'create_draft', input)).resolves.toMatchObject({ status: 'uncertain' });
        expect(h.write).toHaveBeenCalledTimes(1);
        expect(h.data().tasks).toHaveLength(1);
    });
});
