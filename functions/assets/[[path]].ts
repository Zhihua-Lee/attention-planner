/**
 * Files under /assets/ are cached for a year, since their names change with their content. Right after a deploy, a
 * new file can be asked for before it has reached every edge; Pages then answers with the app's page instead, and
 * that page would be kept for a year under the file's name, leaving the app blank. A missing file is a plain 404
 * that nobody keeps.
 */
export async function onRequest({ next }: { next: () => Promise<Response> }): Promise<Response> {
  const res = await next();
  if (!(res.headers.get('Content-Type') ?? '').startsWith('text/html')) {
    // _headers does not reach a Function's response, so the year-long caching is set here.
    const kept = new Response(res.body, res);
    if (res.ok) kept.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return kept;
  }
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
