import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const account = {
        environment: 'login.microsoftonline.com',
        homeAccountId: 'personal-home-id',
        localAccountId: 'personal-local-id',
        name: 'Personal User',
        tenantId: 'consumers',
        username: 'personal@example.com',
    };
    const client = {
        acquireTokenSilent: vi.fn(async () => ({ accessToken: 'graph-token' })),
        clearCache: vi.fn(async () => undefined),
        getAccount: vi.fn(({ homeAccountId }: { homeAccountId?: string }) => (
            homeAccountId === account.homeAccountId ? account : null
        )),
        getActiveAccount: vi.fn(() => null),
        getAllAccounts: vi.fn(() => [account]),
        handleRedirectPromise: vi.fn(async () => null),
        initialize: vi.fn(async () => undefined),
        loginPopup: vi.fn(async () => ({ account })),
        setActiveAccount: vi.fn(),
    };
    return { account, client };
});

vi.mock('@azure/msal-browser', () => ({
    BrowserCacheLocation: { LocalStorage: 'localStorage' },
    InteractionRequiredAuthError: class InteractionRequiredAuthError extends Error {},
    PublicClientApplication: vi.fn(() => mocks.client),
}));

import {
    __oneDriveSyncTestUtils,
    connectOneDrive,
    downloadOneDriveAppData,
    OneDriveConflictError,
    getOneDriveRedirectUri,
    setOneDriveSyncConfig,
    testOneDriveConnection,
    uploadOneDriveAppData,
} from './onedrive-sync';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        status,
    });
}

describe('OneDrive Graph sync transport', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        __oneDriveSyncTestUtils.resetClientState();
        vi.clearAllMocks();
        setOneDriveSyncConfig({ clientId: 'microsoft-client-id', tenantId: 'common' });
        await connectOneDrive();
    });

    it('uses the dedicated MSAL redirect bridge', () => {
        expect(getOneDriveRedirectUri()).toBe(`${window.location.origin}/redirect`);
    });

    it('downloads data through the preauthenticated URL without forwarding the bearer token', async () => {
        const appData = { tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} };
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ id: 'app-root' }))
            .mockResolvedValueOnce(jsonResponse({
                '@microsoft.graph.downloadUrl': 'https://files.1drv.example/download',
                eTag: 'etag-1',
                id: 'data-item',
                name: 'data.json',
            }))
            .mockResolvedValueOnce(jsonResponse(appData));
        vi.stubGlobal('fetch', fetcher);

        await expect(downloadOneDriveAppData()).resolves.toEqual({ data: appData, eTag: 'etag-1' });
        expect(fetcher.mock.calls[0]?.[0]).toBe('https://graph.microsoft.com/v1.0/me/special/approot');
        expect(fetcher).toHaveBeenNthCalledWith(
            3,
            'https://files.1drv.example/download',
            { cache: 'no-store' },
        );
        const metadataHeaders = new Headers((fetcher.mock.calls[1]?.[1] as RequestInit).headers);
        expect(metadataHeaders.get('Authorization')).toBe('Bearer graph-token');
    });

    it.each([403, 404])('treats an unprovisioned app root response %s as an empty remote', async (status) => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
            error: { code: 'accessDenied', message: 'Access denied' },
        }, status));
        vi.stubGlobal('fetch', fetcher);

        await expect(downloadOneDriveAppData()).resolves.toEqual({ data: null, eTag: null });
        await expect(testOneDriveConnection()).resolves.toBeUndefined();
    });

    it('uses an eTag precondition and maps concurrent writes to a conflict error', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ error: { message: 'changed' } }, 412));
        vi.stubGlobal('fetch', fetcher);

        await expect(uploadOneDriveAppData({
            tasks: [], projects: [], sections: [], areas: [], people: [], settings: {},
        }, 'etag-1')).rejects.toBeInstanceOf(OneDriveConflictError);

        const init = fetcher.mock.calls[0]?.[1] as RequestInit;
        const headers = new Headers(init.headers);
        expect(init.method).toBe('PUT');
        expect(headers.get('If-Match')).toBe('etag-1');
        expect(headers.get('Authorization')).toBe('Bearer graph-token');
    });
});
