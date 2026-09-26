import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, Response as MiniflareResponse, convertV4MiniflareOptions, type V4FetchHandler } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { builtinModules } from 'node:module';
import type { AppData } from '../../../packages/core/src/types';

// Production entry, classes, OAuth provider, MCP SDK and business logic, all in
// local workerd. Only Google's HTTP service is replaced with an in-memory fixture.
const origin = 'https://todo.production-wiring.example';
const owner = 'owner@production-wiring.example';
const secret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const refreshToken = 'fixture-google-refresh-never-real';
const accessToken = 'fixture-google-access-never-real';
const fileId = 'fixture-file';
const title = 'Fixture private task';
const description = 'Private fixture body that must be encrypted at rest';
const fileName = 'attention-planner-v2.json';
const date = '2020-01-01T12:00:00.000Z';
let worker: Miniflare;
let browserSession: string;
let verifier: string;
let challenge: string;
let snapshot: AppData;
let revision = 10;
let writes = 0;
const externalRequests: string[] = [];

function initialData(): AppData {
    return {
        tasks: [{ id: 'task-one', title, description, status: 'next', tags: [], contexts: [], createdAt: date, updatedAt: date, rev: 1, revBy: 'fixture', planner: { version: 1, days: [], blocks: [] } }],
        projects: [], areas: [], sections: [], settings: {},
    };
}

async function encrypt(value: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', Buffer.from(secret, 'base64url'), 'AES-GCM', false, ['encrypt']);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
    return `${Buffer.from(iv).toString('base64url')}.${Buffer.from(cipher).toString('base64url')}`;
}

const googleFixture: V4FetchHandler = async (request) => {
    const url = new URL(request.url);
    externalRequests.push(`${request.method} ${url.origin}${url.pathname}`);
    if (url.href === 'https://oauth2.googleapis.com/token' && request.method === 'POST') {
        const form = new URLSearchParams(await request.text());
        if (form.get('grant_type') !== 'refresh_token' || form.get('refresh_token') !== refreshToken) return MiniflareResponse.json({ error: 'invalid_grant' }, { status: 400 });
        return MiniflareResponse.json({ access_token: accessToken, expires_in: 3600, token_type: 'Bearer' });
    }
    if (url.origin !== 'https://www.googleapis.com' || request.headers.get('Authorization') !== `Bearer ${accessToken}`) return new MiniflareResponse('Unexpected external request blocked', { status: 503 });
    if (url.pathname === '/drive/v2/files') {
        expect(url.searchParams.get('spaces')).toBe('appDataFolder');
        expect(url.searchParams.get('q')).toBe(`title = '${fileName}' and trashed = false`);
        return MiniflareResponse.json({ items: [{ id: fileId, title: fileName }] });
    }
    if (url.pathname === `/drive/v2/files/${fileId}` && request.method === 'GET') {
        if (url.searchParams.get('alt') === 'media') return MiniflareResponse.json(snapshot);
        return MiniflareResponse.json({ id: fileId, title: fileName, version: String(revision), etag: `"revision-${revision}"`, mimeType: 'application/json', fileSize: String(new TextEncoder().encode(JSON.stringify(snapshot)).length), modifiedDate: date, spaces: ['appDataFolder'], labels: { trashed: false } });
    }
    if (url.pathname === `/upload/drive/v2/files/${fileId}` && request.method === 'PUT') {
        if (request.headers.get('If-Match') !== `"revision-${revision}"`) return MiniflareResponse.json({ error: 'conflict' }, { status: 412 });
        snapshot = await request.json() as AppData;
        revision += 1;
        writes += 1;
        return MiniflareResponse.json({ id: fileId, version: String(revision) });
    }
    return new MiniflareResponse('Unexpected external request blocked', { status: 503 });
};

async function dispatch(path: string, init?: Parameters<Miniflare['dispatchFetch']>[1]) {
    return worker.dispatchFetch(`${origin}${path}`, { ...init, redirect: 'manual' });
}

async function connect() {
    const registration = await dispatch('/api/mcp/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Production wiring fixture', redirect_uris: ['https://client.example/callback'], response_types: ['code'], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' }) });
    expect(registration.status).toBe(201);
    const client = await registration.json() as { client_id: string };
    const parameters = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'https://client.example/callback', response_type: 'code', state: 'production-wiring', resource: `${origin}/api/mcp`, code_challenge: challenge, code_challenge_method: 'S256', scope: 'tasks:read tasks:create tasks:propose' });
    const consent = await dispatch(`/api/mcp/oauth/authorize?${parameters}`, { headers: { Cookie: browserSession } });
    expect(consent.status).toBe(200);
    const handle = (await consent.text()).match(/name="handle" value="([^"]+)"/)![1];
    const cookies = consent.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const form = new URLSearchParams({ handle, decision: 'approve' });
    for (const scope of ['tasks:read', 'tasks:create', 'tasks:propose']) form.append('scope', scope);
    const granted = await dispatch('/api/mcp/oauth/authorize', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Cookie: `${browserSession}; ${cookies}` }, body: form.toString() });
    expect(granted.status).toBe(303);
    const code = new URL(granted.headers.get('Location')!).searchParams.get('code')!;
    const exchanged = await dispatch('/api/mcp/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: 'https://client.example/callback', code, code_verifier: verifier, resource: `${origin}/api/mcp` }).toString() });
    expect(exchanged.status).toBe(200);
    const tokens = await exchanged.json() as { access_token: string };
    return { clientId: client.client_id, token: tokens.access_token };
}

async function tool(token: string, name: string, args: unknown) {
    const response = await dispatch('/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    expect(response.status).toBe(200);
    const envelope = await response.json() as { result?: { isError?: boolean; content: Array<{ text: string }> }; error?: unknown };
    expect(envelope.error).toBeUndefined();
    const result = envelope.result!;
    const content = JSON.parse(result.content[0].text);
    expect(result.isError, JSON.stringify({ content, externalRequests })).not.toBe(true);
    return content;
}

async function proposal(token: string, suffix: string, nextDescription = 'Approved fixture body') {
    const op = await tool(token, 'propose_change', { idempotencyKey: `fixture_proposal_${suffix}`, command: { type: 'update_content', taskId: 'task-one', description: nextDescription } });
    expect(op.status).toBe('pending');
    expect(writes).toBe(0);
    expect(snapshot.tasks[0].description).toBe(description);
    return op as { id: string; confirmationUrl: string; status: string };
}

async function review(path: string) {
    const page = await dispatch(path, { headers: { Cookie: browserSession } });
    expect(page.status).toBe(200);
    const text = await page.text();
    const csrf = text.match(/name="csrf" value="([^"]+)"/)![1];
    const cookies = page.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    return { csrf, cookies, text };
}

async function approve(path: string, csrf: string, cookies: string) {
    return dispatch(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Cookie: `${browserSession}; ${cookies}` }, body: new URLSearchParams({ csrf, decision: 'approve' }).toString() });
}

beforeAll(async () => {
    verifier = 'p'.repeat(64);
    challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
    browserSession = `attention_planner_session=${await encrypt(JSON.stringify({ email: owner, exp: Date.now() + 3_600_000, v: 1 }))}`;
    const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
    const bundled = await build({
        entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))], bundle: true, write: false,
        format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'], target: 'es2022',
        external: ['cloudflare:workers', 'node:*'],
        banner: { js: 'import { createRequire } from "node:module"; const require = createRequire("/bundle.js");' },
        plugins: [{ name: 'node-builtins', setup(builder) { builder.onResolve({ filter: /.*/ }, (args) => builtins.has(args.path) ? { path: `node:${args.path}`, external: true } : undefined); } }],
    });
    worker = new Miniflare({ ...convertV4MiniflareOptions({
        name: 'mcp-production-test', modules: true, script: bundled.outputFiles[0].text,
        compatibilityDate: '2026-08-23', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
        kvNamespaces: ['OAUTH_KV'], durableObjects: {
            USER_VAULTS: { className: 'UserVault', useSQLite: true },
            NOTIFICATION_DEVICES: { className: 'NotificationDevice', useSQLite: true },
            MCP_WORKSPACES: { className: 'McpWorkspace', useSQLite: true },
        },
        bindings: { PUBLIC_ORIGIN: origin, ALLOWED_EMAIL: owner, MCP_ENABLED: 'true', TOKEN_ENCRYPTION_KEY: secret,
            GOOGLE_CLIENT_ID: 'fixture-google-client', GOOGLE_CLIENT_SECRET: 'fixture-google-secret', GOOGLE_REDIRECT_URI: `${origin}/api/google/callback` },
        outboundService: googleFixture, cf: false,
    }), telemetry: { enabled: false } });
    await worker.ready;
    const vault = await worker.getDurableObjectNamespace('USER_VAULTS');
    const seeded = await vault.get(vault.idFromName(owner)).fetch('https://vault.internal/token', { method: 'PUT', body: await encrypt(refreshToken) });
    expect(seeded.status).toBe(200);
}, 30_000);

beforeEach(() => { snapshot = initialData(); revision = 10; writes = 0; externalRequests.length = 0; });
afterAll(async () => { await worker?.dispose(); });

describe('production MCP Worker wiring with local Google fixture', () => {
    it('reads through the actual user vault, durable object and Drive adapter', async () => {
        const { token } = await connect();
        const read = await tool(token, 'get_task', { id: 'task-one' });
        expect(read.task).toMatchObject({ id: 'task-one', title, description });
        expect(read.revision).toBe('10');
        expect(externalRequests).toContain('POST https://oauth2.googleapis.com/token');
        expect(externalRequests).toContain(`GET https://www.googleapis.com/drive/v2/files/${fileId}`);
        expect(JSON.stringify(read)).not.toContain(refreshToken);
        expect(JSON.stringify(read)).not.toContain(accessToken);
        expect(writes).toBe(0);
    });

    it('creates one Inbox draft and replays its receipt without a duplicate cloud write', async () => {
        const { token } = await connect();
        const args = { idempotencyKey: 'fixture_create_draft_123', command: { type: 'create_draft', title: 'New fixture draft', description: 'Draft text', checklist: [{ title: 'First step' }] } };
        const first = await tool(token, 'create_draft', args);
        expect(first.status).toBe('applied');
        expect(writes).toBe(1);
        expect(snapshot.tasks).toHaveLength(2);
        expect(snapshot.tasks[1]).toMatchObject({ title: 'New fixture draft', description: 'Draft text', status: 'inbox' });
        expect((await tool(token, 'create_draft', args)).id).toBe(first.id);
        expect(writes).toBe(1);
        expect(snapshot.tasks).toHaveLength(2);
    });

    it('requires a genuine owner review POST and applies the exact proposal once', async () => {
        const { token } = await connect();
        const op = await proposal(token, 'approved_123');
        const path = new URL(op.confirmationUrl).pathname;
        const page = await review(path);
        expect(page.text).toContain(description);
        expect(page.text).toContain('Approved fixture body');
        const bearerOnly = await dispatch(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Authorization: `Bearer ${token}`, Cookie: page.cookies }, body: new URLSearchParams({ csrf: page.csrf, decision: 'approve' }).toString() });
        expect(bearerOnly.status).toBe(403);
        expect(writes).toBe(0);
        const approved = await approve(path, page.csrf, page.cookies);
        expect(approved.status).toBe(200);
        const approvalResult = (await approved.text()).match(/<p role="status">([^<]*)<\/p>/)?.[1];
        expect(snapshot.tasks[0].description, JSON.stringify({ approvalResult, writes, externalRequests })).toBe('Approved fixture body');
        expect(writes).toBe(1);
        expect((await approve(path, page.csrf, page.cookies)).status).toBe(200);
        expect(writes).toBe(1);
        const status = await tool(token, 'get_operation', { id: op.id });
        expect(status.status).toBe('applied');
    });

    it('refuses a still-open confirmation after the originating grant is revoked', async () => {
        const { token, clientId } = await connect();
        const op = await proposal(token, 'revoked_123');
        const path = new URL(op.confirmationUrl).pathname;
        const page = await review(path);
        const management = await dispatch('/api/mcp/connections', { headers: { Cookie: browserSession, Accept: 'application/json' } });
        const listing = await management.json() as { csrf: string; connections: Array<{ clientId: string; id: string }> };
        const selected = listing.connections.find((connection) => connection.clientId === clientId)!;
        const cookies = management.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
        const revoked = await dispatch('/api/mcp/connections', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Cookie: `${browserSession}; ${cookies}` }, body: new URLSearchParams({ action: 'revoke', grantId: selected.id, csrf: listing.csrf }).toString() });
        expect(revoked.status).toBe(303);
        expect((await approve(path, page.csrf, page.cookies)).status).toBe(403);
        expect(writes).toBe(0);
        expect(snapshot.tasks[0].description).toBe(description);
    });

});
