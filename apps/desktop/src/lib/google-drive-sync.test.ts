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
        const oauth2 = (window as any).google.accounts.oauth2;
        expect(oauth2.initTokenClient).toHaveBeenCalledWith(expect.objectContaining({
            scope: expect.stringContaining('https://www.googleapis.com/auth/drive.file'),
        }));
    });

    it('lists only appDataFolder and downloads the hidden data file', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '7' }] }))
            .mockResolvedValueOnce(jsonResponse(appData))
            .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '7' }] }));
        vi.stubGlobal('fetch', fetcher);

        await expect(downloadGoogleDriveAppData()).resolves.toEqual({ data: appData, revision: '7' });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain('spaces=appDataFolder');
        expect(String(fetcher.mock.calls[1]?.[0])).toContain('/drive/v3/files/file-1?alt=media');
        const headers = new Headers((fetcher.mock.calls[0]?.[1] as RequestInit).headers);
        expect(headers.get('Authorization')).toBe('Bearer google-access-token');
        expect(fetcher).toHaveBeenCalledTimes(3);
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
            files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '8' }],
        })));

        await expect(uploadGoogleDriveAppData(appData, '7')).rejects.toBeInstanceOf(GoogleDriveConflictError);
    });

    it('uses the v2 file ETag and conditional v2 media upload, with no v3 PATCH fallback', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '7' }] }))
            .mockResolvedValueOnce(jsonResponse({ id: 'file-1', version: '7', etag: '"file-v2-etag"' }, 200, { ETag: '"different-http-etag"' }))
            .mockResolvedValueOnce(jsonResponse({ id: 'file-1', version: '8' }));
        vi.stubGlobal('fetch', fetcher);

        await expect(uploadGoogleDriveAppData(appData, '7')).resolves.toEqual({ revision: '8' });
        expect(String(fetcher.mock.calls[1][0])).toContain('/drive/v2/files/file-1?fields=id,version,etag');
        const [url, init] = fetcher.mock.calls[2] as [string, RequestInit];
        expect(url).toContain('/upload/drive/v2/files/file-1?uploadType=media');
        expect(init.method).toBe('PUT');
        expect(new Headers(init.headers).get('If-Match')).toBe('"file-v2-etag"');
        expect(JSON.parse(String(init.body))).toEqual(appData);
        expect(fetcher.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
    });

    it.each([undefined, '', '*', 'W/"weak"', 'unquoted', '"one", "two"'])('refuses upload without an exact strong v2 ETag: %s', async etag => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '7' }] }))
            .mockResolvedValueOnce(jsonResponse({ id: 'file-1', version: '7', etag }, 200, { ETag: '"header-cannot-substitute"' }));
        vi.stubGlobal('fetch', fetcher);

        await expect(uploadGoogleDriveAppData(appData, '7')).rejects.toThrow('strong file ETag');
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
    });

    it('handles an MCP write after metadata as a 412 conflict without retrying the upload', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '7' }] }))
            .mockResolvedValueOnce(jsonResponse({ id: 'file-1', version: '7', etag: '"old-etag"' }))
            .mockResolvedValueOnce(jsonResponse({ error: { message: 'Precondition failed' } }, 412));
        vi.stubGlobal('fetch', fetcher);

        await expect(uploadGoogleDriveAppData(appData, '7')).rejects.toBeInstanceOf(GoogleDriveConflictError);
        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('If-Match')).toBe('"old-etag"');
    });

    it('rejects changes between the v3 file lookup and v2 ETag lookup before uploading', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '7' }] }))
            .mockResolvedValueOnce(jsonResponse({ id: 'file-1', version: '8', etag: '"new-etag"' }));
        vi.stubGlobal('fetch', fetcher);

        await expect(uploadGoogleDriveAppData(appData, '7')).rejects.toBeInstanceOf(GoogleDriveConflictError);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it.each([
        { files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '8' }] },
        { files: [{ id: 'file-2', name: 'attention-planner-v2.json', version: '7' }] },
        { files: [] },
    ])('rejects a download whose file or version changed during the media read: %j', async ({ files }) => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '7' }] }))
            .mockResolvedValueOnce(jsonResponse(appData))
            .mockResolvedValueOnce(jsonResponse({ files }));
        vi.stubGlobal('fetch', fetcher);

        await expect(downloadGoogleDriveAppData()).rejects.toBeInstanceOf(GoogleDriveConflictError);
        expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it.each([
        { files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '7' }, { id: 'file-2', name: 'attention-planner-v2.json', version: '8' }] },
        { files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '7' }], nextPageToken: 'more-files' },
        { files: [{ id: 'file-1', name: 'attention-planner-v2.json', version: '7' }], incompleteSearch: true },
    ])('rejects ambiguous discovery for both downloads and updates: %j', async payload => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(payload))
            .mockResolvedValueOnce(jsonResponse(payload));
        vi.stubGlobal('fetch', fetcher);

        await expect(downloadGoogleDriveAppData()).rejects.toThrow('multiple or incomplete');
        await expect(uploadGoogleDriveAppData(appData, '7')).rejects.toThrow('multiple or incomplete');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('also rejects duplicate files that appear during a download', async () => {
        const file = { id: 'file-1', name: 'attention-planner-v2.json', version: '7' };
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ files: [file] }))
            .mockResolvedValueOnce(jsonResponse(appData))
            .mockResolvedValueOnce(jsonResponse({ files: [file, { ...file, id: 'file-2' }] }));
        vi.stubGlobal('fetch', fetcher);

        await expect(downloadGoogleDriveAppData()).rejects.toThrow('multiple or incomplete');
    });

    it.each([null, {}, { files: 'invalid' }, { files: [null] }, { files: [{ id: 'file-1' }] }])('never treats malformed discovery as a missing file to create: %j', async payload => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(payload));
        vi.stubGlobal('fetch', fetcher);

        await expect(uploadGoogleDriveAppData(appData, null)).rejects.toThrow('invalid app sync file');
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
});
