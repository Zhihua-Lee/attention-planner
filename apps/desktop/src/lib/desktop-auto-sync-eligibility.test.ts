import { describe, expect, it, vi } from 'vitest';
import { canDesktopAutoSync } from './desktop-auto-sync-eligibility';

const createSyncService = (overrides: Partial<Parameters<typeof canDesktopAutoSync>[0]> = {}) => ({
    getSyncBackend: vi.fn(async () => 'off' as const),
    getSyncPath: vi.fn(async () => ''),
    getWebDavConfig: vi.fn(async () => ({ url: '' })),
    getCloudConfig: vi.fn(async () => ({ url: '' })),
    getCloudProvider: vi.fn(async () => 'selfhosted' as const),
    getDropboxAppKey: vi.fn(async () => ''),
    isDropboxConnected: vi.fn(async () => false),
    getOneDriveConfig: vi.fn(() => ({ clientId: '' })),
    getOneDriveConnection: vi.fn(async () => ({ connected: false })),
    getGoogleDriveConfig: vi.fn(() => ({ clientId: '' })),
    getGoogleDriveConnection: vi.fn(async () => ({ connected: false })),
    ...overrides,
});

describe('canDesktopAutoSync', () => {
    it('allows CloudKit autosync on desktop when the backend is enabled', async () => {
        const syncService = createSyncService({
            getSyncBackend: vi.fn(async () => 'cloudkit' as const),
        });

        await expect(canDesktopAutoSync(syncService)).resolves.toBe(true);
        expect(syncService.getSyncPath).not.toHaveBeenCalled();
        expect(syncService.getWebDavConfig).not.toHaveBeenCalled();
        expect(syncService.getCloudConfig).not.toHaveBeenCalled();
        expect(syncService.getDropboxAppKey).not.toHaveBeenCalled();
        expect(syncService.isDropboxConnected).not.toHaveBeenCalled();
    });

    it('allows self-hosted cloud autosync when the URL is configured', async () => {
        const syncService = createSyncService({
            getSyncBackend: vi.fn(async () => 'cloud' as const),
            getCloudProvider: vi.fn(async () => 'selfhosted' as const),
            getCloudConfig: vi.fn(async () => ({ url: 'https://sync.example.com' })),
        });

        await expect(canDesktopAutoSync(syncService)).resolves.toBe(true);
        expect(syncService.getCloudConfig).toHaveBeenCalledTimes(1);
        expect(syncService.isDropboxConnected).not.toHaveBeenCalled();
    });

    it('allows Dropbox autosync when an app key is configured and connected', async () => {
        const syncService = createSyncService({
            getSyncBackend: vi.fn(async () => 'cloud' as const),
            getCloudProvider: vi.fn(async () => 'dropbox' as const),
            getDropboxAppKey: vi.fn(async () => 'dropbox-app-key'),
            isDropboxConnected: vi.fn(async () => true),
        });

        await expect(canDesktopAutoSync(syncService)).resolves.toBe(true);
        expect(syncService.getDropboxAppKey).toHaveBeenCalledTimes(1);
        expect(syncService.isDropboxConnected).toHaveBeenCalledWith('dropbox-app-key');
        expect(syncService.getCloudConfig).not.toHaveBeenCalled();
    });

    it('disables Dropbox autosync when the app key is missing or disconnected', async () => {
        const missingKeyService = createSyncService({
            getSyncBackend: vi.fn(async () => 'cloud' as const),
            getCloudProvider: vi.fn(async () => 'dropbox' as const),
            getDropboxAppKey: vi.fn(async () => '   '),
        });
        const disconnectedService = createSyncService({
            getSyncBackend: vi.fn(async () => 'cloud' as const),
            getCloudProvider: vi.fn(async () => 'dropbox' as const),
            getDropboxAppKey: vi.fn(async () => 'dropbox-app-key'),
            isDropboxConnected: vi.fn(async () => false),
        });

        await expect(canDesktopAutoSync(missingKeyService)).resolves.toBe(false);
        await expect(canDesktopAutoSync(disconnectedService)).resolves.toBe(false);
        expect(disconnectedService.isDropboxConnected).toHaveBeenCalledWith('dropbox-app-key');
    });

    it('allows OneDrive autosync only when a client ID is configured and the personal account is connected', async () => {
        const connectedService = createSyncService({
            getSyncBackend: vi.fn(async () => 'cloud' as const),
            getCloudProvider: vi.fn(async () => 'onedrive' as const),
            getOneDriveConfig: vi.fn(() => ({ clientId: 'microsoft-client-id' })),
            getOneDriveConnection: vi.fn(async () => ({ connected: true })),
        });

        await expect(canDesktopAutoSync(connectedService)).resolves.toBe(true);
        expect(connectedService.getCloudConfig).not.toHaveBeenCalled();
        expect(connectedService.getOneDriveConnection).toHaveBeenCalledTimes(1);
    });

    it('allows Google Drive autosync only while its short-lived browser session is connected', async () => {
        const connectedService = createSyncService({
            getSyncBackend: vi.fn(async () => 'cloud' as const),
            getCloudProvider: vi.fn(async () => 'google-drive' as const),
            getGoogleDriveConfig: vi.fn(() => ({ clientId: 'google-client-id' })),
            getGoogleDriveConnection: vi.fn(async () => ({ connected: true })),
        });

        await expect(canDesktopAutoSync(connectedService)).resolves.toBe(true);
        expect(connectedService.getCloudConfig).not.toHaveBeenCalled();
        expect(connectedService.getGoogleDriveConnection).toHaveBeenCalledTimes(1);
    });
});
