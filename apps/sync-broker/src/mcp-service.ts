import { z } from 'zod';
import type { Task } from '../../../packages/core/src/types';
import { getTaskAvailableAt } from '../../../packages/core/src/task-time-semantics';
import { projectTask } from './mcp-projection';
import { applyMcpCommand, prepareMcpCommand, parseMcpCommand, type PreparedMcpCommand } from './mcp-commands';
import type { McpSnapshot } from './mcp-drive';

export type McpActor = { email: string; clientId: string; grantId: string; scopes: string[] };
export type ProposalStatus = 'pending' | 'writing' | 'applied' | 'rejected' | 'conflict' | 'uncertain';
export type TaskChange = { id: string; title: string; fields: { name: string; before: unknown; after: unknown }[] };
export type McpOperation = {
    id: string; actor: McpActor; requestHash: string; prepared: PreparedMcpCommand;
    createdAt: string; expiresAt: number; status: ProposalStatus; changes: TaskChange[];
    receipt?: { changedTaskIds: string[]; createdTaskId?: string; effectHash: string; revision?: string };
};
export interface McpOperationStore {
    get(id: string): Promise<McpOperation | undefined>;
    put(operation: McpOperation): Promise<void>;
}
export type McpServiceDependencies = {
    store: McpOperationStore;
    read: () => Promise<McpSnapshot>;
    write: (snapshot: McpSnapshot, data: McpSnapshot['data']) => Promise<string>;
    grantActive: (actor: McpActor) => Promise<boolean>;
    origin: string;
    now?: () => number;
};
export class McpServiceError extends Error {
    constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}
const idSchema = z.string().min(1).max(160);
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{16,100}$/);
export const taskListSchema = z.object({
    query: z.string().max(200).optional(),
    status: z.enum(['inbox', 'next', 'waiting', 'someday', 'done', 'archived', 'reference']).optional(),
    parentTaskId: idSchema.optional(), limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).max(100_000).default(0),
}).strict();
export const taskGetSchema = z.object({ id: idSchema }).strict();
export const operationGetSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const commandEnvelopeSchema = z.object({ idempotencyKey: keySchema, command: z.unknown() }).strict();

export async function mcpHash(value: unknown): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
}
const nowIso = (time: number) => new Date(time).toISOString();
const shownFields = ['title', 'description', 'checklist', 'status', 'completedAt', 'deletedAt',
    'parentTaskId', 'projectId', 'areaId', 'availableAt', 'dueDate', 'planner', 'recurrence'] as const;
function changesBetween(before: Task[], after: Task[], ids: string[]): TaskChange[] {
    return ids.map(id => {
        const oldTask = before.find(t => t.id === id), newTask = after.find(t => t.id === id);
        const old = oldTask && projectTask(oldTask), task = newTask && projectTask(newTask);
        return { id, title: task?.title ?? old?.title ?? id, fields: shownFields
            .filter(name => JSON.stringify(old?.[name]) !== JSON.stringify(task?.[name]))
            .map(name => ({ name, before: old?.[name] ?? null, after: task?.[name] ?? null })) };
    });
}
async function effectHash(tasks: Task[], ids: string[]): Promise<string> {
    return mcpHash([...ids].sort().map(id => tasks.find(t => t.id === id) ?? null));
}
function taskSummary(task: Task) {
    return { id: task.id, title: task.title, status: task.status, parentTaskId: task.parentTaskId,
        projectId: task.projectId, areaId: task.areaId, updatedAt: task.updatedAt,
        availableAt: getTaskAvailableAt(task), dueDate: task.dueDate, childHint: 'Use list_tasks with parentTaskId to read independent children.' };
}
function taskDetails(task: Task) {
    // Do not expose settings, attachments, calendar exports, credentials or arbitrary unknown fields.
    return { ...taskSummary(task), ...projectTask(task), timeEstimate: task.timeEstimate };
}
function publicOperation(op: McpOperation, origin: string) {
    return { id: op.id, status: op.status, createdAt: op.createdAt, expiresAt: nowIso(op.expiresAt),
        changes: op.changes, summary: op.prepared.summary, warnings: op.prepared.warnings, receipt: op.receipt ? { changedTaskIds: op.receipt.changedTaskIds,
            createdTaskId: op.receipt.createdTaskId, revision: op.receipt.revision } : undefined,
        confirmationUrl: op.status === 'pending' ? `${origin}/api/mcp/proposals/${op.id}` : undefined,
        instruction: op.status === 'pending'
            ? 'Ask the user to open the confirmation URL and review the exact changes. Do not approve on their behalf. Nothing has been changed yet.'
            : op.status === 'uncertain' ? 'Write outcome is uncertain. Do not retry with a new key. Check the task and operation status first.' : undefined };
}

/** Called inside a single per-user Durable Object queue, including reads and approvals. */
export function createMcpService(deps: McpServiceDependencies) {
    const now = deps.now ?? Date.now;
    async function requireActor(actor: McpActor, scope: string) {
        if (!actor.scopes.includes(scope)) throw new McpServiceError('insufficient_scope', `Requires ${scope}.`, 403);
        if (!await deps.grantActive(actor)) throw new McpServiceError('revoked', 'Reconnect the AI client; this authorization is no longer active.', 403);
    }
    async function getOperation(id: string): Promise<McpOperation> {
        const op = await deps.store.get(id);
        if (!op) throw new McpServiceError('not_found', 'This operation does not exist or has expired.', 404);
        return op;
    }
    async function reconcile(op: McpOperation): Promise<McpOperation> {
        if (!['writing', 'uncertain'].includes(op.status) || !op.receipt) return op;
        const snapshot = await deps.read();
        op.status = await effectHash(snapshot.data.tasks, op.receipt.changedTaskIds) === op.receipt.effectHash ? 'applied' : 'uncertain';
        if (op.status === 'applied') op.receipt.revision = snapshot.revision;
        await deps.store.put(op);
        return op;
    }
    async function execute(op: McpOperation): Promise<McpOperation> {
        if (op.status !== 'pending') return reconcile(op);
        if (now() >= op.expiresAt) throw new McpServiceError('expired', 'This preview expired. Ask the AI for a new preview.', 410);
        await requireActor(op.actor, op.prepared.command.type === 'create_draft' ? 'tasks:create' : 'tasks:propose');
        const snapshot = await deps.read();
        let outcome: Awaited<ReturnType<typeof applyMcpCommand>>;
        try {
            outcome = await applyMcpCommand(snapshot.data, op.prepared, { now: new Date(op.createdAt), deviceId: 'attention-planner-mcp' });
        } catch {
            op.status = 'conflict'; await deps.store.put(op);
            throw new McpServiceError('conflict', 'The data no longer matches this preview. Nothing was written; generate a new preview.', 409);
        }
        op.receipt = { changedTaskIds: outcome.changedTaskIds, createdTaskId: outcome.createdTaskId,
            effectHash: await effectHash(outcome.data.tasks, outcome.changedTaskIds) };
        op.status = 'writing';
        // Persist the intent BEFORE any network write. A restart must not execute it a second time.
        await deps.store.put(op);
        try {
            op.receipt.revision = await deps.write(snapshot, outcome.data);
            op.status = 'applied';
        } catch (error) {
            const status = (error as { status?: number }).status;
            op.status = status === 409 || status === 412 ? 'conflict' : 'uncertain';
        }
        await deps.store.put(op);
        return op;
    }
    return {
        async call(actor: McpActor, name: string, input: unknown) {
            if (name === 'get_operation') {
                // Writing clients can inspect only their own operations without broad read permission.
                if (!await deps.grantActive(actor)) throw new McpServiceError('revoked', 'Authorization revoked.', 403);
                const { id } = operationGetSchema.parse(input), op = await getOperation(id);
                if (op.actor.grantId !== actor.grantId || op.actor.email !== actor.email) throw new McpServiceError('not_found', 'Operation not found.', 404);
                await requireActor(actor, op.prepared.command.type === 'create_draft' ? 'tasks:create' : 'tasks:propose');
                if (op.prepared.command.type !== 'create_draft') await requireActor(actor, 'tasks:read');
                return publicOperation(await reconcile(op), deps.origin);
            }
            if (name === 'list_tasks' || name === 'get_task') {
                await requireActor(actor, 'tasks:read');
                const args = name === 'list_tasks' ? taskListSchema.parse(input) : taskGetSchema.parse(input);
                const snapshot = await deps.read();
                const metadata = { source: 'Google Drive, last uploaded PWA state; unsynced device changes are not visible.',
                    revision: snapshot.revision, fetchedAt: nowIso(now()), modifiedTime: snapshot.modifiedTime };
                if ('id' in args) {
                    const task = snapshot.data.tasks.find(t => t.id === args.id && !t.deletedAt);
                    if (!task) throw new McpServiceError('not_found', 'Task not found.', 404);
                    return { ...metadata, task: taskDetails(task) };
                }
                const query = args.query?.toLocaleLowerCase();
                const found = snapshot.data.tasks.filter(t => !t.deletedAt && (!args.status || t.status === args.status)
                    && (!args.parentTaskId || t.parentTaskId === args.parentTaskId)
                    && (!query || t.title.toLocaleLowerCase().includes(query)));
                return { ...metadata, tasks: found.slice(args.offset, args.offset + args.limit).map(taskSummary),
                    total: found.length, nextOffset: args.offset + args.limit < found.length ? args.offset + args.limit : null };
            }
            if (name !== 'create_draft' && name !== 'propose_change') throw new McpServiceError('unknown_tool', 'Unknown tool.');
            await requireActor(actor, name === 'create_draft' ? 'tasks:create' : 'tasks:propose');
            if (name === 'propose_change') await requireActor(actor, 'tasks:read');
            const { idempotencyKey, command: inputCommand } = commandEnvelopeSchema.parse(input);
            const command = parseMcpCommand(inputCommand);
            if ((command.type === 'create_draft') !== (name === 'create_draft')) throw new McpServiceError('invalid_command', 'Use the matching tool for this command.');
            const id = await mcpHash([actor.email, actor.grantId, idempotencyKey]);
            const requestHash = await mcpHash(command);
            const existing = await deps.store.get(id);
            if (existing) {
                if (existing.requestHash !== requestHash) throw new McpServiceError('key_reused', 'This idempotency key already belongs to a different operation.', 409);
                return publicOperation(await reconcile(existing), deps.origin);
            }
            const snapshot = await deps.read();
            const createdAt = nowIso(now());
            const prepared = await prepareMcpCommand(snapshot.data, command, { operationId: id, now: new Date(createdAt), deviceId: 'attention-planner-mcp' });
            const simulated = await applyMcpCommand(snapshot.data, prepared, { now: new Date(createdAt), deviceId: 'attention-planner-mcp' });
            const op: McpOperation = { id, actor, requestHash, prepared, createdAt,
                expiresAt: now() + 24 * 60 * 60 * 1000, status: 'pending',
                changes: changesBetween(snapshot.data.tasks, simulated.data.tasks, simulated.changedTaskIds) };
            await deps.store.put(op);
            return publicOperation(name === 'create_draft' ? await execute(op) : op, deps.origin);
        },
        async review(email: string, id: string) {
            const op = await getOperation(id);
            if (op.actor.email !== email) throw new McpServiceError('not_found', 'Operation not found.', 404);
            if (!await deps.grantActive(op.actor)) throw new McpServiceError('revoked', 'The AI connection was revoked. This operation cannot be approved.', 403);
            return op;
        },
        async decide(email: string, id: string, decision: 'approve' | 'reject') {
            const op = await this.review(email, id);
            if (op.status !== 'pending') return publicOperation(await reconcile(op), deps.origin);
            if (decision === 'reject') { op.status = 'rejected'; await deps.store.put(op); return publicOperation(op, deps.origin); }
            return publicOperation(await execute(op), deps.origin);
        },
    };
}
