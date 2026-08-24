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
    googleDriveDownload: vi.fn().mockResolvedValue({ data: APP_DATA, revision: '7' }),
    googleDriveUpload: vi.fn().mockResolvedValue({ revision: '8' }),
    googleDriveMetadata: vi.fn().mockResolvedValue({ revision: '9' }),
    syncWebdavAttachments: vi.fn().mockResolvedValue(null),
    syncCloudAttachments: vi.fn().mockResolvedValue(null),
    syncDropboxAttachments: vi.fn().mockResolvedValue(null),
    syncFileAttachments: vi.fn().mockResolvedValue(null),
    syncCloudKitAttachments: vi.fn().mockResolvedValue(null),
});

const makeContext = (): SyncBackendContext => ({
    backend: 'cloud',
    cloudProvider: 'google-drive',
    googleDriveClientId: 'google-client-id',
    googleDriveRevision: null,
    dropboxRev: null,
});

describe('Google Drive sync backend adapter', () => {
    it('uses Drive versions for fingerprints and guarded writes', async () => {
        const context = makeContext();
        const transport = makeTransport();
        const io = createSyncBackendIO(context, transport);

        await expect(io.readRemote()).resolves.toBe(APP_DATA);
        expect(context.syncUrl).toBe('google-drive:///appDataFolder/data.json');
        expect(io.getCachedRemoteFingerprint?.()).toBe('google-drive:v1:version=7');

        await io.writeRemote(APP_DATA);
        expect(transport.googleDriveUpload).toHaveBeenCalledWith(APP_DATA, '7');
        expect(io.getCachedRemoteFingerprint?.()).toBe('google-drive:v1:version=8');

        await expect(io.readRemoteFingerprint?.()).resolves.toBe('google-drive:v1:version=9');
    });

    it('rejects a missing OAuth client ID before making a Drive request', async () => {
        const context = { ...makeContext(), googleDriveClientId: '' };
        const transport = makeTransport();
        const io = createSyncBackendIO(context, transport);

        await expect(io.readRemote()).rejects.toThrow('Google OAuth web client ID is not configured');
        expect(transport.googleDriveDownload).not.toHaveBeenCalled();
    });
});
