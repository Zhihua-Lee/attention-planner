import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    __googleDriveSyncTestUtils,
    connectGoogleDrive,
    downloadGoogleDriveAppData,
    getGoogleDriveConnection,
    GoogleDriveConflictError,
    setGoogleDriveSyncConfig,
    uploadGoogleDriveAppData,
} from './google-drive-sync';

const appData = { tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', ...headers },
        status,
    });
}

describe('Google Drive appDataFolder sync transport', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        __googleDriveSyncTestUtils.reset();
        vi.clearAllMocks();
        let tokenCallback: ((response: Record<string, unknown>) => void) | null = null;
        Object.assign(window, {
            google: {
                accounts: {
                    oauth2: {
                        initTokenClient: vi.fn((config: { callback(response: Record<string, unknown>): void }) => {
                            tokenCallback = config.callback;
                            return {
                                requestAccessToken: vi.fn(() => tokenCallback?.({
                                    access_token: 'google-access-token',
                                    expires_in: 3600,
                                    scope: 'https://www.googleapis.com/auth/drive.appdata',
                                })),
                            };
                        }),
                        revoke: vi.fn((_token: string, callback?: () => void) => callback?.()),
                    },
                },
            },
        });
        setGoogleDriveSyncConfig({ clientId: 'google-client-id.apps.googleusercontent.com' });
        await connectGoogleDrive();
    });

    it('keeps the access token in session storage and reports a connected browser session', async () => {
        await expect(getGoogleDriveConnection()).resolves.toMatchObject({
            configured: true,
            connected: true,
        });
        expect(window.localStorage.getItem('attention-planner:google-drive-sync:token:v1')).toBeNull();
        expect(window.sessionStorage.getItem('attention-planner:google-drive-sync:token:v1')).toContain('google-access-token');
    });

    it('lists only appDataFolder and downloads the hidden data file', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'data.json', version: '7' }] }))
            .mockResolvedValueOnce(jsonResponse(appData));
        vi.stubGlobal('fetch', fetcher);

        await expect(downloadGoogleDriveAppData()).resolves.toEqual({ data: appData, revision: '7' });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain('spaces=appDataFolder');
        expect(String(fetcher.mock.calls[1]?.[0])).toContain('/drive/v3/files/file-1?alt=media');
        const headers = new Headers((fetcher.mock.calls[0]?.[1] as RequestInit).headers);
        expect(headers.get('Authorization')).toBe('Bearer google-access-token');
    });

    it('creates the first sync file as multipart content inside appDataFolder', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ files: [] }))
            .mockResolvedValueOnce(jsonResponse({ id: 'file-1', version: '1' }));
        vi.stubGlobal('fetch', fetcher);

        await expect(uploadGoogleDriveAppData(appData, null)).resolves.toEqual({ revision: '1' });
        const [url, init] = fetcher.mock.calls[1] as [string, RequestInit];
        expect(url).toContain('/upload/drive/v3/files?uploadType=multipart');
        expect(init.method).toBe('POST');
        expect(new Headers(init.headers).get('Content-Type')).toContain('multipart/related');
        expect((init.body as Blob).size).toBeGreaterThan(0);
    });

    it('stops before upload when the Drive version changed', async () => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
            files: [{ id: 'file-1', name: 'data.json', version: '8' }],
        })));

        await expect(uploadGoogleDriveAppData(appData, '7')).rejects.toBeInstanceOf(GoogleDriveConflictError);
    });
});
