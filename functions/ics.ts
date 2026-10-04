/**
 * GET /ics?url=<calendar address> — fetch a calendar subscription for the app (browsers cannot read most calendar
 * feeds directly because of cross-origin rules). Only calendar files are passed through, size-capped and cached
 * briefly, so this cannot serve as a general proxy.
 */
const MAX_BYTES = 3 * 1024 * 1024;

export function calendarUrl(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('[')
  )
    return null;
  return url;
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request }: { request: Request }): Promise<Response> {
  const url = calendarUrl(new URL(request.url).searchParams.get('url'));
  if (!url) return text('Not a calendar address.', 400);
  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      headers: { Accept: 'text/calendar, text/plain;q=0.5' },
      redirect: 'follow',
      cf: { cacheTtl: 600, cacheEverything: true },
    } as RequestInit);
  } catch {
    return text('The calendar could not be reached.', 502);
  }
  if (!upstream.ok) return text(`The calendar answered ${upstream.status}.`, 502);
  const length = Number(upstream.headers.get('Content-Length') ?? 0);
  if (length > MAX_BYTES) return text('The calendar is too large.', 413);
  const body = await upstream.text();
  if (body.length > MAX_BYTES) return text('The calendar is too large.', 413);
  if (!/^﻿?\s*BEGIN:VCALENDAR/i.test(body)) return text('That address did not return a calendar.', 415);
  return new Response(body, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' },
  });
}
