import {
    isMindwtrMirrorCalendar,
    mergeExternalCalendarSources,
    parseIcs,
    type ExternalCalendarEvent,
    type ExternalCalendarSourceResult,
    type ExternalCalendarSubscription,
} from '@mindwtr/core';
import { gunzipSync, strFromU8 } from 'fflate';
import { ExternalCalendarService } from './external-calendar-service';
import { isLocalCalendarFileUrl } from './external-calendar-source';
import { isTauriRuntime } from './runtime';
import { fetchSystemCalendarEvents } from './system-calendar';
import { getTauriHttpFetch } from './tauri-http';
import { fetchOutlookCalendarEvents } from './outlook-calendar';

const ICS_MONTH_CACHE_TTL_MS = 5 * 60 * 1000;
const ICS_MONTH_CACHE_MAX_ENTRIES = 120;

type IcsMonthCacheEntry = {
    events: ExternalCalendarEvent[];
    expiresAt: number;
    lastAccessedAt: number;
};

type MonthRange = {
    end: Date;
    key: string;
    start: Date;
};

const icsMonthCache = new Map<string, IcsMonthCacheEntry>();

export const summarizeExternalCalendarWarnings = (warnings: string[]): string | null => {
    if (warnings.length === 0) return null;
    if (warnings.length === 1) return warnings[0];
    return `${warnings[0]} (+${warnings.length - 1} more)`;
};

function getMonthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getVisibleMonthRanges(rangeStart: Date, rangeEnd: Date): MonthRange[] {
    const ranges: MonthRange[] = [];
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    const inclusiveEnd = rangeEnd > rangeStart ? new Date(rangeEnd.getTime() - 1) : rangeStart;
    const last = new Date(inclusiveEnd.getFullYear(), inclusiveEnd.getMonth(), 1);

    while (cursor <= last) {
        const start = new Date(cursor);
        const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        ranges.push({ key: getMonthKey(start), start, end });
        cursor.setMonth(cursor.getMonth() + 1);
    }
    return ranges;
}

function getIcsCacheKey(calendar: ExternalCalendarSubscription, monthKey: string): string {
    return `${calendar.id}:${calendar.url}:${monthKey}`;
}

function pruneIcsMonthCache(): void {
    while (icsMonthCache.size > ICS_MONTH_CACHE_MAX_ENTRIES) {
        let oldestKey: string | null = null;
        let oldestAccessedAt = Number.POSITIVE_INFINITY;
        for (const [key, entry] of icsMonthCache.entries()) {
            if (entry.lastAccessedAt < oldestAccessedAt) {
                oldestAccessedAt = entry.lastAccessedAt;
                oldestKey = key;
            }
        }
        if (!oldestKey) return;
        icsMonthCache.delete(oldestKey);
    }
}

function eventOverlapsRange(event: ExternalCalendarEvent, rangeStart: Date, rangeEnd: Date): boolean {
    const startMs = Date.parse(event.start);
    const endMs = Date.parse(event.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
    return startMs < rangeEnd.getTime() && endMs > rangeStart.getTime();
}

async function loadCachedIcsEventsForCalendar(
    calendar: ExternalCalendarSubscription,
    monthRanges: MonthRange[],
    rangeStart: Date,
    rangeEnd: Date,
): Promise<ExternalCalendarEvent[]> {
    const now = Date.now();
    const events: ExternalCalendarEvent[] = [];
    const missingRanges: MonthRange[] = [];

    for (const monthRange of monthRanges) {
        const cacheKey = getIcsCacheKey(calendar, monthRange.key);
        const cached = icsMonthCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            cached.lastAccessedAt = now;
            events.push(...cached.events.filter((event) => eventOverlapsRange(event, rangeStart, rangeEnd)));
            continue;
        }
        if (cached) icsMonthCache.delete(cacheKey);
        missingRanges.push(monthRange);
    }

    if (missingRanges.length === 0) {
        return events;
    }

    const text = await fetchTextWithTimeout(calendar.url, 15_000);
    for (const monthRange of missingRanges) {
        const parsed = parseIcs(text, {
            sourceId: calendar.id,
            rangeStart: monthRange.start,
            rangeEnd: monthRange.end,
        });
        icsMonthCache.set(getIcsCacheKey(calendar, monthRange.key), {
            events: parsed,
            expiresAt: now + ICS_MONTH_CACHE_TTL_MS,
            lastAccessedAt: now,
        });
        events.push(...parsed.filter((event) => eventOverlapsRange(event, rangeStart, rangeEnd)));
    }
    pruneIcsMonthCache();
    return events;
}

async function readCalendarResponseText(res: Response): Promise<string> {
    const bytes = new Uint8Array(await res.arrayBuffer());
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    return strFromU8(isGzip ? gunzipSync(bytes) : bytes);
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
    if (isLocalCalendarFileUrl(url)) {
        if (!isTauriRuntime()) {
            throw new Error('Local calendar files require the desktop app.');
        }
        const mod: any = await import('@tauri-apps/plugin-fs');
        return await mod.readTextFile(url);
    }

    if (isTauriRuntime()) {
        const tauriFetch = await getTauriHttpFetch();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await (tauriFetch ?? fetch)(url, { method: 'GET', signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await readCalendarResponseText(res);
        } finally {
            clearTimeout(timeout);
        }
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await readCalendarResponseText(res);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export async function fetchExternalCalendarEvents(
    rangeStart: Date,
    rangeEnd: Date,
): Promise<{
    calendars: ExternalCalendarSubscription[];
    events: ExternalCalendarEvent[];
    warnings: string[];
}> {
    const calendars = await ExternalCalendarService.getCalendars();
    const importableCalendars = calendars.filter((calendar) => !isMindwtrMirrorCalendar(calendar));
    const enabled = importableCalendars.filter((calendar) => calendar.enabled);
    const monthRanges = getVisibleMonthRanges(rangeStart, rangeEnd);

    const [icsResults, systemResults, outlookResult] = await Promise.all([
        Promise.allSettled(
            enabled.map((calendar) => loadCachedIcsEventsForCalendar(calendar, monthRanges, rangeStart, rangeEnd))
        ),
        fetchSystemCalendarEvents(rangeStart, rangeEnd),
        fetchOutlookCalendarEvents(rangeStart, rangeEnd)
            .then((value) => ({ status: 'fulfilled' as const, value }))
            .catch((reason: unknown) => ({ status: 'rejected' as const, reason })),
    ]);

    const sources: ExternalCalendarSourceResult[] = [
        { calendars, events: [] },
        {
            calendars: systemResults.calendars,
            events: systemResults.events,
        },
    ];
    const warnings: string[] = [];
    if (outlookResult.status === 'fulfilled' && outlookResult.value) {
        sources.push({
            calendars: [outlookResult.value.calendar],
            events: outlookResult.value.events,
        });
    } else if (outlookResult.status === 'rejected') {
        const detail = outlookResult.reason instanceof Error
            ? outlookResult.reason.message
            : String(outlookResult.reason ?? 'Unknown error');
        warnings.push(`Failed to load Outlook: ${detail}`);
    }
    for (const [index, result] of icsResults.entries()) {
        if (result.status !== 'fulfilled') {
            const calendar = enabled[index];
            const label = (calendar?.name || calendar?.url || 'Unnamed calendar').trim();
            const detail = result.reason instanceof Error ? result.reason.message : String(result.reason ?? 'Unknown error');
            warnings.push(`Failed to load "${label}": ${detail}`);
            continue;
        }
        sources.push({ calendars: [], events: result.value });
    }

    return { ...mergeExternalCalendarSources(sources), warnings };
}

export const __externalCalendarEventsTestUtils = {
    clearCache: () => icsMonthCache.clear(),
};
