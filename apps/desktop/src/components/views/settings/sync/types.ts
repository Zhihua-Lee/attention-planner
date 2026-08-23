import type { AppSettings, SettingsSyncPreferences, SyncBackend } from '@mindwtr/core';

export type SettingsSyncLabels = {
    dataTransfer: string;
    dataTransferDesc: string;
    exportBackup: string;
    exportBackupDesc: string;
    restoreBackup: string;
    restoreBackupDesc: string;
    importTodoist: string;
    importTodoistDesc: string;
    importTickTick: string;
    importTickTickDesc: string;
    importDgt: string;
    importDgtDesc: string;
    importOmniFocus: string;
    importOmniFocusDesc: string;
    diagnostics: string;
    diagnosticsDesc: string;
    analyticsHeartbeat: string;
    analyticsHeartbeatDesc: string;
    analyticsHeartbeatDisableTitle: string;
    analyticsHeartbeatDisableDesc: string;
    analyticsHeartbeatDisableConfirm: string;
    analyticsHeartbeatKeepEnabled: string;
    debugLogging: string;
    debugLoggingDesc: string;
    logFile: string;
    clearLog: string;
    sync: string;
    syncDescription: string;
    syncBackend: string;
    syncBackendOff: string;
    syncBackendFile: string;
    syncBackendWebdav: string;
    syncBackendCloud: string;
    syncBackendCloudkit: string;
    syncBackendChoiceHint: string;
    syncBackendGroupCloud: string;
    syncBackendGroupCloudDesc: string;
    syncBackendGroupFile: string;
    syncBackendGroupFileDesc: string;
    syncBackendGroupAdvanced: string;
    syncBackendGroupAdvancedDesc: string;
    syncPreferences: string;
    syncPreferencesDesc: string;
    syncPreferenceAppearance: string;
    syncPreferenceLanguage: string;
    syncPreferenceGtd: string;
    syncPreferenceSavedFilters: string;
    syncPreferenceExternalCalendars: string;
    syncPreferenceAi: string;
    syncPreferenceAiHint: string;
    backgroundSync: string;
    backgroundSyncDesc: string;
    syncFolderLocation: string;
    savePath: string;
    browse: string;
    pathHint: string;
    webdavUrl: string;
    webdavHint: string;
    webdavUsername: string;
    webdavPassword: string;
    webdavSave: string;
    testConnection: string;
    webdavTestHint: string;
    webdavTestAccessibility: string;
    allowInsecureHttp: string;
    allowInsecureHttpHint: string;
    cloudUrl: string;
    cloudHint: string;
    cloudToken: string;
    cloudRememberToken: string;
    cloudRememberTokenHint: string;
    cloudSave: string;
    cloudProvider: string;
    cloudProviderSelfHosted: string;
    cloudProviderDropbox: string;
    cloudProviderCloudkit: string;
    cloudkitDesc: string;
    dropboxAppKey: string;
    dropboxAppKeyHint: string;
    dropboxRedirectUri: string;
    dropboxStatus: string;
    dropboxConnected: string;
    dropboxNotConnected: string;
    dropboxConnect: string;
    dropboxDisconnect: string;
    dropboxTest: string;
    dropboxTestReachable: string;
    dropboxTestFailed: string;
    syncNow: string;
    syncing: string;
    syncQueued: string;
    lastSync: string;
    lastSyncSuccess: string;
    lastSyncConflict: string;
    lastSyncError: string;
    lastSyncConflicts: string;
    lastSyncSkew: string;
    lastSyncAdjusted: string;
    lastSyncConflictIds: string;
    syncConflictKeptThisDevice: string;
    syncConflictKeptOtherDevice: string;
    syncConflictChanged: string;
    syncConflictDeleteRestore: string;
    syncConflictMore: string;
    syncHistory: string;
    recoverySnapshots: string;
    recoverySnapshotsDesc: string;
    recoverySnapshotsLoading: string;
    recoverySnapshotsEmpty: string;
    recoverySnapshotsRestore: string;
    recoverySnapshotsConfirm: string;
    recoverySnapshotsConfirmTitle: string;
    recoverySnapshotsConfirmCancel: string;
    attachmentsCleanup: string;
    attachmentsCleanupDesc: string;
    attachmentsCleanupLastRun: string;
    attachmentsCleanupNever: string;
    attachmentsCleanupPendingDeletes: string;
    attachmentsCleanupPendingDeletesClear: string;
    attachmentsCleanupPendingDeletesConfirm: string;
    attachmentsCleanupPendingDeletesConfirmTitle: string;
    attachmentsCleanupRun: string;
    attachmentsCleanupRunning: string;
};

export type CloudProvider = 'selfhosted' | 'dropbox' | 'onedrive';
export type DropboxTestState = 'idle' | 'success' | 'error';
export type OneDriveTestState = 'idle' | 'success' | 'error';
export type SyncPreferences = SettingsSyncPreferences;

/**
 * Prop groups, one per section component. `useSyncSettings` and
 * `useSettingsDataPage` return these already named as props, so `SettingsView`
 * spreads them instead of re-listing every member (see SettingsView renderPage).
 */
export type SyncConfigurationProps = {
    isTauri: boolean;
    isMacOS: boolean;
    syncBackend: SyncBackend;
    onSetSyncBackend: (backend: SyncBackend) => void;
    syncPath: string;
    onSyncPathChange: (value: string) => void;
    onSaveSyncPath: () => Promise<void> | void;
    onBrowseSyncPath: () => void;
    webdavUrl: string;
    webdavUsername: string;
    webdavPassword: string;
    webdavHasPassword: boolean;
    webdavAllowInsecureHttp: boolean;
    webdavUrlError: boolean;
    isSavingWebDav: boolean;
    isTestingWebDav: boolean;
    webdavTestState: 'idle' | 'success' | 'error';
    onWebdavUrlChange: (value: string) => void;
    onWebdavUsernameChange: (value: string) => void;
    onWebdavPasswordChange: (value: string) => void;
    onWebdavAllowInsecureHttpChange: (value: boolean) => void;
    onSaveWebDav: () => Promise<void> | void;
    onTestWebDavConnection: () => Promise<void> | void;
    cloudUrl: string;
    cloudUrlError: boolean;
    cloudToken: string;
    cloudRememberToken: boolean;
    cloudAllowInsecureHttp: boolean;
    cloudProvider: CloudProvider;
    dropboxConfigured: boolean;
    dropboxConnected: boolean;
    dropboxBusy: boolean;
    dropboxAuthInProgress: boolean;
    dropboxRedirectUri: string;
    dropboxTestState: DropboxTestState;
    oneDriveAccountName: string | null;
    oneDriveBusy: boolean;
    oneDriveClientId: string;
    oneDriveConnected: boolean;
    oneDriveRedirectUri: string;
    oneDriveTenantId: string;
    oneDriveTestState: OneDriveTestState;
    onCloudUrlChange: (value: string) => void;
    onCloudTokenChange: (value: string) => void;
    onCloudRememberTokenChange: (value: boolean) => void;
    onCloudAllowInsecureHttpChange: (value: boolean) => void;
    onCloudProviderChange: (provider: CloudProvider) => void;
    onSaveCloud: () => Promise<void> | void;
    onConnectDropbox: () => Promise<void> | void;
    onDisconnectDropbox: () => Promise<void> | void;
    onTestDropboxConnection: () => Promise<void> | void;
    onOneDriveClientIdChange: (value: string) => void;
    onOneDriveTenantIdChange: (value: string) => void;
    onSaveOneDrive: () => Promise<void> | void;
    onConnectOneDrive: () => Promise<void> | void;
    onDisconnectOneDrive: () => Promise<void> | void;
    onTestOneDriveConnection: () => Promise<void> | void;
};

export type SyncStatusProps = {
    isSyncTargetValid: boolean;
    syncPreferences: AppSettings['syncPreferences'] | undefined;
    onUpdateSyncPreferences: (updates: Partial<SyncPreferences>) => Promise<void> | void;
    onSyncNow: () => Promise<void> | void;
    isSyncing: boolean;
    syncQueued: boolean;
    syncLastResult: 'success' | 'error' | null;
    syncLastResultAt: string | null;
    syncError: string | null;
    lastSyncDisplay: string;
    lastSyncStatus: AppSettings['lastSyncStatus'];
    lastSyncStats: AppSettings['lastSyncStats'] | null;
    lastSyncHistory: AppSettings['lastSyncHistory'] | null;
    conflictCount: number;
    lastSyncError?: string;
    snapshots: string[];
    isLoadingSnapshots: boolean;
    isRestoringSnapshot: boolean;
    onRestoreSnapshot: (snapshotFileName: string) => Promise<boolean | void> | boolean | void;
};

export type SettingsDiagnosticsProps = {
    loggingEnabled: boolean;
    analyticsHeartbeatAvailable: boolean;
    analyticsHeartbeatEnabled: boolean;
    logPath: string;
    onToggleLogging: () => void;
    onAnalyticsHeartbeatChange: (enabled: boolean) => Promise<void> | void;
    onClearLog: () => void;
};

export type SettingsDataTransferProps = {
    transferAction: null | 'export' | 'restore' | 'import';
    onExportBackup: () => Promise<void> | void;
    onRestoreBackup: () => Promise<void> | void;
    onImportTodoist: () => Promise<void> | void;
    onImportTickTick: () => Promise<void> | void;
    onImportDgt: () => Promise<void> | void;
    onImportOmniFocus: () => Promise<void> | void;
};

export type SettingsAttachmentsProps = {
    attachmentsLastCleanupDisplay: string;
    pendingRemoteDeleteCount: number;
    onClearPendingRemoteDeletes: () => Promise<void> | void;
    onRunAttachmentsCleanup: () => Promise<void> | void;
    isCleaningAttachments: boolean;
};

export type SettingsSyncPageProps = { t: SettingsSyncLabels }
    & SyncConfigurationProps
    & SyncStatusProps;

export type SettingsDataPageProps = { t: SettingsSyncLabels; isTauri: boolean }
    & SettingsDiagnosticsProps
    & SettingsDataTransferProps
    & SettingsAttachmentsProps
    & { onAddGettingStartedContent: () => Promise<void> | void };
