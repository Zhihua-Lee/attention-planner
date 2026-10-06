import { calendarUrl } from '../../functions/ics';
import { addDays } from '../../src/model/dates';
import type { Ctx } from '../../src/model/doc';
import { parseIcs } from '../../src/model/ics';
import { outlookEvents } from '../../src/model/outlook';
import type { CalendarEvent, Day, Doc } from '../../src/model/types';
import { readOutlookExport, type TokenSource } from '../../src/store/drive';
import { ConflictError, type Remote } from '../../src/store/sync';
import { eventToZone, realTimes, wallClock } from './clock';

export const NO_DATA = 'There is no Attention Planner data in Google Drive yet. Open the app and turn on sync first.';

/**
 * The owner's document as the AI sees it: read from Drive, changed with the app's own operations, and written back
 * only if nobody saved in between (then it reads again and retries). Days and times are the owner's.
 */
export class Workspace {
  constructor(
    private remote: Remote,
    readonly timeZone: string,
    private options: {
      device?: string;
      token?: TokenSource;
      fetcher?: typeof fetch;
      clock?: () => Date;
    } = {},
  ) {}

  /** The owner's wall-clock time now. */
  now(): Date {
    return wallClock(this.timeZone, (this.options.clock ?? (() => new Date()))());
  }

  async read(): Promise<Doc> {
    const { doc } = await this.remote.read();
    if (!doc) throw new Error(NO_DATA);
    return doc;
  }

  /** Apply `fn` to the latest document and save it. Returns what `fn` returned. */
  async change<T>(fn: (doc: Doc, ctx: Ctx) => [Doc, T]): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { doc, version } = await this.remote.read();
      if (!doc) throw new Error(NO_DATA);
      const real = (this.options.clock ?? (() => new Date()))();
      const wall = wallClock(this.timeZone, real);
      const [next, out] = fn(doc, { now: wall, device: this.options.device ?? 'ai' });
      if (next === doc) return out;
      try {
        await this.remote.write(realTimes(next, wall, real), version);
        return out;
      } catch (e) {
        if (e instanceof ConflictError) continue;
        throw e;
      }
    }
    throw new Error('Another device kept saving at the same moment. Try again.');
  }

  /**
   * Calendar events between two days: the Outlook export and the calendar subscriptions in Settings.
   * (Files imported on a device stay on that device.) A source that cannot be read is skipped.
   */
  async events(doc: Doc, from: Day, to: Day): Promise<CalendarEvent[]> {
    const wide = [addDays(from, -1), addDays(to, 1)] as const;
    const out: CalendarEvent[] = [];
    const fetcher = this.options.fetcher ?? fetch.bind(globalThis);
    if (this.options.token) {
      try {
        const file = await readOutlookExport(this.options.token, fetcher);
        if (file) out.push(...outlookEvents(file.data, ...wide).map((e) => ({ ...e, source: 'outlook' })));
      } catch {
        /* skipped */
      }
    }
    for (const sub of doc.settings.calendars ?? []) {
      const url = calendarUrl(sub.url);
      if (!url) continue;
      try {
        const res = await fetcher(url.toString(), { headers: { Accept: 'text/calendar, text/plain;q=0.5' } });
        const text = res.ok ? await res.text() : '';
        if (/^﻿?\s*BEGIN:VCALENDAR/i.test(text))
          out.push(...parseIcs(text, ...wide).map((e) => ({ ...e, source: `sub:${sub.id}` })));
      } catch {
        /* skipped */
      }
    }
    return out.map((e) => eventToZone(e, this.timeZone)).filter((e) => e.day >= from && e.day <= to);
  }
}
