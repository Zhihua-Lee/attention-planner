import { describe, expect, it, vi } from 'vitest';
import { boundedBody, handleMcpHttp, safeMcpError } from './mcp-http';
import { renderMcpReview } from './mcp-pages';
import type { McpActor, McpOperation } from './mcp-service';

const origin = 'https://todo.example';
type RpcReply = { result: { serverInfo: { name: string }; isError?: boolean;
    tools: { name: string; annotations: { readOnlyHint: boolean }; _meta: Record<string, unknown> }[];
    _meta: Record<string, string[]> } };
const actor: McpActor = { email: 'owner@example.com', clientId: 'client', grantId: 'grant', scopes: ['tasks:read', 'tasks:create', 'tasks:propose'] };
const rpc = (method: string, params?: unknown) => new Request(`${origin}/api/mcp`, { method: 'POST', headers: {
    Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25',
}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });

describe('real SDK stateless MCP boundary', () => {
    it('initializes with no database or session cookie', async () => {
        const execute = vi.fn();
        const response = await handleMcpHttp(rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }), actor, execute, origin);
        expect(response.status).toBe(200);
        const result = await response.json<RpcReply>();
        expect(result.result.serverInfo.name).toBe('attention-planner');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.has('Mcp-Session-Id')).toBe(false);
        expect(execute).not.toHaveBeenCalled();
    });
    it('lists only scoped tools and never an approval or raw-write tool', async () => {
        const response = await handleMcpHttp(rpc('tools/list'), actor, vi.fn(), origin);
        const { result } = await response.json<RpcReply>();
        expect(result.tools.map((t: { name: string }) => t.name)).toEqual(['list_tasks', 'get_task', 'create_draft', 'propose_change', 'get_operation']);
        const propose = result.tools.find((t: { name: string }) => t.name === 'propose_change');
        expect(propose!.annotations.readOnlyHint).toBe(false);
        expect(propose!._meta.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['tasks:propose'] }]);
        expect(JSON.stringify(result)).not.toContain('access_token');
    });
    it('executes a read through the validated actor, not arguments supplied identity', async () => {
        const execute = vi.fn(async () => ({ tasks: [] }));
        const response = await handleMcpHttp(rpc('tools/call', { name: 'list_tasks', arguments: { query: 'comp' } }), actor, execute, origin);
        expect((await response.json<RpcReply>()).result.isError).not.toBe(true);
        expect(execute).toHaveBeenCalledWith(actor, 'list_tasks', { query: 'comp', limit: 20, offset: 0 });
    });
    it('rejects unknown input fields before executing', async () => {
        const execute = vi.fn();
        const response = await handleMcpHttp(rpc('tools/call', { name: 'get_task', arguments: { id: 'x', email: 'another@example.com' } }), actor, execute, origin);
        expect((await response.json<RpcReply>()).result.isError).toBe(true);
        expect(execute).not.toHaveBeenCalled();
    });
    it('enforces write scopes even if an authenticated client forges a tool request', async () => {
        const execute = vi.fn();
        const response = await handleMcpHttp(rpc('tools/call', { name: 'create_draft', arguments: { idempotencyKey: 'request_1234567890', command: { type: 'create_draft', title: 'draft' } } }), { ...actor, scopes: ['tasks:read'] }, execute, origin);
        const { result } = await response.json<RpcReply>();
        expect(result.isError).toBe(true);
        expect(result._meta['mcp/www_authenticate'][0]).toContain('tasks:create');
        expect(execute).not.toHaveBeenCalled();
    });
    it('does not let model-provided confirmation flags authorize edits', async () => {
        const execute = vi.fn();
        const response = await handleMcpHttp(rpc('tools/call', { name: 'propose_change', arguments: { idempotencyKey: 'request_1234567890', command: { type: 'delete_task', taskId: 'x', confirmed: true } } }), actor, execute, origin);
        expect((await response.json<RpcReply>()).result.isError).toBe(true);
        expect(execute).not.toHaveBeenCalled();
    });
    it('suppresses arbitrary error messages containing tokens or task contents', async () => {
        const execute = vi.fn(async () => { throw new Error('private secret token or task title'); });
        const response = await handleMcpHttp(rpc('tools/call', { name: 'get_task', arguments: { id: 'x' } }), actor, execute, origin);
        expect(await response.text()).not.toContain('private secret');
        expect(safeMcpError(new Error('private secret')).message).not.toContain('private secret');
    });
    it('rejects hostile origins and aliases even with a valid actor', async () => {
        const execute = vi.fn();
        const request = rpc('tools/list'); request.headers.set('Origin', 'https://evil.example');
        expect((await handleMcpHttp(request, actor, execute, origin)).status).toBe(403);
        expect((await handleMcpHttp(new Request('https://alias.workers.dev/api/mcp', request), actor, execute, origin)).status).toBe(403);
    });
    it('rejects oversized streaming requests without relying on content-length', async () => {
        await expect(boundedBody(new Request(origin, { method: 'POST', body: 'a'.repeat(50) }), 10)).rejects.toMatchObject({ status: 413 });
    });
});

describe('human confirmation rendering', () => {
    const op = { id: 'a'.repeat(64), actor, status: 'pending', createdAt: new Date().toISOString(), expiresAt: Date.now() + 60_000,
        prepared: { summary: '测试', warnings: ['请核对日历'] }, changes: [{ id: 'task', title: '<script>alert(1)</script>', fields: [{ name: 'description', before: 'old', after: '</pre><img src=x onerror=alert(1)>' }] }] } as McpOperation;
    it('escapes hostile task and AI text and protects the confirmation page', async () => {
        const response = renderMcpReview(op, 'csrfvalue');
        const html = await response.text();
        expect(html).not.toContain('<script>alert'); expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;script&gt;'); expect(html).toContain('value="csrfvalue"');
        expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
        expect(response.headers.get('Cache-Control')).toBe('no-store');
    });
    it('never offers apply again after an operation was applied or expired', async () => {
        expect(await renderMcpReview({ ...op, status: 'applied' }, 'x').text()).not.toContain('value="approve"');
        expect(await renderMcpReview({ ...op, expiresAt: 0 }, 'x').text()).not.toContain('value="approve"');
    });
});
