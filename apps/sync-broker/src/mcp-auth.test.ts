import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    serverOptions: undefined as Record<string, unknown> | undefined,
    resourceOptions: undefined as Record<string, unknown> | undefined,
    resourceContext: undefined as unknown,
    parseAuthRequest: vi.fn(),
    lookupClient: vi.fn(),
    beginConsent: vi.fn(),
    approveConsent: vi.fn(),
    denyConsent: vi.fn(),
    beginUpstream: vi.fn(),
    finishUpstream: vi.fn(),
    completeAuthorization: vi.fn(),
    listUserGrants: vi.fn(),
    revokeGrant: vi.fn(),
    validateToken: vi.fn(),
    protocolFetch: vi.fn(),
}));

// App-boundary tests mock the maintained provider, not its token/PKCE implementation.
// Protocol-level smoke tests must also run in workerd before enabling the live feature.
vi.mock('@cloudflare/workers-oauth-provider', () => {
    class AuthorizationError extends Error {
        constructor(code: string, options: { description: string }) {
            super(`${code}: ${options.description}`);
        }
    }
    return {
        AuthorizationError,
        CimdFetchError: class extends Error {},
        OAuthAuthorizationServer: class {
            constructor(options: Record<string, unknown>) { mocks.serverOptions = options; }
            getOAuthApi() { return mocks; }
            validateToken(...args: unknown[]) { return mocks.validateToken(...args); }
            fetch(...args: unknown[]) { return mocks.protocolFetch(...args); }
        },
        OAuthResourceServer: class {
            private options: { handler: { fetch: (...args: unknown[]) => Promise<Response> } };
            constructor(options: { handler: { fetch: (...args: unknown[]) => Promise<Response> } }) {
                mocks.resourceOptions = options;
                this.options = options;
            }
            fetch(request: Request, env: unknown) { return this.options.handler.fetch(request, env, mocks.resourceContext); }
        },
        insufficientScope: () => new Response('Insufficient scope', { status: 403 }),
    };
});

import { createMcpAuthHandler, isMcpGrantActive, type McpAuthContext, type McpAuthEnv } from './mcp-auth';

const origin = 'https://todo.example';
const authorizePath = '/api/mcp/oauth/authorize';
const env: McpAuthEnv = {
    PUBLIC_ORIGIN: origin,
    ALLOWED_EMAIL: 'owner@example.com',
    MCP_ENABLED: 'true',
    OAUTH_KV: {} as KVNamespace,
};
const context = {} as ExecutionContext;
const authRequest = () => ({
    responseType: 'code',
    clientId: 'client-1',
    redirectUri: 'https://client.example/callback',
    scope: ['tasks:read', 'tasks:create', 'tasks:propose'],
    state: 'client-state',
    codeChallenge: 'a'.repeat(43),
    codeChallengeMethod: 'S256',
    resource: `${origin}/api/mcp`,
    issuer: origin,
});

function harness(email: string | null = env.ALLOWED_EMAIL) {
    const authenticatedEmail = vi.fn().mockResolvedValue(email);
    const handleMcp = vi.fn().mockResolvedValue(new Response('mcp'));
    const handleDefault = vi.fn().mockResolvedValue(new Response('existing broker'));
    return { ...createMcpAuthHandler({ authenticatedEmail, handleMcp, handleDefault }), authenticatedEmail, handleMcp, handleDefault };
}

function formRequest(path: string, data: Record<string, string> = {}, options: { scopes?: string[]; cookie?: string; origin?: string } = {}) {
    const body = new URLSearchParams(data);
    options.scopes?.forEach((scope) => body.append('scope', scope));
    return new Request(`${origin}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: options.origin ?? origin,
            ...(options.cookie ? { Cookie: options.cookie } : {}),
        },
        body,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverOptions = undefined;
    mocks.resourceOptions = undefined;
    mocks.parseAuthRequest.mockResolvedValue(authRequest());
    mocks.lookupClient.mockResolvedValue({ clientName: 'Chat client', clientId: 'client-1' });
    mocks.beginConsent.mockResolvedValue({ handle: 'browser-bound-handle', headers: new Headers({ 'Set-Cookie': 'consent=bound' }) });
    mocks.approveConsent.mockImplementation((_request, _handle, options: { scope: string[] }) => Promise.resolve({ request: { ...authRequest(), scope: options.scope }, headers: new Headers({ 'Set-Cookie': 'consent=; Max-Age=0' }) }));
    mocks.denyConsent.mockResolvedValue({ redirectTo: 'https://client.example/callback?error=access_denied', headers: new Headers() });
    mocks.beginUpstream.mockResolvedValue({ state: 'opaque-upstream', headers: new Headers({ 'Set-Cookie': 'upstream=bound' }) });
    mocks.finishUpstream.mockResolvedValue({ request: authRequest(), headers: new Headers() });
    mocks.completeAuthorization.mockResolvedValue({ redirectTo: 'https://client.example/callback?code=issued-code' });
    mocks.listUserGrants.mockResolvedValue({ items: [] });
    mocks.protocolFetch.mockResolvedValue(new Response('oauth protocol'));
    mocks.resourceContext = {
        props: { email: env.ALLOWED_EMAIL, grantId: 'grant-1' },
        auth: { userId: env.ALLOWED_EMAIL, clientId: 'client-1', scope: ['tasks:read'], audience: `${origin}/api/mcp` },
    };
});

describe('remote MCP authentication boundary', () => {
    it('keeps existing broker routes unchanged and MCP disabled without both opt-in and storage', async () => {
        const handler = harness();
        expect(await (await handler.fetch(new Request(`${origin}/api/google/status`), env, context)).text()).toBe('existing broker');
        for (const disabled of [{ ...env, MCP_ENABLED: undefined }, { ...env, OAUTH_KV: undefined }]) {
            expect((await handler.fetch(new Request(`${origin}/api/mcp`), disabled, context)).status).toBe(404);
        }
        expect(mocks.serverOptions).toBeUndefined();
        expect(handler.handleMcp).not.toHaveBeenCalled();
    });

    it('delegates proposal pages to browser session authentication, not MCP bearer authentication', async () => {
        const handler = harness();
        expect(await (await handler.fetch(new Request(`${origin}/api/mcp/proposals/proposal-1`), env, context)).text()).toBe('existing broker');
        expect(handler.handleMcp).not.toHaveBeenCalled();
        expect(mocks.serverOptions).toBeUndefined();
    });

    it('pins one resource and does not let caller-controlled origins become an issuer', async () => {
        const handler = harness();
        expect((await handler.fetch(new Request('https://attacker.example/api/mcp'), env, context)).status).toBe(400);
        await handler.fetch(new Request(`${origin}/api/mcp/oauth/token`, { method: 'POST' }), env, context);
        expect(mocks.serverOptions).toMatchObject({
            issuer: origin,
            resources: [`${origin}/api/mcp`],
            accessTokenTTL: 900,
            allowTokenExchangeGrant: false,
            scopesSupported: ['tasks:read', 'tasks:create', 'tasks:propose'],
        });
        expect(mocks.protocolFetch).toHaveBeenCalledOnce();
    });

    it('stores grant identity from the provider, not from any client input', async () => {
        await harness().fetch(new Request(`${origin}/api/mcp/oauth/token`, { method: 'POST' }), env, context);
        const callback = mocks.serverOptions!.tokenExchangeCallback as (input: unknown) => unknown;
        expect(callback({ props: { email: env.ALLOWED_EMAIL, grantId: 'fake' }, grantId: 'verified' })).toEqual({ newProps: { email: env.ALLOWED_EMAIL, grantId: 'verified' } });
    });

    it('shows explicit escaped consent and obtains a browser-bound one-time handle', async () => {
        mocks.lookupClient.mockResolvedValue({ clientName: '<script>alert("x")</script>' });
        const response = await harness().fetch(new Request(`${origin}${authorizePath}`), env, context);
        const body = await response.text();
        expect(body).not.toContain('<script>');
        expect(body).toContain('&#60;script&#62;');
        expect(body).toContain('client.example');
        expect(body).toContain('browser-bound-handle');
        expect(body).toContain('Cloudflare');
        expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
        expect(response.headers.get('Set-Cookie')).toBe('consent=bound');
        expect(mocks.completeAuthorization).not.toHaveBeenCalled();
    });

    it.each([
        { codeChallengeMethod: 'plain' },
        { codeChallenge: undefined },
        { codeChallenge: 'short' },
        { scope: ['drive:all'] },
    ])('rejects unsafe authorization input before storing consent: %j', async (override) => {
        mocks.parseAuthRequest.mockResolvedValue({ ...authRequest(), ...override });
        expect((await harness().fetch(new Request(`${origin}${authorizePath}`), env, context)).status).toBe(400);
        expect(mocks.beginConsent).not.toHaveBeenCalled();
        expect(mocks.completeAuthorization).not.toHaveBeenCalled();
    });

    it('does not accept forged cross-origin consent or silently allow a missing decision', async () => {
        const handler = harness();
        const evil = formRequest(authorizePath, { decision: 'approve', handle: 'h' }, { origin: 'https://evil.example', scopes: ['tasks:read'] });
        expect((await handler.fetch(evil, env, context)).status).toBe(403);
        expect((await handler.fetch(formRequest(authorizePath), env, context)).status).toBe(400);
        expect(mocks.approveConsent).not.toHaveBeenCalled();
    });

    it('bounds form bytes before buffering an oversized request', async () => {
        const request = formRequest(authorizePath, { decision: 'approve', handle: 'h', extra: 'x'.repeat(9_000) }, { scopes: ['tasks:read'] });
        expect((await harness().fetch(request, env, context)).status).toBe(400);
        expect(mocks.approveConsent).not.toHaveBeenCalled();
    });

    it('honors denial without creating a grant', async () => {
        const response = await harness().fetch(formRequest(authorizePath, { decision: 'deny', handle: 'h' }), env, context);
        expect(response.headers.get('Location')).toContain('error=access_denied');
        expect(mocks.denyConsent).toHaveBeenCalled();
        expect(mocks.completeAuthorization).not.toHaveBeenCalled();
    });

    it('creates a grant only after verified session identity and explicit consent', async () => {
        const response = await harness().fetch(formRequest(authorizePath, { decision: 'approve', handle: 'h' }, { scopes: ['tasks:read'] }), env, context);
        expect(response.status).toBe(303);
        expect(mocks.approveConsent).toHaveBeenCalledWith(expect.any(Request), 'h', { scope: ['tasks:read'] });
        expect(mocks.completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({ userId: env.ALLOWED_EMAIL, props: { email: env.ALLOWED_EMAIL }, scope: ['tasks:read'] }));
    });

    it('saves consent in the provider and returns only opaque state through Google sign-in', async () => {
        const response = await harness(null).fetch(formRequest(authorizePath, { decision: 'approve', handle: 'h' }, { scopes: ['tasks:read'] }), env, context);
        const location = response.headers.get('Location')!;
        expect(location).toContain('/api/google/connect?return=');
        expect(location).toContain('opaque-upstream');
        expect(location).not.toContain('client.example');
        expect(response.headers.get('Set-Cookie')).toBe('upstream=bound');
        expect(mocks.completeAuthorization).not.toHaveBeenCalled();
    });

    it('requires an allowed session at the upstream callback before consuming it', async () => {
        const callback = new Request(`${origin}/api/mcp/oauth/resume?state=opaque-upstream`);
        expect((await harness('other@example.com').fetch(callback, env, context)).status).toBe(403);
        expect(mocks.finishUpstream).not.toHaveBeenCalled();
        const response = await harness().fetch(callback, env, context);
        expect(response.headers.get('Location')).toContain('code=issued-code');
        expect(mocks.finishUpstream).toHaveBeenCalledWith(callback);
    });

    it('passes only validated account, client, grant and scopes to MCP without Google credentials', async () => {
        const handler = harness();
        await handler.fetch(new Request(`${origin}/api/mcp`, { method: 'POST' }), env, context);
        expect(handler.handleMcp).toHaveBeenCalledWith(expect.any(Request), env, expect.anything(), {
            email: env.ALLOWED_EMAIL, clientId: 'client-1', grantId: 'grant-1', scopes: ['tasks:read'],
        });
        // The cookie-based owner session is deliberately irrelevant on the MCP resource route.
        expect(handler.authenticatedEmail).not.toHaveBeenCalled();
    });

    it('rejects missing scope or a no-longer-allowed account after token validation', async () => {
        const handler = harness();
        mocks.resourceContext = { props: { email: env.ALLOWED_EMAIL, grantId: 'g' }, auth: { userId: env.ALLOWED_EMAIL, clientId: 'c', scope: [] } };
        expect((await handler.fetch(new Request(`${origin}/api/mcp`), env, context)).status).toBe(403);
        mocks.resourceContext = { props: { email: 'other@example.com', grantId: 'g' }, auth: { userId: 'other@example.com', clientId: 'c', scope: ['tasks:read'] } };
        expect((await handler.fetch(new Request(`${origin}/api/mcp`), env, context)).status).toBe(403);
        expect(handler.handleMcp).not.toHaveBeenCalled();
    });
});

describe('independent client revocation', () => {
    const grant = {
        id: 'grant-1', userId: env.ALLOWED_EMAIL, clientId: 'client-1', scope: ['tasks:read', 'tasks:propose'],
        metadata: { clientName: '<evil>' }, createdAt: 1, resource: `${origin}/api/mcp`,
    };
    const auth: McpAuthContext = { email: env.ALLOWED_EMAIL, clientId: 'client-1', grantId: 'grant-1', scopes: ['tasks:read', 'tasks:propose'] };

    it('lists only the authenticated owner and requires same-origin CSRF-protected revocation', async () => {
        mocks.listUserGrants.mockResolvedValue({ items: [grant] });
        const handler = harness();
        const page = await handler.fetch(new Request(`${origin}/api/mcp/connections`), env, context);
        expect(await page.text()).toContain('&#60;evil&#62;');
        expect(mocks.listUserGrants).toHaveBeenCalledWith(env.ALLOWED_EMAIL, { limit: 50, cursor: undefined });
        const csrfCookie = page.headers.get('Set-Cookie')!.split(';')[0];
        const csrf = csrfCookie.split('=')[1];
        expect((await handler.fetch(formRequest('/api/mcp/connections', { action: 'revoke', grantId: 'grant-1', csrf }), env, context)).status).toBe(403);
        const request = formRequest('/api/mcp/connections', { action: 'revoke', grantId: 'grant-1', csrf }, { cookie: csrfCookie });
        expect((await handler.fetch(request, env, context)).status).toBe(303);
        expect(mocks.revokeGrant).toHaveBeenCalledExactlyOnceWith('grant-1', env.ALLOWED_EMAIL);
    });

    it('rechecks the proposal grant and fails closed on missing, expired or changed ownership', async () => {
        expect(await isMcpGrantActive(env, auth)).toBe(false);
        mocks.listUserGrants.mockResolvedValue({ items: [grant] });
        expect(await isMcpGrantActive(env, auth)).toBe(true);
        for (const override of [{ clientId: 'other' }, { userId: 'other' }, { resource: 'https://other.example/mcp' }, { expiresAt: 1 }, { scope: ['tasks:read'] }]) {
            mocks.listUserGrants.mockResolvedValue({ items: [{ ...grant, ...override }] });
            expect(await isMcpGrantActive(env, auth)).toBe(false);
        }
    });

    it('handles paginated grants without trusting an old token', async () => {
        mocks.listUserGrants.mockResolvedValueOnce({ items: [], cursor: 'next' }).mockResolvedValueOnce({ items: [grant] });
        expect(await isMcpGrantActive(env, auth)).toBe(true);
        expect(mocks.listUserGrants).toHaveBeenLastCalledWith(env.ALLOWED_EMAIL, { limit: 100, cursor: 'next' });
    });
});
