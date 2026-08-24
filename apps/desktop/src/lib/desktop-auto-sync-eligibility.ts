import { canAutoSync, type SyncBackend } from '@mindwtr/core';
import type { CloudProvider } from './sync-service';

type SyncServiceLike = {
    getSyncBackend: () => Promise<SyncBackend>;
    getSyncPath: () => Promise<string>;
    getWebDavConfig: () => Promise<{ url: string }>;
    getCloudConfig: () => Promise<{ url: string }>;
    getCloudProvider: () => Promise<CloudProvider>;
    getDropboxAppKey: () => Promise<string>;
    isDropboxConnected: (clientId: string) => Promise<boolean>;
    getOneDriveConfig?: () => { clientId: string };
    getOneDriveConnection?: () => Promise<{ connected: boolean }>;
    getGoogleDriveConfig?: () => { clientId: string };
    getGoogleDriveConnection?: () => Promise<{ connected: boolean }>;
};

export async function canDesktopAutoSync(syncService: SyncServiceLike): Promise<boolean> {
    const backend = await syncService.getSyncBackend();
    const filePath = backend === 'file' ? await syncService.getSyncPath() : undefined;
    const webdavUrl = backend === 'webdav' ? (await syncService.getWebDavConfig()).url : undefined;
    const cloudProvider = backend === 'cloud' ? await syncService.getCloudProvider() : undefined;
    const dropboxAppKey = backend === 'cloud' && cloudProvider === 'dropbox'
        ? (await syncService.getDropboxAppKey()).trim()
        : undefined;
    const isDropboxConnected = backend === 'cloud' && cloudProvider === 'dropbox' && dropboxAppKey
        ? await syncService.isDropboxConnected(dropboxAppKey)
        : undefined;
    const cloudUrl = backend === 'cloud' && cloudProvider !== 'dropbox'
        && cloudProvider !== 'onedrive'
        && cloudProvider !== 'google-drive'
        ? (await syncService.getCloudConfig()).url
        : undefined;
    const oneDriveClientId = backend === 'cloud' && cloudProvider === 'onedrive' && syncService.getOneDriveConfig
        ? syncService.getOneDriveConfig().clientId.trim()
        : undefined;
    const isOneDriveConnected = backend === 'cloud' && cloudProvider === 'onedrive' && oneDriveClientId && syncService.getOneDriveConnection
        ? (await syncService.getOneDriveConnection()).connected
        : undefined;
    const googleDriveClientId = backend === 'cloud' && cloudProvider === 'google-drive' && syncService.getGoogleDriveConfig
        ? syncService.getGoogleDriveConfig().clientId.trim()
        : undefined;
    const isGoogleDriveConnected = backend === 'cloud' && cloudProvider === 'google-drive' && googleDriveClientId && syncService.getGoogleDriveConnection
        ? (await syncService.getGoogleDriveConnection()).connected
        : undefined;

    return canAutoSync({
        backend,
        filePath,
        webdavUrl,
        cloudProvider,
        dropboxAppKey,
        isDropboxConnected,
        oneDriveClientId,
        isOneDriveConnected,
        googleDriveClientId,
        isGoogleDriveConnected,
        cloudUrl,
    });
}
