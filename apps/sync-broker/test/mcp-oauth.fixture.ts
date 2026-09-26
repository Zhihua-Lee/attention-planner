// Local-only worker entry used by Miniflare. Never referenced by wrangler.jsonc.
import { createMcpAuthHandler, isMcpGrantActive } from '../src/mcp-auth';
import { handleMcpHttp } from '../src/mcp-http';

export default createMcpAuthHandler({
    async authenticatedEmail(request, env) {
        return request.headers.get('Cookie')?.split(';').some((part) => part.trim() === 'fixture-session=owner')
            ? env.ALLOWED_EMAIL : null;
    },
    async handleMcp(request, env, _context, auth) {
        return handleMcpHttp(request, auth, async (actor, tool, args) => ({
            fixture: true,
            tool,
            args,
            actor,
            grantActive: await isMcpGrantActive(env, auth),
        }), env.PUBLIC_ORIGIN);
    },
    async handleDefault() { return new Response('Unimplemented fixture route', { status: 404 }); },
});
