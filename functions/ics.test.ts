import { describe, expect, it } from 'vitest';
import { calendarUrl, onRequestGet } from './ics';

describe('calendar subscription fetch', () => {
  it('accepts https and webcal addresses and refuses local or odd ones', () => {
    expect(calendarUrl('webcal://example.com/cal.ics')?.toString()).toBe('https://example.com/cal.ics');
    expect(calendarUrl('https://outlook.office365.com/owa/calendar/x/calendar.ics')).not.toBeNull();
    for (const bad of [
      'file:///etc/passwd',
      'http://localhost/a.ics',
      'http://192.168.1.2/a.ics',
      'https://u:p@x.com/a',
      'not a url',
      null,
    ])
      expect(calendarUrl(bad as string | null)).toBeNull();
  });
  it('passes calendars through and refuses anything else', async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR')) as typeof fetch;
      const ok = await onRequestGet({ request: new Request('https://app/ics?url=https%3A%2F%2Fexample.com%2Fa.ics') });
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain('BEGIN:VCALENDAR');
      globalThis.fetch = (async () => new Response('<html>hi</html>')) as typeof fetch;
      const html = await onRequestGet({ request: new Request('https://app/ics?url=https%3A%2F%2Fexample.com%2Fa') });
      expect(html.status).toBe(415);
      const bad = await onRequestGet({ request: new Request('https://app/ics?url=http%3A%2F%2Flocalhost%2Fa') });
      expect(bad.status).toBe(400);
    } finally {
      globalThis.fetch = real;
    }
  });
});
