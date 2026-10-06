import { describe, expect, it } from 'vitest';
import { onRequest } from '../functions/assets/[[path]]';

describe('/assets/*', () => {
  it('passes a file through, kept for a year', async () => {
    const res = await onRequest({
      next: async () => new Response('x', { headers: { 'Content-Type': 'application/javascript' } }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('x');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('answers a file not there yet with a 404 nobody keeps, not with the app page', async () => {
    const res = await onRequest({
      next: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
