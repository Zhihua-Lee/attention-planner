import { describe, expect, it, vi } from 'vitest';

import {
    fetchOutlookCalendarDelta,
    mapOutlookGraphEvent,
} from './outlook-calendar';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        status,
    });
}

function createMemoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => {
            values.delete(key);
        },
        setItem: (key, value) => {
            values.set(key, value);
        },
    };
}

describe('Outlook calendar Graph adapter', () => {
    it('maps a UTC Graph event to the shared external calendar format', () => {
        expect(mapOutlookGraphEvent({
            id: 'meeting-1',
            subject: 'Project review',
            bodyPreview: 'Bring the prototype',
            isAllDay: false,
            location: { displayName: 'Room 204' },
            start: { dateTime: '2026-08-23T14:00:00.0000000', timeZone: 'UTC' },
            end: { dateTime: '2026-08-23T14:30:00.0000000', timeZone: 'UTC' },
        })).toEqual({
            id: 'outlook-graph:meeting-1',
            sourceId: 'outlook-graph',
            nativeEventId: 'meeting-1',
            title: 'Project review',
            description: 'Bring the prototype',
            location: 'Room 204',
            start: '2026-08-23T14:00:00.000Z',
            end: '2026-08-23T14:30:00.000Z',
            allDay: false,
        });
    });

    it('follows pagination, saves a delta link, and reuses cached events on an incremental sync', async () => {
        const storage = createMemoryStorage();
        const rangeStart = new Date('2026-08-23T00:00:00.000Z');
        const rangeEnd = new Date('2026-08-25T00:00:00.000Z');
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({
                '@odata.nextLink': 'https://graph.microsoft.com/page-2',
                value: [{
                    id: 'event-a',
                    subject: 'Keep me',
                    start: { dateTime: '2026-08-23T10:00:00', timeZone: 'UTC' },
                    end: { dateTime: '2026-08-23T11:00:00', timeZone: 'UTC' },
                }],
            }))
            .mockResolvedValueOnce(jsonResponse({
                '@odata.deltaLink': 'https://graph.microsoft.com/delta-token-1',
                value: [{
                    id: 'event-b',
                    subject: 'Remove me later',
                    start: { dateTime: '2026-08-24T10:00:00', timeZone: 'UTC' },
                    end: { dateTime: '2026-08-24T11:00:00', timeZone: 'UTC' },
                }],
            }))
            .mockResolvedValueOnce(jsonResponse({
                '@odata.deltaLink': 'https://graph.microsoft.com/delta-token-2',
                value: [
                    { id: 'event-b', '@removed': { reason: 'deleted' } },
                    {
                        id: 'event-c',
                        subject: 'New meeting',
                        start: { dateTime: '2026-08-24T12:00:00', timeZone: 'UTC' },
                        end: { dateTime: '2026-08-24T12:30:00', timeZone: 'UTC' },
                    },
                ],
            }));

        const initial = await fetchOutlookCalendarDelta({
            accessToken: 'token',
            accountKey: 'account',
            fetcher,
            rangeEnd,
            rangeStart,
            storage,
        });
        expect(initial.map((event) => event.title)).toEqual(['Keep me', 'Remove me later']);

        const incremental = await fetchOutlookCalendarDelta({
            accessToken: 'token',
            accountKey: 'account',
            fetcher,
            rangeEnd,
            rangeStart,
            storage,
        });
        expect(incremental.map((event) => event.title)).toEqual(['Keep me', 'New meeting']);
        expect(fetcher).toHaveBeenNthCalledWith(
            3,
            'https://graph.microsoft.com/delta-token-1',
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer token',
                    Prefer: 'outlook.timezone="UTC"',
                }),
            }),
        );
    });
});
