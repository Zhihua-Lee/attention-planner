import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ensureGoogleDriveCalendarExportFile,
    fetchGoogleDriveCalendarEvents,
    mapGoogleDriveOutlookEvent,
} from './google-drive-calendar';
import {
    __googleDriveSyncTestUtils,
    connectGoogleDrive,
    setGoogleDriveSyncConfig,
} from './google-drive-sync';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        status,
    });
}

describe('Google Drive Outlook calendar bridge', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        __googleDriveSyncTestUtils.reset();
        vi.clearAllMocks();
        Object.assign(window, {
            google: {
                accounts: {
                    oauth2: {
                        initTokenClient: vi.fn((config: { callback(response: Record<string, unknown>): void }) => ({
                            requestAccessToken: vi.fn(() => config.callback({
                                access_token: 'google-access-token',
                                expires_in: 3600,
                            })),
                        })),
                        revoke: vi.fn((_token: string, callback?: () => void) => callback?.()),
                    },
                },
            },
        });
        setGoogleDriveSyncConfig({ clientId: 'google-client-id.apps.googleusercontent.com' });
        await connectGoogleDrive();
    });

    it('creates one private My Drive export file with the application marker', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ files: [] }))
            .mockResolvedValueOnce(jsonResponse({
                id: 'calendar-file-1',
                modifiedTime: '2026-08-24T12:00:00.000Z',
                name: 'outlook-calendar.json',
            }));
        vi.stubGlobal('fetch', fetcher);

        await expect(ensureGoogleDriveCalendarExportFile()).resolves.toEqual({
            connected: true,
            fileReady: true,
            modifiedTime: '2026-08-24T12:00:00.000Z',
        });

        expect(String(fetcher.mock.calls[0]?.[0])).toContain('spaces=drive');
        const [url, init] = fetcher.mock.calls[1] as [string, RequestInit];
        expect(url).toContain('/upload/drive/v3/files?uploadType=multipart');
        expect(init.method).toBe('POST');
        expect(init.body).toBeInstanceOf(Blob);
        expect((init.body as Blob).size).toBeGreaterThan(0);
        expect(new Headers(init.headers).get('Content-Type')).toContain('multipart/related');
    });

    it('maps the minimal Power Automate export fields', () => {
        expect(mapGoogleDriveOutlookEvent({
            id: 'event-1',
            title: 'Office hours',
            start: '2026-08-24T14:00:00-05:00',
            end: '2026-08-24T15:00:00-05:00',
            location: { displayName: 'Room 101' },
            allDay: false,
        })).toMatchObject({
            id: 'outlook-google-drive:event-1',
            title: 'Office hours',
            start: '2026-08-24T19:00:00.000Z',
            end: '2026-08-24T20:00:00.000Z',
            location: 'Room 101',
            allDay: false,
        });
    });

    it('downloads the export directly from Drive and filters it to the requested range', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'calendar-file-1' }] }))
            .mockResolvedValueOnce(jsonResponse([
                {
                    id: 'inside',
                    subject: 'Inside range',
                    startWithTimeZone: '2026-08-24T10:00:00-05:00',
                    endWithTimeZone: '2026-08-24T10:30:00-05:00',
                    location: 'Library',
                    isAllDay: false,
                },
                {
                    id: 'outside',
                    subject: 'Outside range',
                    startWithTimeZone: '2026-08-26T10:00:00-05:00',
                    endWithTimeZone: '2026-08-26T10:30:00-05:00',
                    isAllDay: false,
                },
            ]));
        vi.stubGlobal('fetch', fetcher);

        const result = await fetchGoogleDriveCalendarEvents(
            new Date('2026-08-24T00:00:00.000Z'),
            new Date('2026-08-25T00:00:00.000Z'),
        );

        expect(result?.calendar.name).toBe('Outlook (Google Drive)');
        expect(result?.events.map((event) => event.title)).toEqual(['Inside range']);
        expect(String(fetcher.mock.calls[1]?.[0])).toContain('/drive/v3/files/calendar-file-1?alt=media');
    });
});
