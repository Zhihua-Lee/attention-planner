import {
    AuthorizationError,
    CimdFetchError,
    OAuthAuthorizationServer,
    OAuthResourceServer,
    insufficientScope,
    type AuthRequest,
    type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';

export const MCP_SCOPES = ['tasks:read', 'tasks:create', 'tasks:propose'] as const;
export type McpScope = typeof MCP_SCOPES[number];

export interface McpAuthEnv {
    PUBLIC_ORIGIN: string;
    ALLOWED_EMAIL: string;
    MCP_ENABLED?: string;
    OAUTH_KV?: KVNamespace;
}

export interface McpAuthContext {
    email: string;
    clientId: string;
    scopes: McpScope[];
    grantId: string;
}

interface McpAuthDependencies<Env extends McpAuthEnv> {
    authenticatedEmail(request: Request, env: Env): Promise<string | null>;
    handleMcp(request: Request, env: Env, ctx: ExecutionContext, auth: McpAuthContext): Promise<Response>;
    handleDefault(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

const RESOURCE_PATH = '/api/mcp';
const AUTHORIZE_PATH = '/api/mcp/oauth/authorize';
const RESUME_PATH = '/api/mcp/oauth/resume';
const CONNECTIONS_PATH = '/api/mcp/connections';
const MANAGEMENT_COOKIE = '__Host-attention_mcp_management_csrf';
const SCOPE_LABELS: Record<McpScope, string> = {
    'tasks:read': '查询任务并读取正文（仅发送本次工具请求所需的内容）',
    'tasks:create': '在收集箱新建任务和草稿',
    'tasks:propose': '提出修改、完成、删除、日期或排程建议；必须由你确认后才执行',
};

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function privateHeaders(initial?: Headers): Headers {
    const headers = new Headers(initial);
    headers.set('Cache-Control', 'no-store');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    return headers;
}

function html(title: string, body: string, status = 200, initial?: Headers): Response {
    const headers = privateHeaders(initial);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>html{color-scheme:light dark;font:16px/1.6 system-ui,sans-serif}body{max-width:42rem;margin:3rem auto;padding:0 1.25rem}h1{line-height:1.25}fieldset{border:1px solid #888;border-radius:.5rem;margin:1.5rem 0;padding:1rem}label{display:block;margin:.8rem 0}button,a{touch-action:manipulation}button{padding:.7rem 1.1rem;min-height:44px;cursor:pointer;margin:.3rem .5rem .3rem 0}code{overflow-wrap:anywhere}small{display:block}article{border-bottom:1px solid #888;padding:1rem 0}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`, { status, headers });
}

function json(value: unknown, status = 200, initial?: Headers): Response {
    const headers = privateHeaders(initial);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(value), { status, headers });
}

function redirect(location: string, initial?: Headers): Response {
    const headers = privateHeaders(initial);
    headers.set('Location', location);
    return new Response(null, { status: 303, headers });
}

function validScopes(scopes: string[]): scopes is McpScope[] {
    return scopes.length > 0 && scopes.every((scope) => MCP_SCOPES.includes(scope as McpScope));
}

function checkAuthorizationRequest(request: AuthRequest): void {
    // The provider requires PKCE for public clients; our application requires it for every client.
    if (request.codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(request.codeChallenge || '')) {
        throw new AuthorizationError('invalid_request', { description: 'S256 PKCE is required.' });
    }
    if (!validScopes(request.scope) || !request.scope.includes('tasks:read')) {
        throw new AuthorizationError('invalid_scope', { description: 'Choose supported task permissions, including tasks:read.' });
    }
}

async function completeAuthorization(oauth: OAuthHelpers, request: AuthRequest, email: string, headers?: Headers): Promise<Response> {
    checkAuthorizationRequest(request);
    const client = await oauth.lookupClient(request.clientId);
    const { redirectTo } = await oauth.completeAuthorization({
        request,
        userId: email,
        scope: request.scope,
        metadata: { clientName: client?.clientName || request.clientId },
        props: { email },
    });
    return redirect(redirectTo, headers);
}

async function consentPage(oauth: OAuthHelpers, request: AuthRequest): Promise<Response> {
    const client = await oauth.lookupClient(request.clientId);
    if (!client) throw new AuthorizationError('invalid_request', { description: 'Unknown client.' });
    const transaction = await oauth.beginConsent(request);
    const destination = new URL(request.redirectUri);
    const local = destination.hostname === 'localhost' || destination.hostname === '127.0.0.1' || destination.hostname === '[::1]';
    const clientDomain = request.clientId.startsWith('https://') ? new URL(request.clientId).hostname : null;
    const scopes = MCP_SCOPES.map((scope) => `<label><input type="checkbox" name="scope" value="${scope}"${request.scope.includes(scope) ? ' checked' : ''}> ${SCOPE_LABELS[scope]}</label>`).join('');
    return html('连接 Attention Planner', `<p>允许 <strong>${escapeHtml(client.clientName || request.clientId)}</strong> 使用你的任务数据？</p>
        <p>${clientDomain ? `客户端域名：<code>${escapeHtml(clientDomain)}</code>` : '客户端名称由申请方自行填写，名称本身不代表身份已验证。'}</p>
        <p>授权将返回到 <strong>${escapeHtml(destination.hostname)}</strong>。<small><code>${escapeHtml(request.redirectUri)}</code></small></p>
        ${local ? '<p><strong>这是连接到你电脑上的应用。仅当你刚刚主动发起连接时继续。</strong></p>' : ''}
        <p>Cloudflare 服务会处理 Google Drive 中已同步的任务正文；此客户端及其 AI 提供商会收到工具返回的内容。未同步的本地修改不可见。Google 令牌不会交给 AI。</p>
        <form method="post" action="${AUTHORIZE_PATH}"><input type="hidden" name="handle" value="${escapeHtml(transaction.handle)}"><fieldset><legend>本次授权范围</legend>${scopes}</fieldset>
        <p>读取权限支持查询整个任务库。创建权限仅用于新建收集箱草稿；已有内容的修改、完成、删除与排程都需另行确认。</p>
        <button name="decision" value="approve">同意并连接</button><button name="decision" value="deny">取消</button></form>
        <p>你可以随时在<a href="${CONNECTIONS_PATH}">连接管理</a>撤销这个客户端的权限。</p>`, 200, transaction.headers);
}

function cookie(request: Request, name: string): string | null {
    for (const part of (request.headers.get('Cookie') || '').split(';')) {
        const equals = part.indexOf('=');
        if (part.slice(0, equals).trim() === name) return part.slice(equals + 1).trim();
    }
    return null;
}

function newCsrf(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readForm(request: Request): Promise<FormData> {
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
        throw new AuthorizationError('invalid_request', { description: 'Expected an HTML form.' });
    }
    const maximum = 8_192;
    const tooLarge = () => new AuthorizationError('invalid_request', { description: 'Form is too large.' });
    if (Number(request.headers.get('Content-Length') || 0) > maximum) throw tooLarge();
    const reader = request.body?.getReader();
    let body = '';
    if (reader) {
        const decoder = new TextDecoder();
        let size = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > maximum) { await reader.cancel(); throw tooLarge(); }
                body += decoder.decode(value, { stream: true });
            }
            body += decoder.decode();
        } finally { reader.releaseLock(); }
    }
    const form = new FormData();
    new URLSearchParams(body).forEach((value, key) => form.append(key, value));
    return form;
}

async function connectionManagement(oauth: OAuthHelpers, request: Request, email: string): Promise<Response> {
    if (request.method === 'POST') {
        const form = await readForm(request);
        const csrf = String(form.get('csrf') || '');
        const grantId = String(form.get('grantId') || '');
        if (!/^[a-f0-9]{64}$/.test(csrf) || csrf !== cookie(request, MANAGEMENT_COOKIE)) return json({ error: 'Invalid confirmation.' }, 403);
        if (form.get('action') !== 'revoke' || !/^[A-Za-z0-9_-]{1,200}$/.test(grantId)) return json({ error: 'Invalid connection.' }, 400);
        // The library scopes this operation by both the grant ID and the authenticated owner.
        await oauth.revokeGrant(grantId, email);
        return redirect(CONNECTIONS_PATH);
    }
    const url = new URL(request.url);
    const grants = await oauth.listUserGrants(email, { limit: 50, cursor: url.searchParams.get('cursor') || undefined });
    const csrf = newCsrf();
    const headers = new Headers({ 'Set-Cookie': `${MANAGEMENT_COOKIE}=${csrf}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Strict` });
    const connections = grants.items.map((grant) => ({
        id: grant.id,
        clientId: grant.clientId,
        clientName: typeof grant.metadata?.clientName === 'string' ? grant.metadata.clientName : grant.clientId,
        scopes: grant.scope,
        createdAt: grant.createdAt,
    }));
    if (request.headers.get('Accept')?.includes('application/json')) {
        return json({ connections, csrf, cursor: grants.cursor }, 200, headers);
    }
    const items = connections.map((connection) => `<article><h2>${escapeHtml(connection.clientName)}</h2><small><code>${escapeHtml(connection.clientId)}</code></small><p>${connection.scopes.map(escapeHtml).join('、')}</p><form method="post" action="${CONNECTIONS_PATH}"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="grantId" value="${escapeHtml(connection.id)}"><button name="action" value="revoke">撤销此连接</button></form></article>`).join('');
    const next = grants.cursor ? `<p><a href="${CONNECTIONS_PATH}?cursor=${encodeURIComponent(grants.cursor)}">下一页</a></p>` : '';
    return html('AI 连接管理', `<p>撤销只影响所选 AI 客户端，不会删除任务，也不会断开 PWA 的 Google Drive 同步。已发送给 AI 的内容无法通过撤销收回。撤销传播可能短暂延迟。</p>${items || '<p>尚无已授权的客户端。</p>'}${next}<p><a href="/?view=settings">返回 Attention Planner</a></p>`, 200, headers);
}

function isMcpPath(path: string): boolean {
    return path === RESOURCE_PATH || path.startsWith(`${RESOURCE_PATH}/`)
        || path.startsWith('/.well-known/oauth-authorization-server')
        || path.startsWith('/.well-known/oauth-protected-resource');
}

function createAuthorizationServer<Env extends McpAuthEnv>(env: Env): OAuthAuthorizationServer<Env> {
    return new OAuthAuthorizationServer<Env>({
        issuer: env.PUBLIC_ORIGIN,
        resources: [`${env.PUBLIC_ORIGIN}${RESOURCE_PATH}`],
        authorizeEndpoint: AUTHORIZE_PATH,
        tokenEndpoint: '/api/mcp/oauth/token',
        clientRegistrationEndpoint: '/api/mcp/oauth/register',
        scopesSupported: [...MCP_SCOPES],
        clientIdMetadataDocumentEnabled: true,
        accessTokenTTL: 15 * 60,
        refreshTokenTTL: 30 * 24 * 60 * 60,
        allowTokenExchangeGrant: false,
        tokenExchangeCallback: ({ props, grantId }) => ({
            newProps: { email: props.email, grantId },
        }),
    });
}

/** Check again when applying a saved proposal, rather than trusting its old token context. */
export async function isMcpGrantActive(env: McpAuthEnv, auth: McpAuthContext): Promise<boolean> {
    if (env.MCP_ENABLED !== 'true' || !env.OAUTH_KV || auth.email !== env.ALLOWED_EMAIL.trim().toLowerCase()) return false;
    const oauth = createAuthorizationServer(env).getOAuthApi(env);
    let cursor: string | undefined;
    // Personal deployment: the bound prevents an unbounded scan if a hostile client floods grants.
    for (let page = 0; page < 5; page += 1) {
        const grants = await oauth.listUserGrants(auth.email, { limit: 100, cursor });
        const grant = grants.items.find((item) => item.id === auth.grantId);
        if (grant) return grant.userId === auth.email && grant.clientId === auth.clientId
            && grant.resource === `${env.PUBLIC_ORIGIN}${RESOURCE_PATH}`
            && (grant.expiresAt === undefined || grant.expiresAt > Date.now() / 1000)
            && auth.scopes.every((scope) => grant.scope.includes(scope));
        if (!grants.cursor || grants.cursor === cursor) return false;
        cursor = grants.cursor;
    }
    return false;
}

/** OAuth tokens belong only to this MCP resource; browser sessions never authenticate MCP calls. */
export function createMcpAuthHandler<Env extends McpAuthEnv>(dependencies: McpAuthDependencies<Env>) {
    return {
        async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
            const url = new URL(request.url);
            if (!isMcpPath(url.pathname)) return dependencies.handleDefault(request, env, ctx);
            if (env.MCP_ENABLED !== 'true' || !env.OAUTH_KV || !env.ALLOWED_EMAIL.trim()) return json({ error: 'MCP is not enabled.' }, 404);
            if (url.origin !== env.PUBLIC_ORIGIN) return json({ error: 'Unexpected service origin.' }, 400);
            if (url.pathname.startsWith('/api/mcp/proposals/')) return dependencies.handleDefault(request, env, ctx);
            const resource = `${env.PUBLIC_ORIGIN}${RESOURCE_PATH}`;
            const authorizationServer = createAuthorizationServer(env);
            const oauth = authorizationServer.getOAuthApi(env);
            const interactive = [AUTHORIZE_PATH, RESUME_PATH, CONNECTIONS_PATH].includes(url.pathname);
            if (interactive) {
                if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
                if (request.method === 'POST' && request.headers.get('Origin') !== env.PUBLIC_ORIGIN) return json({ error: 'Cross-origin request rejected.' }, 403);
                try {
                    const authenticated = await dependencies.authenticatedEmail(request, env);
                    const email = authenticated?.trim().toLowerCase() === env.ALLOWED_EMAIL.trim().toLowerCase() ? authenticated.trim().toLowerCase() : null;
                    if (url.pathname === AUTHORIZE_PATH) {
                        if (request.method === 'GET') {
                            const authRequest = await oauth.parseAuthRequest(request);
                            // Some clients omit scope; consent still explicitly shows the baseline permission.
                            if (authRequest.scope.length === 0) authRequest.scope = ['tasks:read'];
                            checkAuthorizationRequest(authRequest);
                            return await consentPage(oauth, authRequest);
                        }
                        const form = await readForm(request);
                        const handle = String(form.get('handle') || '');
                        if (form.get('decision') === 'deny') {
                            const denied = await oauth.denyConsent(request, handle);
                            return redirect(denied.redirectTo, denied.headers);
                        }
                        const scopes = form.getAll('scope').map(String);
                        if (form.get('decision') !== 'approve' || !validScopes(scopes) || !scopes.includes('tasks:read')) return json({ error: 'Select task read permission and supported scopes.' }, 400);
                        const approved = await oauth.approveConsent(request, handle, { scope: scopes });
                        checkAuthorizationRequest(approved.request);
                        if (email) return await completeAuthorization(oauth, approved.request, email, approved.headers);
                        const upstream = await oauth.beginUpstream(approved.request, { headers: approved.headers });
                        const returnTo = `${RESUME_PATH}?state=${encodeURIComponent(upstream.state)}`;
                        return redirect(`/api/google/connect?return=${encodeURIComponent(returnTo)}`, upstream.headers);
                    }
                    if (!email) {
                        if (url.pathname === RESUME_PATH) return html('需要登录', '<p>请使用允许的 Google 账号登录，然后从 AI 客户端重新发起连接。</p>', 403);
                        return redirect(`/api/google/connect?return=${encodeURIComponent(CONNECTIONS_PATH)}`);
                    }
                    if (url.pathname === RESUME_PATH) {
                        if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
                        const upstream = await oauth.finishUpstream(request);
                        return await completeAuthorization(oauth, upstream.request, email, upstream.headers);
                    }
                    return await connectionManagement(oauth, request, email);
                } catch (error) {
                    // Deliberately render locally: no redirect is constructed from untrusted request values.
                    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
                        return html('无法完成连接', '<p>连接请求无效、已过期或已使用。请回到 AI 客户端重新发起连接。</p>', 400);
                    }
                    return json({ error: 'Connection service temporarily unavailable.' }, 503);
                }
            }
            if (url.pathname === RESOURCE_PATH || url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
                const resourceServer = new OAuthResourceServer<Env, { email: string; grantId: string }>({
                    resourceMetadata: {
                        resource,
                        authorization_servers: [env.PUBLIC_ORIGIN],
                        scopes_supported: ['tasks:read'],
                        resource_name: 'Attention Planner',
                    },
                    validateToken: (currentEnv) => (audience, token) => authorizationServer.validateToken(audience, token, currentEnv),
                    handler: {
                        async fetch(mcpRequest, currentEnv, resourceContext) {
                            const email = resourceContext.props.email?.trim().toLowerCase();
                            if (!email || email !== currentEnv.ALLOWED_EMAIL.trim().toLowerCase() || resourceContext.auth.userId !== email || !resourceContext.auth.clientId || !resourceContext.props.grantId) return json({ error: 'Account is not allowed.' }, 403);
                            if (!resourceContext.auth.scope.includes('tasks:read')) return insufficientScope(resourceContext.auth, ['tasks:read']);
                            return dependencies.handleMcp(mcpRequest, currentEnv, resourceContext, {
                                email,
                                clientId: resourceContext.auth.clientId,
                                grantId: resourceContext.props.grantId,
                                scopes: resourceContext.auth.scope.filter((scope): scope is McpScope => MCP_SCOPES.includes(scope as McpScope)),
                            });
                        },
                    },
                });
                return resourceServer.fetch(request, env, ctx);
            }
            return authorizationServer.fetch(request, env, ctx);
        },
    };
}
