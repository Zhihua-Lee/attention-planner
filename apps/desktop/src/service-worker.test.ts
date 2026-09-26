import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');

function harness() {
    const handlers = new Map<string, (event: unknown) => void>();
    const put = vi.fn();
    const caches = { open: vi.fn(async () => ({ put })), match: vi.fn(async () => undefined) };
    const fetch = vi.fn(async () => ({ ok: true, clone: () => ({}) }));
    runInNewContext(source, {
        URL, caches, fetch,
        self: {
            location: { origin: 'https://todo.onthat.top' },
            addEventListener: (name: string, listener: (event: unknown) => void) => handlers.set(name, listener),
        },
    });
    const navigate = (path: string) => {
        const respondWith = vi.fn();
        handlers.get('fetch')!({
            request: { method: 'GET', url: `https://todo.onthat.top${path}`, mode: 'navigate', destination: 'document' },
            respondWith,
        });
        return respondWith;
    };
    return { navigate, fetch, caches, put };
}

describe('PWA service worker private navigation boundaries', () => {
    it.each([
        '/api', '/api/session', '/api/google/callback?code=fixture',
        '/api/mcp/proposals/fixture', '/api/mcp/connections',
        '/.well-known', '/.well-known/oauth-authorization-server',
        '/.well-known/oauth-protected-resource/api/mcp',
        '/redirect', '/redirect.html',
    ])('leaves %s to the network without intercepting or caching it', (path) => {
        const worker = harness();
        expect(worker.navigate(path)).not.toHaveBeenCalled();
        expect(worker.fetch).not.toHaveBeenCalled();
        expect(worker.caches.open).not.toHaveBeenCalled();
    });

    it('retains network-first offline shell caching for the actual application', async () => {
        const worker = harness();
        const respondWith = worker.navigate('/?view=now');
        expect(respondWith).toHaveBeenCalledOnce();
        await respondWith.mock.calls[0][0];
        expect(worker.fetch).toHaveBeenCalledOnce();
        expect(worker.put).toHaveBeenCalledWith('/index.html', expect.any(Object));
    });
});
