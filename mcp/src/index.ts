import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import OAuthProvider, {
  AuthorizationError,
  CimdFetchError,
  type OAuthHelpers,
  type OAuthResourceAuth,
} from '@cloudflare/workers-oauth-provider';
import { DriveRemote } from '../../src/store/drive';
import { brokerTokens, sessionConnected, sessionOf, type Broker } from './broker';
import { applyChanges, describeChange } from './changes';
import { connectionsBody, consentBody, message, page, reviewBody } from './pages';
import { isExpired, kvProposals } from './proposals';
import { createServer } from './tools';
import { Workspace } from './workspace';

/**
 * Remote MCP for Attention Planner, at /api/mcp on the app's own origin.
 *
 * - OAuth 2.1 for AI clients (dynamic registration, client metadata documents, PKCE) under /api/ai/.
 * - Reads and writes the same Drive file the app syncs, with Google tokens from the existing sync broker.
 * - New tasks are saved at once; changes to existing tasks wait for the owner's approval at /api/ai/review/<id>.
 */
export interface Env {
  OAUTH_KV: KVNamespace;
  /** The sync broker Worker, reached directly (Workers on one zone cannot fetch each other's routes). */
  BROKER: Broker;
  OAUTH_PROVIDER: OAuthHelpers;
  PUBLIC_ORIGIN: string;
  /** The owner's time zone, e.g. America/Chicago: what "today" and "now" mean. */
  TIME_ZONE: string;
}

/** What a connection carries: the browser session that allowed it, and the client's name. */
type Props = { session: string; client: string };

const OWNER = 'owner';
const SCOPES = ['tasks:read', 'tasks:write'];

function workspaceFor(env: Env, session: string): Workspace {
  const tokens = brokerTokens(env.BROKER, env.PUBLIC_ORIGIN, session);
  return new Workspace(new DriveRemote(tokens), env.TIME_ZONE, { token: tokens, device: 'ai' });
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const mcpApi = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props: Props; auth: OAuthResourceAuth }) {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
    if (Number(request.headers.get('Content-Length') ?? 0) > 256 * 1024) return json({ error: 'Too large.' }, 413);
    const server = createServer({
      workspace: workspaceFor(env, ctx.props.session),
      proposals: kvProposals(env.OAUTH_KV),
      origin: env.PUBLIC_ORIGIN,
      client: ctx.props.client,
      canWrite: ctx.auth.scope.includes('tasks:write'),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

const redirect = (to: string, headers = new Headers()) => {
  headers.set('Location', to);
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers });
};

/** Send the browser to sign in through the broker, then back to `path` (kept server-side: the broker caps its length). */
async function signIn(env: Env, path: string): Promise<Response> {
  const key = crypto.randomUUID();
  await env.OAUTH_KV.put(`ap-resume:${key}`, path, { expirationTtl: 900 });
  return redirect(`/api/google/connect?return=${encodeURIComponent(`/api/ai/resume?key=${key}`)}`);
}

const sameOrigin = (request: Request, env: Env) => request.headers.get('Origin') === env.PUBLIC_ORIGIN;

async function authorize(request: Request, env: Env, url: URL): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const session = sessionOf(request);
  try {
    if (request.method === 'GET') {
      if (!(await sessionConnected(env.BROKER, env.PUBLIC_ORIGIN, session)))
        return signIn(env, `${url.pathname}${url.search}`);
      const auth = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(auth);
      const asked = details.scope.filter((s) => SCOPES.includes(s));
      const scopes = asked.includes('tasks:read') ? asked : ['tasks:read', ...(asked.length ? asked : ['tasks:write'])];
      const consent = await oauth.beginConsent(auth);
      return page('连接 AI', consentBody(details, scopes, consent.handle), 200, consent.headers);
    }
    if (request.method !== 'POST') return message('出错了', '不支持的请求。', 405);
    if (!sameOrigin(request, env)) return message('出错了', '请求来自别的网站，已拒绝。', 403);
    if (!session || !(await sessionConnected(env.BROKER, env.PUBLIC_ORIGIN, session)))
      return message(
        '需要登录',
        '请先在这个浏览器里打开 Attention Planner 并连接 Google 云端硬盘，再从 AI 客户端重新连接。',
        403,
      );
    const form = await request.formData();
    const handle = String(form.get('handle') ?? '');
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const chosen = [...new Set(['tasks:read', ...form.getAll('scope').map(String)])].filter((s) => SCOPES.includes(s));
    const approved = await oauth.approveConsent(request, handle, { scope: chosen });
    const client = await oauth.lookupClient(approved.request.clientId);
    const name = client?.clientName ?? approved.request.clientId;
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: OWNER,
      metadata: { client: name },
      scope: approved.request.scope,
      props: { session, client: name } satisfies Props,
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return redirect(error.redirectTo);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError)
      return message('无法连接', '这个连接请求无效、已过期或已用过。请回到 AI 客户端重新连接。', 400);
    throw error;
  }
}

async function review(request: Request, env: Env, id: string): Promise<Response> {
  const session = sessionOf(request);
  if (!(await sessionConnected(env.BROKER, env.PUBLIC_ORIGIN, session)))
    return request.method === 'GET'
      ? signIn(env, `/api/ai/review/${id}`)
      : message('需要登录', '请先在这个浏览器里打开 Attention Planner 并连接 Google 云端硬盘。', 403);
  const proposals = kvProposals(env.OAUTH_KV);
  const p = await proposals.get(id);
  if (!p) return message('找不到', '没有这个提议（提议保留两周）。', 404);
  const ws = workspaceFor(env, session!);
  if (request.method === 'POST') {
    if (!sameOrigin(request, env)) return message('出错了', '请求来自别的网站，已拒绝。', 403);
    const form = await request.formData();
    if (form.get('nonce') !== p.nonce) return message('出错了', '这个页面已失效，请刷新后再试。', 400);
    if (p.status === 'pending' && !isExpired(p)) {
      if (form.get('decision') === 'approve') {
        try {
          await ws.change((doc, ctx) => [applyChanges(doc, ctx, p.changes), null]);
          p.status = 'applied';
        } catch (e) {
          p.status = 'failed';
          p.error = e instanceof Error ? e.message : String(e);
        }
      } else p.status = 'rejected';
      p.decidedAt = new Date().toISOString();
      await proposals.put(p);
    }
    return redirect(`/api/ai/review/${id}`);
  }
  const doc = await ws.read();
  const lang = doc.settings.lang === 'en' ? 'en' : 'zh';
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const when = new Date(p.createdAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { timeZone: env.TIME_ZONE });
  const state = isExpired(p) ? 'lapsed' : p.status;
  return page(
    'AI 提议的修改',
    reviewBody(
      p,
      when,
      p.changes.map((c) => describeChange(doc, c, t)),
      state,
      p.error,
    ),
  );
}

async function connections(request: Request, env: Env): Promise<Response> {
  const session = sessionOf(request);
  if (!(await sessionConnected(env.BROKER, env.PUBLIC_ORIGIN, session)))
    return request.method === 'GET'
      ? signIn(env, '/api/ai/connections')
      : message('需要登录', '请先在这个浏览器里打开 Attention Planner 并连接 Google 云端硬盘。', 403);
  const oauth = env.OAUTH_PROVIDER;
  if (request.method === 'POST') {
    if (!sameOrigin(request, env)) return message('出错了', '请求来自别的网站，已拒绝。', 403);
    const form = await request.formData();
    const grant = String(form.get('grant') ?? '');
    if (form.get('action') === 'revoke' && grant) await oauth.revokeGrant(grant, OWNER);
    return redirect('/api/ai/connections');
  }
  const grants = await oauth.listUserGrants(OWNER, { limit: 100 });
  return page(
    'AI 连接',
    connectionsBody(
      grants.items.map((g) => ({
        id: g.id,
        client: (g.metadata as { client?: string } | undefined)?.client ?? g.clientId,
        scope: g.scope,
        createdAt: g.createdAt,
      })),
      `${env.PUBLIC_ORIGIN}/api/mcp`,
    ),
  );
}

const pages = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/ai/authorize') return authorize(request, env, url);
    if (url.pathname === '/api/ai/resume') {
      const path = await env.OAUTH_KV.get(`ap-resume:${url.searchParams.get('key') ?? ''}`);
      return path ? redirect(path) : message('已过期', '请回到 AI 客户端重新连接。', 400);
    }
    const m = url.pathname.match(/^\/api\/ai\/review\/([A-Za-z0-9_-]{10,64})$/);
    if (m) return review(request, env, m[1]);
    if (url.pathname === '/api/ai/connections') return connections(request, env);
    return json({ error: 'Not found.' }, 404);
  },
};

export default new OAuthProvider<Env>({
  apiRoute: '/api/mcp',
  apiHandler: mcpApi as never,
  defaultHandler: pages as never,
  authorizeEndpoint: '/api/ai/authorize',
  tokenEndpoint: '/api/ai/token',
  clientRegistrationEndpoint: '/api/ai/register',
  scopesSupported: SCOPES,
  requiredScopes: ['tasks:read'],
  resourceMetadata: {
    resource: 'https://todo.onthat.top/api/mcp',
    authorization_servers: ['https://todo.onthat.top'],
    resource_name: 'Attention Planner',
  },
  clientIdMetadataDocumentEnabled: true,
  accessTokenTTL: 60 * 60,
  refreshTokenTTL: 180 * 86400,
  refreshTokenIdleTTL: 60 * 86400,
});
