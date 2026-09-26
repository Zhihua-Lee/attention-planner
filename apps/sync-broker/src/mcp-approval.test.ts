import { describe, expect, it, vi } from 'vitest';
vi.mock('./mcp-auth', () => ({ createMcpAuthHandler: (handlers: { handleDefault: unknown }) => ({ fetch: handlers.handleDefault }), isMcpGrantActive: () => true }));
import { __brokerTestUtils } from './index';

const secret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const origin = 'https://todo.example';
const id = 'a'.repeat(64);
type Env = Parameters<typeof __brokerTestUtils.handleMcpProposal>[1];
function fixture() {
    const fetch = vi.fn(async (_request: Request) => Response.json({ status: 'applied' }));
    const env = { PUBLIC_ORIGIN: origin, ALLOWED_EMAIL: 'owner@example.com', TOKEN_ENCRYPTION_KEY: secret, MCP_ENABLED: 'true',
        MCP_WORKSPACES: { idFromName: (name: string) => name, get: () => ({ fetch }) } } as unknown as Env;
    return { env, fetch };
}
async function submit(headers: Record<string, string>, body = 'decision=approve&csrf=' + 'a'.repeat(43)) {
    const { env, fetch } = fixture();
    const response = await __brokerTestUtils.handleMcpProposal(new Request(`${origin}/api/mcp/proposals/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body,
    }), env);
    return { response, fetch };
}
describe('server-enforced human confirmation gate', () => {
    it('does not accept an AI bearer token as browser approval', async () => {
        const { response, fetch } = await submit({ Authorization: 'Bearer ai-token', Origin: origin });
        expect(response.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
    });
    it('rejects cross-origin submissions even with a valid owner cookie and CSRF', async () => {
        const session = await __brokerTestUtils.createSessionToken('owner@example.com', secret);
        const { response, fetch } = await submit({ Origin: 'https://evil.example', Cookie: `attention_planner_session=${session}; __Host-attention_mcp_review=${'a'.repeat(43)}` });
        expect(response.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
    });
    it('rejects missing CSRF and another Google account', async () => {
        const session = await __brokerTestUtils.createSessionToken('owner@example.com', secret);
        const first = await submit({ Origin: origin, Cookie: `attention_planner_session=${session}` });
        expect(first.response.status).toBe(403); expect(first.fetch).not.toHaveBeenCalled();
        const other = await __brokerTestUtils.createSessionToken('other@example.com', secret);
        const second = await submit({ Origin: origin, Cookie: `attention_planner_session=${other}; __Host-attention_mcp_review=${'a'.repeat(43)}` });
        expect(second.response.status).toBe(403); expect(second.fetch).not.toHaveBeenCalled();
    });
    it('forwards an explicit owner decision only after browser authentication and CSRF checks', async () => {
        const session = await __brokerTestUtils.createSessionToken('owner@example.com', secret);
        const { response, fetch } = await submit({ Origin: origin, Cookie: `attention_planner_session=${session}; __Host-attention_mcp_review=${'a'.repeat(43)}` });
        expect(response.status).toBe(200); expect(fetch).toHaveBeenCalledOnce();
        expect(await fetch.mock.calls[0][0].json()).toEqual({ kind: 'decide', email: 'owner@example.com', id, decision: 'approve' });
    });
});
