import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

// Real OAuth provider, real MCP SDK and real Workers runtime. Only identity and
// task execution are synthetic; KV is local and all outbound fetches are blocked.
const origin = 'https://todo.integration.example';
const resource = `${origin}/api/mcp`;
const authorizePath = '/api/mcp/oauth/authorize';
const tokenPath = '/api/mcp/oauth/token';
const verifier = 'a'.repeat(64);
const redirectUri = 'https://client.integration.example/callback';
let worker: Miniflare;
let challenge: string;

type Client = { client_id: string };
type Tokens = { access_token: string; refresh_token: string; resource: string; scope: string };

function base64url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url');
}

async function dispatch(path: string, init?: Parameters<Miniflare['dispatchFetch']>[1]) {
    return worker.dispatchFetch(`${origin}${path}`, { ...init, redirect: 'manual' });
}

async function register(name = 'Integration client'): Promise<Client> {
    const response = await dispatch('/api/mcp/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: name, redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
    });
    expect(response.status).toBe(201);
    return await response.json() as Client;
}

async function consent(client: Client, requestedScopes = ['tasks:read']) {
    const params = new URLSearchParams({
        client_id: client.client_id,
        response_type: 'code',
        redirect_uri: redirectUri,
        state: 'round-trip-state',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource,
        scope: requestedScopes.join(' '),
    });
    const response = await dispatch(`${authorizePath}?${params}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    const handle = body.match(/name="handle" value="([^"]+)"/)?.[1];
    expect(handle).toBeTruthy();
    const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    return { handle: handle!, cookies, body, params };
}

async function approve(client: Client, scopes = ['tasks:read']) {
    const page = await consent(client, scopes);
    const form = new URLSearchParams({ handle: page.handle, decision: 'approve' });
    for (const scope of scopes) form.append('scope', scope);
    const response = await dispatch(authorizePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Cookie: `${page.cookies}; fixture-session=owner` },
        body: form.toString(),
    });
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('Location')!);
    expect(location.origin).toBe(new URL(redirectUri).origin);
    expect(location.searchParams.get('state')).toBe('round-trip-state');
    expect(location.searchParams.get('iss')).toBe(origin);
    expect(location.searchParams.get('code')).toBeTruthy();
    return { code: location.searchParams.get('code')!, page, form };
}

async function exchange(client: Client, code: string, overrides: Record<string, string> = {}) {
    return dispatch(tokenPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, code, redirect_uri: redirectUri, code_verifier: verifier, resource, ...overrides }).toString(),
    });
}

async function authorizedClient(scopes = ['tasks:read']) {
    const client = await register();
    const { code } = await approve(client, scopes);
    const response = await exchange(client, code);
    expect(response.status).toBe(200);
    const tokens = await response.json() as Tokens;
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.resource).toBe(resource);
    expect(tokens.scope.split(' ').sort()).toEqual([...scopes].sort());
    return { client, tokens };
}

async function rpc(token: string, method: string, params?: unknown) {
    return dispatch('/api/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) }),
    });
}

beforeAll(async () => {
    challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const bundled = await build({
        entryPoints: [fileURLToPath(new URL('./mcp-oauth.fixture.ts', import.meta.url))],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        conditions: ['workerd', 'worker', 'browser'],
        mainFields: ['module', 'main'],
        external: ['cloudflare:workers', 'node:*'],
        target: 'es2022',
    });
    worker = new Miniflare({ ...convertV4MiniflareOptions({
        modules: true,
        script: bundled.outputFiles[0].text,
        compatibilityDate: '2026-08-23',
        compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
        kvNamespaces: ['OAUTH_KV'],
        bindings: { PUBLIC_ORIGIN: origin, ALLOWED_EMAIL: 'owner@integration.example', MCP_ENABLED: 'true' },
        outboundService: async () => new Response('Outbound network is disabled in this test', { status: 503 }),
        cf: false,
    }), telemetry: { enabled: false } });
    await worker.ready;
}, 30_000);

afterAll(async () => { await worker?.dispose(); });

describe('real Workers OAuth and MCP integration', () => {
    it('publishes the exact resource and authorization discovery, with all supported scopes', async () => {
        const challengeResponse = await dispatch('/api/mcp', { method: 'POST' });
        expect(challengeResponse.status).toBe(401);
        expect(challengeResponse.headers.get('WWW-Authenticate')).toContain(`${origin}/.well-known/oauth-protected-resource/api/mcp`);
        const resourceResponse = await dispatch('/.well-known/oauth-protected-resource/api/mcp');
        expect(resourceResponse.status).toBe(200);
        expect(await resourceResponse.json()).toMatchObject({ resource, authorization_servers: [origin], scopes_supported: ['tasks:read'] });
        const metadata = await dispatch('/.well-known/oauth-authorization-server');
        expect(metadata.status).toBe(200);
        expect(await metadata.json()).toMatchObject({ issuer: origin, authorization_endpoint: `${origin}${authorizePath}`, token_endpoint: `${origin}${tokenPath}`, scopes_supported: expect.arrayContaining(['tasks:read', 'tasks:create', 'tasks:propose']), code_challenge_methods_supported: ['S256'] });
    });

    it('never accepts the PWA browser cookie as an MCP bearer credential', async () => {
        expect((await dispatch('/api/mcp', { method: 'POST', headers: { Cookie: 'fixture-session=owner' } })).status).toBe(401);
    });

    it('fails closed on unavailable CIMD metadata without issuing a grant or redirecting the browser', async () => {
        const parameters = new URLSearchParams({ client_id: 'https://127.0.0.1/client-metadata.json', redirect_uri: 'https://client.example/callback', response_type: 'code', scope: 'tasks:read', resource, code_challenge_method: 'S256', code_challenge: challenge });
        const response = await dispatch(`${authorizePath}?${parameters}`);
        expect(response.status).toBe(400);
        expect(response.headers.get('Location')).toBeNull();
        const grants = await dispatch('/api/mcp/connections', { headers: { Accept: 'application/json', Cookie: 'fixture-session=owner' } });
        expect(await grants.json()).toMatchObject({ connections: [] });
        // Outbound traffic is denied by the fixture. This tests fail-closed behavior,
        // not Cloudflare's production public-network routing implementation.
    });

    it('requires the browser-bound consent cookie and rejects reused consent handles', async () => {
        const client = await register();
        const { code, page, form } = await approve(client);
        expect(code).toBeTruthy();
        const reused = await dispatch(authorizePath, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Cookie: `${page.cookies}; fixture-session=owner` }, body: form.toString() });
        expect(reused.status).toBe(400);
        const fresh = await consent(client);
        const withoutBinding = await dispatch(authorizePath, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Cookie: 'fixture-session=owner' }, body: new URLSearchParams({ handle: fresh.handle, decision: 'approve', scope: 'tasks:read' }).toString() });
        expect(withoutBinding.status).toBe(400);
    });

    it('resumes first-time Google sign-in only with both its browser binding and the owner session', async () => {
        const client = await register();
        const page = await consent(client);
        const response = await dispatch(authorizePath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Cookie: page.cookies },
            body: new URLSearchParams({ handle: page.handle, decision: 'approve', scope: 'tasks:read' }).toString(),
        });
        expect(response.status).toBe(303);
        const googleRedirect = new URL(response.headers.get('Location')!, origin);
        expect(googleRedirect.pathname).toBe('/api/google/connect');
        const returnPath = googleRedirect.searchParams.get('return')!;
        expect(returnPath.length).toBeLessThan(500);
        expect(returnPath).toContain('/api/mcp/oauth/resume?state=');
        // Google itself is not called: the fixture supplies the session resulting from successful sign-in.
        const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
        expect((await dispatch(returnPath, { headers: { Cookie: cookies } })).status).toBe(403);
        expect((await dispatch(returnPath, { headers: { Cookie: 'fixture-session=owner' } })).status).toBe(400);
        const resumed = await dispatch(returnPath, { headers: { Cookie: `${cookies}; fixture-session=owner` } });
        expect(resumed.status).toBe(303);
        const code = new URL(resumed.headers.get('Location')!).searchParams.get('code')!;
        expect((await exchange(client, code)).status).toBe(200);
        expect((await dispatch(returnPath, { headers: { Cookie: `${cookies}; fixture-session=owner` } })).status).toBe(400);
    });

    it('enforces PKCE and the resource audience at code exchange', async () => {
        const client = await register();
        const first = await approve(client);
        expect((await exchange(client, first.code, { code_verifier: 'b'.repeat(64) })).status).toBe(400);
        const second = await approve(client);
        expect((await exchange(client, second.code, { resource: `${origin}/different-resource` })).status).toBe(400);
        const success = await exchange(client, second.code);
        expect(success.status).toBe(200);
    });

    it('supports real SDK initialization and advertises read, create and proposal tools without approval tools', async () => {
        const { tokens } = await authorizedClient(['tasks:read', 'tasks:create', 'tasks:propose']);
        const initialized = await rpc(tokens.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'integration', version: '1' } });
        expect(initialized.status).toBe(200);
        expect(await initialized.json()).toMatchObject({ result: { serverInfo: { name: 'attention-planner' } } });
        const listed = await rpc(tokens.access_token, 'tools/list');
        expect(listed.status).toBe(200);
        const tools = await listed.json() as { result: { tools: Array<{ name: string }> } };
        expect(tools.result.tools.map((tool) => tool.name)).toEqual(['list_tasks', 'get_task', 'create_draft', 'propose_change', 'get_operation']);
        const called = await rpc(tokens.access_token, 'tools/call', { name: 'list_tasks', arguments: {} });
        expect(called.status).toBe(200);
        const result = await called.json() as { result: { content: Array<{ text: string }> } };
        const content = JSON.parse(result.result.content[0].text);
        expect(content).toMatchObject({ fixture: true, tool: 'list_tasks', grantActive: true, actor: { email: 'owner@integration.example', scopes: ['tasks:read', 'tasks:create', 'tasks:propose'] } });
        expect(content.actor.grantId).toBeTruthy();
        expect(content.actor.clientId).toBeTruthy();
    });

    it('blocks creating through a read-only token and keeps insufficient-scope metadata', async () => {
        const { tokens } = await authorizedClient();
        const response = await rpc(tokens.access_token, 'tools/call', { name: 'create_draft', arguments: { idempotencyKey: 'integration_key_12345', command: { type: 'create_draft', title: 'fixture' } } });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ result: { isError: true, _meta: { 'mcp/www_authenticate': expect.arrayContaining([expect.stringContaining('tasks:create')]) } } });
    });

    it('refreshes scoped tokens and revokes only the selected client grant', async () => {
        const first = await authorizedClient();
        const second = await authorizedClient();
        const refreshed = await dispatch(tokenPath, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: first.client.client_id, refresh_token: first.tokens.refresh_token, resource }).toString() });
        expect(refreshed.status).toBe(200);
        const tokens = await refreshed.json() as Tokens;
        expect(tokens.scope).toBe('tasks:read');
        const management = await dispatch('/api/mcp/connections', { headers: { Cookie: 'fixture-session=owner', Accept: 'application/json' } });
        const listing = await management.json() as { csrf: string; connections: Array<{ id: string; clientId: string }> };
        const selected = listing.connections.find((connection) => connection.clientId === first.client.client_id)!;
        expect(selected).toBeTruthy();
        const cookies = management.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
        const revoked = await dispatch('/api/mcp/connections', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Cookie: `${cookies}; fixture-session=owner` }, body: new URLSearchParams({ action: 'revoke', grantId: selected.id, csrf: listing.csrf }).toString() });
        expect(revoked.status).toBe(303);
        expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
        expect((await rpc(second.tokens.access_token, 'tools/list')).status).toBe(200);
    });
});
