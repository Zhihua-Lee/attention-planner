import { describe, expect, it, vi } from 'vitest';

import { createSyncBackendIO, type SyncBackendContext, type SyncTransport } from './sync-backend-io';
import type { AppData } from './types';

const APP_DATA: AppData = {
    tasks: [], projects: [], sections: [], areas: [], people: [], settings: {},
};

const makeTransport = (): SyncTransport => ({
    webdavGet: vi.fn().mockResolvedValue(null),
    webdavPut: vi.fn().mockResolvedValue(undefined),
    webdavHead: vi.fn().mockResolvedValue(null),
    cloudGet: vi.fn().mockResolvedValue(null),
    cloudPut: vi.fn().mockResolvedValue(undefined),
    cloudHead: vi.fn().mockResolvedValue(null),
    fileRead: vi.fn().mockResolvedValue(null),
    fileWrite: vi.fn().mockResolvedValue(undefined),
    cloudKitRead: vi.fn().mockResolvedValue(null),
    cloudKitWrite: vi.fn().mockResolvedValue(undefined),
    resolveDropboxToken: vi.fn().mockResolvedValue('token'),
    dropboxDownload: vi.fn().mockResolvedValue({ data: null, rev: null }),
    dropboxUpload: vi.fn().mockResolvedValue({ rev: null }),
    dropboxMetadata: vi.fn().mockResolvedValue({ rev: null }),
    oneDriveDownload: vi.fn().mockResolvedValue({ data: APP_DATA, eTag: 'etag-1' }),
    oneDriveUpload: vi.fn().mockResolvedValue({ eTag: 'etag-2' }),
    oneDriveMetadata: vi.fn().mockResolvedValue({ eTag: 'etag-3' }),
    syncWebdavAttachments: vi.fn().mockResolvedValue(null),
    syncCloudAttachments: vi.fn().mockResolvedValue(null),
    syncDropboxAttachments: vi.fn().mockResolvedValue(null),
    syncFileAttachments: vi.fn().mockResolvedValue(null),
    syncCloudKitAttachments: vi.fn().mockResolvedValue(null),
});

const makeContext = (): SyncBackendContext => ({
    backend: 'cloud',
    cloudProvider: 'onedrive',
    oneDriveClientId: 'microsoft-client-id',
    oneDriveETag: null,
    dropboxRev: null,
});

describe('OneDrive sync backend adapter', () => {
    it('uses eTags for cached fingerprints and conditional writes', async () => {
        const context = makeContext();
        const transport = makeTransport();
        const io = createSyncBackendIO(context, transport);

        await expect(io.readRemote()).resolves.toBe(APP_DATA);
        expect(context.syncUrl).toBe('onedrive:///Apps/Attention Planner/data.json');
        expect(io.getCachedRemoteFingerprint?.()).toBe('onedrive:v1:etag=etag-1');

        await io.writeRemote(APP_DATA);
        expect(transport.oneDriveUpload).toHaveBeenCalledWith(APP_DATA, 'etag-1');
        expect(io.getCachedRemoteFingerprint?.()).toBe('onedrive:v1:etag=etag-2');

        await expect(io.readRemoteFingerprint?.()).resolves.toBe('onedrive:v1:etag=etag-3');
    });

    it('rejects missing app registration before making a network request', async () => {
        const context = { ...makeContext(), oneDriveClientId: '' };
        const transport = makeTransport();
        const io = createSyncBackendIO(context, transport);

        await expect(io.readRemote()).rejects.toThrow('Microsoft Entra application client ID is not configured');
        expect(transport.oneDriveDownload).not.toHaveBeenCalled();
    });
});
