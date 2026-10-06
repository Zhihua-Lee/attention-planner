import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import OAuthProvider, {
  AuthorizationError,
  CimdFetchError,
  type OAuthHelpers,
  type OAuthResourceAuth,
} from '@cloudflare/workers-oauth-provider';
import { inRounds } from '../../src/model/doc';
import { DriveRemote } from '../../src/store/drive';
import { brokerTokens, notifyDevices, sessionConnected, sessionOf, type Broker } from './broker';
import { applyChanges, describeChange } from './changes';
import { connectionsBody, consentBody, message, page, reviewBody } from './pages';
import { CAPTURE_CURRENT, CAPTURE_KEY_PREFIX, captureLine, hashKey, lineFrom } from './capture';
import { isExpired, kvProposals, randomId } from './proposals';
import { createServer } from './tools';
import { Workspace } from './workspace';

/**
 * Remote MCP for Attention Planner, at /api/mcp on the app's own origin.
 *
 * - OAuth 2.1 for AI clients (dynamic registration, client metadata documents, PKCE) under /api/ai/.
 * - Reads and writes the same Drive file the app syncs, with Google tokens from the existing sync broker.
 * - Changes, and new tasks unless the owner chose to have them saved at once, are proposals kept with the tasks and
 *   decided in the app.
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
      notify: (id) => notifyDevices(env.BROKER, env.PUBLIC_ORIGIN, ctx.props.session, id),
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
      // Offer every permission, whatever the client asked for: clients ask only for what the resource requires
      // (reading), and the owner decides about writing here. The grant may hold more than was requested.
      const scopes = SCOPES;
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
  // Since 0.2.10 proposals live with the tasks and are decided in the app; this page is only for older ones.
  if (request.method === 'GET' && !(await kvProposals(env.OAUTH_KV).get(id))) return redirect(`/?proposal=${id}`);
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
  const doc = inRounds(await ws.read(), ws.now());
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

const plain = (text: string, status = 200) =>
  new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });

/** Make (or turn off) this owner's capture link, from the app (same-origin, signed in). */
async function captureLink(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!sameOrigin(request, env)) return json({ error: 'Cross-origin request rejected.' }, 403);
  const session = sessionOf(request);
  if (!(await sessionConnected(env.BROKER, env.PUBLIC_ORIGIN, session)))
    return json({ error: 'Connect sync (sign in to Google) first.' }, 403);
  const body = (await request.json().catch(() => ({}))) as { off?: boolean };
  const old = await env.OAUTH_KV.get(CAPTURE_CURRENT);
  if (old) await env.OAUTH_KV.delete(CAPTURE_KEY_PREFIX + old);
  if (body.off) {
    await env.OAUTH_KV.delete(CAPTURE_CURRENT);
    return json({ url: null }, 200);
  }
  const key = randomId(24);
  const hash = await hashKey(key);
  await env.OAUTH_KV.put(CAPTURE_KEY_PREFIX + hash, session!);
  await env.OAUTH_KV.put(CAPTURE_CURRENT, hash);
  return json({ url: `${env.PUBLIC_ORIGIN}/api/ai/capture?k=${key}` }, 200);
}

/** Write one line down through the capture link: `?k=<key>&text=…`, or POST the text. */
async function capture(request: Request, env: Env): Promise<Response> {
  const key = new URL(request.url).searchParams.get('k') ?? '';
  const session = /^[A-Za-z0-9_-]{20,64}$/.test(key)
    ? await env.OAUTH_KV.get(CAPTURE_KEY_PREFIX + (await hashKey(key)))
    : null;
  if (!session) return plain('这个快捷记录链接无效或已停用。', 403);
  const line = await lineFrom(request);
  try {
    const title = await captureLine(workspaceFor(env, session), line);
    return title ? plain(`已记下：${title}`) : plain('没有要记下的内容。', 400);
  } catch (e) {
    return plain(e instanceof Error ? e.message : String(e), 502);
  }
}

const pages = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/ai/capture') return capture(request, env);
    if (url.pathname === '/api/ai/capture-link') return captureLink(request, env);
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
  // Clients ask for what is listed here, so list writing too; the owner can still untick it on the consent page.
  requiredScopes: SCOPES,
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
