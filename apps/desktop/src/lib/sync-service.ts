
import {
    AppData,
    AppSettings,
    Attachment,
    useTaskStore,
    MergeStats,
    webdavGetJson,
    webdavHeadFile,
    webdavPutJson,
    cloudGetJson,
    cloudHeadJson,
    cloudPutJson,
    flushPendingSave,
    performSyncCycle,
    normalizeAppData,
    normalizeWebdavUrl,
    normalizeCloudUrl,
    createSyncBackendIO,
    runSharedSyncCycle,
    sanitizeAppDataForRemote,
    computeStableValueFingerprint,
    computeSyncPayloadFingerprint,
    areSyncPayloadsEqual,
    findDeletedAttachmentsForFileCleanup,
    findOrphanedAttachments,
    injectExternalCalendars as injectExternalCalendarsForSync,
    persistExternalCalendars as persistExternalCalendarsForSync,
    summarizeMergeStats,
    withTimeout,
    withRetry,
    isRetryableError,
    isRetryableWebdavReadError,
    appendSyncHistory,
    createSyncOrchestrator,
    formatSyncErrorMessage,
    getInMemoryAppDataSnapshot,
    createAbortableFetch,
    ensureFreshLocalSyncSnapshot,
    getTranslationsSync,
    isSupportedLanguage,
    LEGACY_SYNC_FILE_NAME,
    SYNC_FILE_NAME,
    type CloudJsonWriteResult,
    type CloudProvider,
    type RemoteJsonWriteResult,
    type SyncBackendContext,
    type SyncBackendIO,
    SyncRemoteWriteConflict,
    type SyncPayloadTraceEvent,
    type SyncRunCycleSetup,
    type SyncRunResult,
    type SyncTransport,
} from '@mindwtr/core';
import { isTauriRuntime } from './runtime';
import { getTauriHttpFetch } from './tauri-http';
import { reportError } from './report-error';
import { logInfo, logSyncError, logWarn, sanitizeLogMessage } from './app-log';
import { useUiStore } from '../store/ui-store';
import { markLocalSqliteWrite, markLocalWrite } from './local-data-watcher';
import { ExternalCalendarService } from './external-calendar-service';
import { webStorage } from './storage-adapter-web';
import {
    cleanupAttachmentTempFiles,
    cleanupOrphanedAttachments,
    type AttachmentCleanupDeps,
} from './sync-attachment-cleanup';
import {
    clearAttachmentSyncState,
    type AttachmentBackendDeps,
    type CloudConfig,
    syncCloudAttachments,
    syncCloudKitAttachments,
    syncDropboxAttachments,
    syncFileAttachments,
    syncWebdavAttachments as syncAttachments,
    type WebDavConfig,
} from './sync-attachment-backends';
import {
    ensureCloudKitReady,
    readRemoteCloudKit,
    writeRemoteCloudKit,
} from './cloudkit-sync';
import {
    getBaseSyncUrl,
    getCloudBaseUrl,
} from './sync-attachments';
import {
    getFileSyncDir,
    hashString,
    isSyncFilePath,
    normalizeSyncBackend,
    toStableJson,
    yieldToRenderer,
} from './sync-service-utils';
import {
    clearAttachmentValidationFailures,
    getAttachmentValidationFailureAttempts,
    handleAttachmentValidationFailure,
} from './sync-attachment-validation';
import type { SyncBackend } from './sync-service-utils';
import {
    downloadDropboxAppData,
    DropboxUnauthorizedError,
    getDropboxAppDataMetadata,
    testDropboxAccess,
    uploadDropboxAppData,
} from './dropbox-sync';
import {
    connectOneDrive,
    disconnectOneDrive,
    downloadOneDriveAppData,
    getOneDriveAppDataMetadata,
    getOneDriveConnection,
    getOneDriveRedirectUri,
    getOneDriveSyncConfig,
    OneDriveConflictError,
    setOneDriveSyncConfig,
    testOneDriveConnection,
    uploadOneDriveAppData,
    type OneDriveConnection,
    type OneDriveSyncConfig,
} from './onedrive-sync';
import {
    connectGoogleDrive,
    disconnectGoogleDrive,
    downloadGoogleDriveAppData,
    getGoogleDriveAppDataMetadata,
    getGoogleDriveConnection,
    getGoogleDriveSyncConfig,
    GoogleDriveConflictError,
    isGoogleDriveBrokerManaged,
    setGoogleDriveSyncConfig,
    testGoogleDriveConnection,
    uploadGoogleDriveAppData,
    type GoogleDriveConnection,
    type GoogleDriveSyncConfig,
} from './google-drive-sync';
import {
    CLOUD_REMEMBER_TOKEN_KEY,
    CLOUD_TOKEN_KEY,
    CLOUD_URL_KEY,
    SYNC_BACKEND_KEY,
    WEBDAV_PASSWORD_KEY,
    WEBDAV_URL_KEY,
    WEBDAV_USERNAME_KEY,
    getCloudConfigLocal,
    getSyncBackendLocal,
    getWebDavConfigLocal,
    readCloudConfig,
    readCloudProvider,
    readDropboxAppKey,
    readSyncBackend,
    readSyncPath,
    readWebDavConfig,
    writeCloudConfig,
    writeCloudProvider,
    writeDropboxAppKey,
    writeSyncBackend,
    writeSyncPath,
    writeWebDavConfig,
} from './sync-service-config';
import {
    buildFastSyncScope,
    clearLocalSyncStatus,
    clearFastSyncState,
    readLocalSyncStatus,
    readFastSyncState,
    writeLocalSyncStatus,
    writeFastSyncState,
} from './sync-service-fast-sync';

export type ExternalSyncChangeResolution = 'keep-local' | 'use-external' | 'merge';
export type { CloudProvider };

export type ExternalSyncChange = {
    at: string;
    incomingHash: string;
    syncPath: string;
    hasLocalChanges: boolean;
    localChangeAt: number;
    lastSyncAt?: string;
};

const DROPBOX_TRANSIENT_RETRY_OPTIONS = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 8000, shouldRetry: isRetryableError };
const WEBDAV_READ_RETRY_OPTIONS = {
    maxAttempts: 5,
    baseDelayMs: 2000,
    maxDelayMs: 30_000,
    shouldRetry: isRetryableWebdavReadError,
};
const ATTACHMENT_WARNING_TOAST_THRESHOLD = 2;
const ATTACHMENT_WARNING_TOAST_COOLDOWN_MS = 10 * 60 * 1000;
type SyncServiceDependencies = {
    isTauriRuntime: () => boolean;
    invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    getTauriFetch: () => Promise<typeof fetch | undefined>;
    getStoreState: typeof useTaskStore.getState;
    applySyncedDataToStore: (data: AppData) => void;
    flushPendingSave: typeof flushPendingSave;
    performSyncCycle: typeof performSyncCycle;
    getInMemoryAppDataSnapshot: typeof getInMemoryAppDataSnapshot;
    markLocalWrite: typeof markLocalWrite;
    markLocalSqliteWrite: typeof markLocalSqliteWrite;
    reportError: typeof reportError;
    logInfo: typeof logInfo;
    logWarn: typeof logWarn;
    logSyncError: typeof logSyncError;
    sanitizeLogMessage: typeof sanitizeLogMessage;
    getExternalCalendars: typeof ExternalCalendarService.getCalendars;
    setExternalCalendars: typeof ExternalCalendarService.setCalendars;
    ensureCloudKitReady: typeof ensureCloudKitReady;
    readRemoteCloudKit: typeof readRemoteCloudKit;
    writeRemoteCloudKit: typeof writeRemoteCloudKit;
};

const defaultInvoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const mod = await import('@tauri-apps/api/core');
    return mod.invoke<T>(command as any, args as any);
};

const defaultGetTauriFetch = async (): Promise<typeof fetch | undefined> => {
    if (!syncServiceDependencies.isTauriRuntime()) return undefined;
    try {
        return await getTauriHttpFetch();
    } catch (error) {
        logSyncWarning('Failed to load tauri http fetch', error);
        return undefined;
    }
};

const applySyncedDataToStore = (data: AppData): void => {
    const normalized = normalizeAppData(data);
    const allTasks = Array.isArray(normalized.tasks) ? normalized.tasks : [];
    const allProjects = Array.isArray(normalized.projects) ? normalized.projects : [];
    const allSections = Array.isArray(normalized.sections) ? normalized.sections : [];
    const allAreas = Array.isArray(normalized.areas) ? normalized.areas : [];
    const allPeople = Array.isArray(normalized.people) ? normalized.people : [];

    useTaskStore.setState((state) => ({
        _allTasks: allTasks,
        _allProjects: allProjects,
        _allSections: allSections,
        _allAreas: allAreas,
        _allPeople: allPeople,
        settings: normalized.settings ?? state.settings,
    }));
};

const defaultSyncServiceDependencies: SyncServiceDependencies = {
    isTauriRuntime,
    invoke: defaultInvoke,
    getTauriFetch: defaultGetTauriFetch,
    getStoreState: useTaskStore.getState,
    applySyncedDataToStore,
    flushPendingSave,
    performSyncCycle,
    getInMemoryAppDataSnapshot,
    markLocalWrite,
    markLocalSqliteWrite,
    reportError,
    logInfo,
    logWarn,
    logSyncError,
    sanitizeLogMessage,
    getExternalCalendars: () => ExternalCalendarService.getCalendars(),
    setExternalCalendars: (calendars) => ExternalCalendarService.setCalendars(calendars),
    ensureCloudKitReady,
    readRemoteCloudKit,
    writeRemoteCloudKit,
};

let syncServiceDependencies: SyncServiceDependencies = {
    ...defaultSyncServiceDependencies,
};

const isTauriRuntimeEnv = () => syncServiceDependencies.isTauriRuntime();
const getStoreState = () => syncServiceDependencies.getStoreState();
const fallbackSyncTranslations = getTranslationsSync('en');

const resolveSyncText = (key: string, fallback: string): string => {
    const language = getStoreState().settings?.language;
    const translations = language && isSupportedLanguage(language)
        ? getTranslationsSync(language)
        : fallbackSyncTranslations;
    return translations[key] || fallbackSyncTranslations[key] || fallback;
};

const logSyncWarning = (message: string, error?: unknown) => {
    const extra = error
        ? { error: syncServiceDependencies.sanitizeLogMessage(error instanceof Error ? error.message : String(error)) }
        : undefined;
    void syncServiceDependencies.logWarn(message, { scope: 'sync', extra });
};

const logSyncInfo = (message: string, extra?: Record<string, string>) => {
    void syncServiceDependencies.logInfo(message, { scope: 'sync', extra });
};

const isSyncPayloadTraceEnabled = (): boolean => (
    getStoreState().settings?.diagnostics?.loggingEnabled === true
);

const SYNC_TRACE_SURFACES = ['tasks', 'projects', 'sections', 'areas', 'people', 'settings'] as const;
type SyncTraceSurface = typeof SYNC_TRACE_SURFACES[number];

const capitalizeTraceName = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const getSyncTraceSurfaceValue = (data: AppData, surface: SyncTraceSurface): unknown => {
    if (surface === 'settings') return data.settings ?? {};
    const value = data[surface];
    return Array.isArray(value) ? value : [];
};

const buildSyncPayloadSurfaceTraceExtra = (
    data: AppData,
    prefix = '',
): Record<string, string> => {
    const sanitized = sanitizeAppDataForRemote(data);
    return Object.fromEntries(
        SYNC_TRACE_SURFACES.map((surface) => {
            const name = `${prefix}${prefix ? capitalizeTraceName(surface) : surface}Sig`;
            return [name, computeStableValueFingerprint(getSyncTraceSurfaceValue(sanitized, surface))];
        }),
    );
};

const buildSyncPayloadTraceExtra = (
    data: AppData | null | undefined,
    extra: Record<string, string> = {},
): Record<string, string> => {
    if (!data) {
        return { ...extra, hasData: 'false' };
    }

    const areas = Array.isArray(data.areas) ? data.areas : [];
    const areaIds = areas
        .map((area) => `${area.id}${area.deletedAt ? ':deleted' : ''}`)
        .sort();
    return {
        ...extra,
        hasData: 'true',
        tasks: String(Array.isArray(data.tasks) ? data.tasks.length : 0),
        projects: String(Array.isArray(data.projects) ? data.projects.length : 0),
        sections: String(Array.isArray(data.sections) ? data.sections.length : 0),
        areas: String(areas.length),
        deletedAreas: String(areas.filter((area) => Boolean(area.deletedAt)).length),
        areaIdsSample: areaIds.slice(0, 24).join(','),
        areaIdsTruncated: String(areaIds.length > 24),
        pendingRemoteWrite: String(Boolean(data.settings?.pendingRemoteWriteAt)),
        fingerprint: computeSyncPayloadFingerprint(data),
        ...buildSyncPayloadSurfaceTraceExtra(data),
    };
};

const logSyncPayloadTrace = (
    message: string,
    data: AppData | null | undefined,
    extra?: Record<string, string>,
): void => {
    if (!isSyncPayloadTraceEnabled()) return;
    logSyncInfo(message, buildSyncPayloadTraceExtra(data, extra));
};

const MAX_TRACE_DIFF_ITEMS = 12;
const MAX_TRACE_DIFF_FIELDS = 16;

const isPlainTraceRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const sanitizeTraceFieldPath = (path: string): string => (
    /(password|token|secret|authorization|api[-_.]?key)/i.test(path) ? '[sensitive]' : path
);

const collectChangedTracePaths = (
    left: unknown,
    right: unknown,
    prefix = '',
    depth = 0,
): string[] => {
    if (toStableJson(left) === toStableJson(right)) return [];
    if (depth >= 3 || !isPlainTraceRecord(left) || !isPlainTraceRecord(right)) {
        return [sanitizeTraceFieldPath(prefix || '<root>')];
    }
    const names = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();
    return names.flatMap((name) => {
        const nextPath = prefix ? `${prefix}.${name}` : name;
        return collectChangedTracePaths(left[name], right[name], nextPath, depth + 1);
    });
};

const getTraceRecordId = (item: Record<string, unknown>, index: number): string => {
    const id = typeof item.id === 'string' && item.id.trim().length > 0 ? item.id : `index-${index}`;
    return id.length > 80 ? `${id.slice(0, 80)}...` : id;
};

const buildCollectionDiffTraceSample = (left: unknown, right: unknown): string => {
    const leftItems = Array.isArray(left) ? left.filter(isPlainTraceRecord) : [];
    const rightItems = Array.isArray(right) ? right.filter(isPlainTraceRecord) : [];
    const leftById = new Map(leftItems.map((item, index) => [getTraceRecordId(item, index), item] as const));
    const rightById = new Map(rightItems.map((item, index) => [getTraceRecordId(item, index), item] as const));
    const ids = Array.from(new Set([...leftById.keys(), ...rightById.keys()])).sort();
    const parts: string[] = [];

    for (const id of ids) {
        const leftItem = leftById.get(id);
        const rightItem = rightById.get(id);
        if (!leftItem) {
            parts.push(`${id}:onlySynced:${computeStableValueFingerprint(rightItem)}`);
        } else if (!rightItem) {
            parts.push(`${id}:onlyCurrent:${computeStableValueFingerprint(leftItem)}`);
        } else if (toStableJson(leftItem) !== toStableJson(rightItem)) {
            const fields = collectChangedTracePaths(leftItem, rightItem)
                .slice(0, MAX_TRACE_DIFF_FIELDS)
                .join('|');
            parts.push(`${id}:fields=${fields};current=${computeStableValueFingerprint(leftItem)};synced=${computeStableValueFingerprint(rightItem)}`);
        }
        if (parts.length >= MAX_TRACE_DIFF_ITEMS) break;
    }

    return parts.join(';');
};

const buildSyncPayloadDiffTraceExtra = (currentData: AppData, syncedData: AppData): Record<string, string> => {
    const current = sanitizeAppDataForRemote(currentData);
    const synced = sanitizeAppDataForRemote(syncedData);
    const changedSurfaces = SYNC_TRACE_SURFACES.filter((surface) => (
        toStableJson(getSyncTraceSurfaceValue(current, surface)) !== toStableJson(getSyncTraceSurfaceValue(synced, surface))
    ));
    const extra: Record<string, string> = {
        surfaceDiffs: changedSurfaces.join(',') || 'none',
        ...Object.fromEntries(SYNC_TRACE_SURFACES.map((surface) => [
            `${surface}Changed`,
            String(changedSurfaces.includes(surface)),
        ])),
        ...buildSyncPayloadSurfaceTraceExtra(current, 'current'),
        ...buildSyncPayloadSurfaceTraceExtra(synced, 'synced'),
    };

    for (const surface of SYNC_TRACE_SURFACES) {
        if (!changedSurfaces.includes(surface)) continue;
        const currentSurface = getSyncTraceSurfaceValue(current, surface);
        const syncedSurface = getSyncTraceSurfaceValue(synced, surface);
        if (surface === 'settings') {
            extra.settingsPaths = collectChangedTracePaths(currentSurface, syncedSurface)
                .slice(0, MAX_TRACE_DIFF_FIELDS)
                .join(',');
            continue;
        }
        extra[`${surface}Sample`] = buildCollectionDiffTraceSample(currentSurface, syncedSurface);
    }

    return extra;
};

const externalCalendarProvider = {
    load: () => syncServiceDependencies.getExternalCalendars(),
    save: (calendars: AppSettings['externalCalendars'] | undefined) =>
        syncServiceDependencies.setExternalCalendars(calendars ?? []),
    onWarn: (message: string, error?: unknown) => logSyncWarning(message, error),
};

const injectExternalCalendars = async (data: AppData): Promise<AppData> =>
    injectExternalCalendarsForSync(data, externalCalendarProvider);

const persistExternalCalendars = async (data: AppData): Promise<void> =>
    persistExternalCalendarsForSync(data, externalCalendarProvider);

const mergeLocalSyncStatus = (data: AppData): AppData => {
    const localStatus = readLocalSyncStatus();
    if (!localStatus) return data;
    return normalizeAppData({
        ...data,
        settings: {
            ...(data.settings ?? {}),
            ...localStatus,
        },
    });
};

// Sync should start from persisted data so startup sync cannot overwrite settings with an unhydrated store snapshot.
const readLocalDataForSync = async (): Promise<AppData> => {
    if (isTauriRuntimeEnv()) {
        try {
            const persisted = await tauriInvoke<AppData>('get_data');
            return mergeLocalSyncStatus(normalizeAppData(persisted));
        } catch (error) {
            logSyncWarning('Failed to read persisted local data for sync; using in-memory snapshot', error);
        }
    } else {
        const persisted = await webStorage.getData();
        return normalizeAppData(persisted);
    }

    const state = getStoreState();
    return normalizeAppData({
        tasks: [...state._allTasks],
        projects: [...state._allProjects],
        sections: [...state._allSections],
        areas: [...state._allAreas],
        people: [...state._allPeople],
        settings: state.settings ?? {},
    });
};

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    return syncServiceDependencies.invoke<T>(command, args);
}

async function persistLocalDataForSync(data: AppData): Promise<void> {
    syncServiceDependencies.markLocalWrite(data);
    syncServiceDependencies.markLocalSqliteWrite();
    await tauriInvoke('save_data', { data });
    syncServiceDependencies.markLocalSqliteWrite();
}

async function persistSyncSettings(updates: Partial<AppSettings>): Promise<void> {
    if (isTauriRuntimeEnv()) {
        writeLocalSyncStatus(updates, logSyncWarning);
        useTaskStore.setState((state) => ({
            settings: {
                ...(state.settings ?? {}),
                ...updates,
            },
        }));
        return;
    }
    await getStoreState().updateSettings(updates);
}

const DROPBOX_REDIRECT_URI_FALLBACK = 'http://127.0.0.1:53682/oauth/dropbox/callback';
const DROPBOX_TEST_TIMEOUT_MS = 15_000;

async function getTauriFetch(): Promise<typeof fetch | undefined> {
    return syncServiceDependencies.getTauriFetch();
}

async function resolveWebdavPassword(config: WebDavConfig): Promise<string> {
    if (typeof config.password === 'string') return config.password;
    if (config.hasPassword === false) return '';
    if (!isTauriRuntimeEnv()) return '';
    try {
        return await tauriInvoke<string>('get_webdav_password');
    } catch (error) {
        logSyncWarning('Failed to load WebDAV password', error);
        return '';
    }
}

const attachmentBackendDeps: AttachmentBackendDeps = {
    getTauriFetch,
    isTauriRuntimeEnv,
    logSyncInfo,
    logSyncWarning,
    resolveWebdavPassword,
};

const getAttachmentCleanupDeps = (): AttachmentCleanupDeps => ({
    getCloudConfig: () => SyncService.getCloudConfig(),
    getCloudProvider: () => SyncService.getCloudProvider(),
    getDropboxAccessToken: (clientId, options) => SyncService.getDropboxAccessToken(clientId, options),
    getDropboxAppKey: () => SyncService.getDropboxAppKey(),
    getSyncPath: () => SyncService.getSyncPath(),
    getTauriFetch,
    getWebDavConfig: () => SyncService.getWebDavConfig(),
    isTauriRuntimeEnv,
    logSyncInfo,
    logSyncWarning,
    resolveWebdavPassword,
});

const getSyncConfigDeps = () => ({
    isTauriRuntimeEnv,
    maybeMigrateLegacyLocalStorageToConfig: () => SyncService.maybeMigrateLegacyLocalStorageToConfig(),
    reportError: syncServiceDependencies.reportError,
    startFileWatcher: () => SyncService.startFileWatcher(),
    tauriInvoke,
});

type SyncRunOptions = {
    backendOverride?: SyncBackend;
    /** User-initiated sync: always run the full read/merge cycle, never the
     *  fast-check skip, so a stale cached fingerprint can't hide remote data. */
    manual?: boolean;
};

/** Desktop transport state for one sync cycle. Cycle sequencing/state lives in
 *  the core machine (`runSharedSyncCycle`, ADR 0014); this carries only what
 *  the desktop backend adapters need. */
type DesktopSyncCycleContext = {
    backend: SyncBackend;
    networkWentOffline: boolean;
    removeNetworkListener: (() => void) | null;
    requestAbortController: AbortController;
    webdavConfig: WebDavConfig | null;
    cloudProvider: CloudProvider;
    cloudConfig: CloudConfig | null;
    dropboxAppKey: string;
    cachedDropboxAccessToken: string | null;
    oneDriveClientId: string;
    googleDriveClientId: string;
    syncPath: string;
    fileBaseDir: string;
};

const createDesktopSyncCycleContext = (): DesktopSyncCycleContext => ({
    backend: 'off',
    networkWentOffline: false,
    removeNetworkListener: null,
    requestAbortController: new AbortController(),
    webdavConfig: null,
    cloudProvider: 'selfhosted',
    cloudConfig: null,
    dropboxAppKey: '',
    cachedDropboxAccessToken: null,
    oneDriveClientId: '',
    googleDriveClientId: '',
    syncPath: '',
    fileBaseDir: '',
});

const SYNC_TRACE_EVENT_MESSAGES: Record<SyncPayloadTraceEvent, string> = {
    'read-local': 'Sync trace read local payload',
    'read-remote': 'Sync trace read remote payload',
    'write-local': 'Sync trace write local payload',
    'write-remote': 'Sync trace write remote payload',
    'remote-write-completed': 'Sync trace remote write completed',
    'remote-write-skipped-unchanged': 'Sync trace remote write skipped unchanged payload',
    'core-result': 'Sync trace core result payload',
    'post-attachment': 'Sync trace post-attachment payload',
};

const createFetchWithAbortForContext = async (context: DesktopSyncCycleContext): Promise<typeof fetch> => {
    const baseFetch = (await getTauriFetch()) ?? fetch;
    return createAbortableFetch(baseFetch, { baseSignal: context.requestAbortController.signal });
};

const resolveDropboxAccessTokenForContext = async (
    context: DesktopSyncCycleContext,
    forceRefresh = false
): Promise<string> => {
    if (!context.dropboxAppKey) {
        throw new Error('Dropbox app key is not configured');
    }
    if (!context.cachedDropboxAccessToken || forceRefresh) {
        context.cachedDropboxAccessToken = await SyncService.getDropboxAccessToken(context.dropboxAppKey, { forceRefresh });
    }
    return context.cachedDropboxAccessToken;
};

export class SyncService {
    private static didMigrate = false;
    private static queuedSyncOptions: SyncRunOptions | null = null;
    private static syncStatus: {
        inFlight: boolean;
        queued: boolean;
        step: string | null;
        lastResult: 'success' | 'error' | null;
        lastResultAt: string | null;
    } = {
        inFlight: false,
        queued: false,
        step: null,
        lastResult: null,
        lastResultAt: null,
    };
    private static readonly syncOrchestrator = createSyncOrchestrator<SyncRunOptions, SyncRunResult>({
        runCycle: async (options) => SyncService.runSyncCycle(options),
        onQueueStateChange: (queued) => {
            SyncService.updateSyncStatus({ queued });
        },
        onDrained: () => {
            SyncService.queuedSyncOptions = null;
        },
        onQueuedRunComplete: (queuedResult) => {
            if (!queuedResult.success) {
                logSyncWarning('Queued sync failed', queuedResult.error);
                try {
                    useUiStore.getState().showToast(
                        queuedResult.error || resolveSyncText('settings.queuedSyncFailed', 'Queued sync failed.'),
                        'error',
                        6000,
                    );
                } catch {
                    // UI store may be unavailable during shutdown/tests.
                }
            }
        },
        onQueuedRunError: (error) => {
            logSyncWarning('Queued sync crashed', error);
        },
    });
    private static syncListeners = new Set<(status: typeof SyncService.syncStatus) => void>();
    private static fileWatcherStop: (() => void) | null = null;
    private static fileWatcherPath: string | null = null;
    private static fileWatcherBackend: SyncBackend | null = null;
    private static lastWrittenHash: string | null = null;
    private static lastObservedHash: string | null = null;
    private static lastSuccessfulSyncLocalChangeAt = 0;
    private static ignoreFileEventsUntil = 0;
    private static fileWriteIgnoreActive = false;
    private static externalSyncTimer: ReturnType<typeof setTimeout> | null = null;
    private static pendingExternalSyncChange: ExternalSyncChange | null = null;
    private static externalSyncChangeListeners = new Set<(change: ExternalSyncChange | null) => void>();
    private static consecutiveAttachmentWarningRuns = 0;
    private static lastAttachmentWarningToastAt = 0;

    private static getMonotonicNow(): number {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    private static requestQueuedSyncRun(nextOptions?: SyncRunOptions, preferLatest = true) {
        if (nextOptions && (preferLatest || !SyncService.queuedSyncOptions)) {
            SyncService.queuedSyncOptions = nextOptions;
        }
        const queuedOptions = SyncService.queuedSyncOptions ?? nextOptions;
        logSyncInfo('Sync trace follow-up requested', {
            hasQueuedOptions: String(Boolean(queuedOptions)),
            preferLatest: String(preferLatest),
        });
        if (queuedOptions) {
            SyncService.syncOrchestrator.requestFollowUp(queuedOptions);
            return;
        }
        SyncService.syncOrchestrator.requestFollowUp();
    }

    private static areSyncRunOptionsEquivalent(left?: SyncRunOptions | null, right?: SyncRunOptions | null): boolean {
        return (left?.backendOverride ?? undefined) === (right?.backendOverride ?? undefined);
    }

    /** Covered-snapshot check for the core machine's acceptCoveredSnapshot
     *  hook: a mid-cycle store change is benign when the in-memory payload
     *  already matches what this cycle synced. The machine owns the snapshot
     *  stamp bookkeeping. */
    private static isCoveredLocalSnapshot(expectedData: AppData): boolean {
        const currentChangeAt = getStoreState().lastDataChangeAt;
        const currentData = normalizeAppData(syncServiceDependencies.getInMemoryAppDataSnapshot());
        const syncedData = normalizeAppData(expectedData);
        const currentFingerprint = computeSyncPayloadFingerprint(currentData);
        const syncedFingerprint = computeSyncPayloadFingerprint(syncedData);
        const rawPayloadsEqual = areSyncPayloadsEqual(currentData, syncedData);
        if (currentFingerprint !== syncedFingerprint) {
            logSyncInfo('Sync trace covered local snapshot differs', {
                currentChangeAt: String(currentChangeAt),
                currentFingerprint,
                syncedFingerprint,
                rawPayloadsEqual: String(rawPayloadsEqual),
                ...buildSyncPayloadDiffTraceExtra(currentData, syncedData),
            });
            return false;
        }

        logSyncInfo('Sync trace covered local snapshot accepted', {
            currentChangeAt: String(currentChangeAt),
            currentFingerprint,
            rawPayloadsEqual: String(rawPayloadsEqual),
        });
        return true;
    }

    private static clearCoveredQueuedSyncRun(localSnapshotChangeAt: number, options: SyncRunOptions): void {
        if (!SyncService.syncOrchestrator.getState().queued) return;
        if (!SyncService.areSyncRunOptionsEquivalent(SyncService.queuedSyncOptions, options)) return;
        if (getStoreState().lastDataChangeAt > localSnapshotChangeAt) return;

        SyncService.queuedSyncOptions = null;
        SyncService.syncOrchestrator.clearFollowUp();
    }

    static getSyncStatus() {
        return SyncService.syncStatus;
    }

    static subscribeSyncStatus(listener: (status: typeof SyncService.syncStatus) => void): () => void {
        SyncService.syncListeners.add(listener);
        listener(SyncService.syncStatus);
        return () => SyncService.syncListeners.delete(listener);
    }

    static getPendingExternalSyncChange(): ExternalSyncChange | null {
        return SyncService.pendingExternalSyncChange;
    }

    static subscribeExternalSyncChange(listener: (change: ExternalSyncChange | null) => void): () => void {
        SyncService.externalSyncChangeListeners.add(listener);
        listener(SyncService.pendingExternalSyncChange);
        return () => SyncService.externalSyncChangeListeners.delete(listener);
    }

    private static notifyExternalSyncChange() {
        SyncService.externalSyncChangeListeners.forEach((listener) => listener(SyncService.pendingExternalSyncChange));
    }

    private static setPendingExternalSyncChange(change: ExternalSyncChange | null) {
        SyncService.pendingExternalSyncChange = change;
        SyncService.notifyExternalSyncChange();
    }

    static async resetForTests(): Promise<void> {
        await SyncService.stopFileWatcher();
        SyncService.didMigrate = false;
        SyncService.syncOrchestrator.reset();
        SyncService.queuedSyncOptions = null;
        SyncService.syncStatus = {
            inFlight: false,
            queued: false,
            step: null,
            lastResult: null,
            lastResultAt: null,
        };
        SyncService.syncListeners.clear();
        SyncService.fileWatcherStop = null;
        SyncService.fileWatcherPath = null;
        SyncService.fileWatcherBackend = null;
        SyncService.lastWrittenHash = null;
        SyncService.lastObservedHash = null;
        SyncService.lastSuccessfulSyncLocalChangeAt = 0;
        SyncService.ignoreFileEventsUntil = 0;
        SyncService.fileWriteIgnoreActive = false;
        SyncService.externalSyncTimer = null;
        SyncService.pendingExternalSyncChange = null;
        SyncService.externalSyncChangeListeners.clear();
        SyncService.consecutiveAttachmentWarningRuns = 0;
        SyncService.lastAttachmentWarningToastAt = 0;
        clearFastSyncState();
        clearLocalSyncStatus();
        clearAttachmentSyncState();
        clearAttachmentValidationFailures();
    }

    private static finalizeAttachmentWarningState(context: { hadAttachmentWarning: boolean }, result: Pick<SyncRunResult, 'success'>) {
        if (context.hadAttachmentWarning) {
            SyncService.consecutiveAttachmentWarningRuns += 1;
            if (SyncService.consecutiveAttachmentWarningRuns < ATTACHMENT_WARNING_TOAST_THRESHOLD) {
                return;
            }
            const now = Date.now();
            if (now - SyncService.lastAttachmentWarningToastAt < ATTACHMENT_WARNING_TOAST_COOLDOWN_MS) {
                return;
            }
            SyncService.lastAttachmentWarningToastAt = now;
            try {
                useUiStore.getState().showToast(
                    resolveSyncText(
                        'settings.attachmentSyncRetryWarning',
                        'Attachment sync is still failing. Files will retry in the background.',
                    ),
                    'error',
                    6000,
                );
            } catch {
                // UI store may be unavailable during shutdown/tests.
            }
            return;
        }
        if (result.success) {
            SyncService.consecutiveAttachmentWarningRuns = 0;
        }
    }

    private static updateSyncStatus(partial: Partial<typeof SyncService.syncStatus>) {
        SyncService.syncStatus = { ...SyncService.syncStatus, ...partial };
        SyncService.syncListeners.forEach((listener) => listener(SyncService.syncStatus));
    }

    static async maybeMigrateLegacyLocalStorageToConfig() {
        if (!isTauriRuntimeEnv() || SyncService.didMigrate) return;
        SyncService.didMigrate = true;

        const legacyBackend = getSyncBackendLocal();
        const legacyWebdav = getWebDavConfigLocal();
        const legacyCloud = getCloudConfigLocal();
        const hasLegacyBackend = legacyBackend === 'webdav' || legacyBackend === 'cloud';
        const hasLegacyWebdav = Boolean(legacyWebdav.url);
        const hasLegacyCloud = Boolean(legacyCloud.url || legacyCloud.token);
        if (!hasLegacyBackend && !hasLegacyWebdav && !hasLegacyCloud) return;

        try {
            const [currentBackend, currentWebdav, currentCloud] = await Promise.all([
                tauriInvoke<string>('get_sync_backend'),
                tauriInvoke<WebDavConfig>('get_webdav_config'),
                tauriInvoke<CloudConfig>('get_cloud_config'),
            ]);

            let migrated = false;
            if (hasLegacyBackend && normalizeSyncBackend(currentBackend) === 'file') {
                await tauriInvoke('set_sync_backend', { backend: legacyBackend });
                migrated = true;
            }

            if (hasLegacyWebdav && !currentWebdav.url) {
                await tauriInvoke('set_webdav_config', legacyWebdav);
                migrated = true;
            }

            if (hasLegacyCloud && !currentCloud.url && !currentCloud.token) {
                await tauriInvoke('set_cloud_config', { url: legacyCloud.url, token: legacyCloud.token });
                migrated = true;
            }

            if (migrated) {
                localStorage.removeItem(SYNC_BACKEND_KEY);
                localStorage.removeItem(WEBDAV_URL_KEY);
                localStorage.removeItem(WEBDAV_USERNAME_KEY);
                localStorage.removeItem(WEBDAV_PASSWORD_KEY);
                localStorage.removeItem(CLOUD_URL_KEY);
                localStorage.removeItem(CLOUD_TOKEN_KEY);
                localStorage.removeItem(CLOUD_REMEMBER_TOKEN_KEY);
                sessionStorage.removeItem(WEBDAV_PASSWORD_KEY);
                sessionStorage.removeItem(CLOUD_TOKEN_KEY);
            }
        } catch (error) {
            syncServiceDependencies.reportError('Failed to migrate legacy sync config', error);
        }
    }

    static async getSyncBackend(): Promise<SyncBackend> {
        return readSyncBackend(getSyncConfigDeps());
    }

    static async setSyncBackend(backend: SyncBackend): Promise<void> {
        return writeSyncBackend(backend, getSyncConfigDeps());
    }

    static async getWebDavConfig(options?: { silent?: boolean }): Promise<WebDavConfig> {
        return readWebDavConfig(getSyncConfigDeps(), options);
    }

    static async setWebDavConfig(config: { url: string; username?: string; password?: string; allowInsecureHttp?: boolean; allowWeakFingerprint?: boolean }): Promise<void> {
        return writeWebDavConfig(config, getSyncConfigDeps());
    }

    static async testWebDavConnection(config: { url: string; username?: string; password?: string; hasPassword?: boolean; allowInsecureHttp?: boolean }): Promise<void> {
        const normalizedUrl = normalizeWebdavUrl(config.url.trim());
        if (!normalizedUrl) {
            throw new Error('WebDAV URL not configured');
        }
        const fetcher = await getTauriFetch();
        // The settings form leaves the password field empty after a restart
        // (the secret stays in the keyring, only hasPassword survives). An
        // empty string must mean "unchanged", not "no password", or the test
        // 401s on saved credentials that sync itself uses fine (#899).
        const password = await resolveWebdavPassword({
            url: config.url,
            username: config.username || '',
            password: config.password?.trim() ? config.password : undefined,
            hasPassword: config.hasPassword,
        });
        try {
            await webdavGetJson<unknown>(normalizedUrl, {
                allowInsecureHttp: config.allowInsecureHttp,
                username: config.username?.trim(),
                password,
                timeoutMs: 10_000,
                fetcher: fetcher ?? fetch,
            });
        } catch (error) {
            logSyncWarning('WebDAV connection test failed', error);
            throw error;
        }
    }

    static async getCloudConfig(options?: { silent?: boolean }): Promise<CloudConfig> {
        return readCloudConfig(getSyncConfigDeps(), options);
    }

    static async setCloudConfig(config: { url: string; token?: string; allowInsecureHttp?: boolean; rememberToken?: boolean }): Promise<void> {
        return writeCloudConfig(config, getSyncConfigDeps());
    }

    static async getCloudProvider(): Promise<CloudProvider> {
        return readCloudProvider();
    }

    static async setCloudProvider(provider: CloudProvider): Promise<void> {
        return writeCloudProvider(provider);
    }

    static async getDropboxAppKey(): Promise<string> {
        return readDropboxAppKey();
    }

    static async setDropboxAppKey(value: string): Promise<void> {
        return writeDropboxAppKey(value);
    }

    static async getDropboxRedirectUri(): Promise<string> {
        if (!isTauriRuntimeEnv()) return DROPBOX_REDIRECT_URI_FALLBACK;
        try {
            return await tauriInvoke<string>('get_dropbox_redirect_uri');
        } catch {
            return DROPBOX_REDIRECT_URI_FALLBACK;
        }
    }

    static async isDropboxConnected(clientId: string): Promise<boolean> {
        const normalized = clientId.trim();
        if (!normalized) return false;
        if (!isTauriRuntimeEnv()) return false;
        try {
            return await tauriInvoke<boolean>('is_dropbox_connected', { clientId: normalized });
        } catch (error) {
            syncServiceDependencies.reportError('Failed to check Dropbox connection status', error);
            return false;
        }
    }

    static async connectDropbox(clientId: string): Promise<void> {
        const normalized = clientId.trim();
        if (!normalized) {
            throw new Error('Dropbox app key is required');
        }
        if (!isTauriRuntimeEnv()) {
            throw new Error('Dropbox sync is only available in the desktop app.');
        }
        await tauriInvoke('connect_dropbox', { clientId: normalized });
    }

    static async disconnectDropbox(clientId: string): Promise<void> {
        const normalized = clientId.trim();
        if (!normalized) {
            throw new Error('Dropbox app key is required');
        }
        if (!isTauriRuntimeEnv()) {
            throw new Error('Dropbox sync is only available in the desktop app.');
        }
        await tauriInvoke('disconnect_dropbox', { clientId: normalized });
    }

    static async getDropboxAccessToken(clientId: string, options?: { forceRefresh?: boolean }): Promise<string> {
        const normalized = clientId.trim();
        if (!normalized) {
            throw new Error('Dropbox app key is required');
        }
        if (!isTauriRuntimeEnv()) {
            throw new Error('Dropbox sync is only available in the desktop app.');
        }
        return await tauriInvoke<string>('get_dropbox_access_token', {
            clientId: normalized,
            forceRefresh: options?.forceRefresh === true,
        });
    }

    static async testDropboxConnection(clientId: string): Promise<void> {
        const normalized = clientId.trim();
        if (!normalized) {
            throw new Error('Dropbox app key is required');
        }
        const fetcher = await getTauriFetch();
        const runTest = async (forceRefresh: boolean) => {
            const accessToken = await SyncService.getDropboxAccessToken(normalized, { forceRefresh });
            await withTimeout(
                testDropboxAccess(accessToken, fetcher ?? fetch),
                DROPBOX_TEST_TIMEOUT_MS,
                'Dropbox connection test timed out. Please try again.'
            );
        };
        try {
            await runTest(false);
        } catch (error) {
            if (error instanceof DropboxUnauthorizedError) {
                await runTest(true);
                return;
            }
            throw error;
        }
    }

    static getOneDriveConfig(): OneDriveSyncConfig {
        return getOneDriveSyncConfig();
    }

    static setOneDriveConfig(config: OneDriveSyncConfig): OneDriveSyncConfig {
        return setOneDriveSyncConfig(config);
    }

    static getOneDriveRedirectUri(): string {
        return getOneDriveRedirectUri();
    }

    static async getOneDriveConnection(): Promise<OneDriveConnection> {
        return getOneDriveConnection();
    }

    static async connectOneDrive(): Promise<OneDriveConnection> {
        return connectOneDrive();
    }

    static async disconnectOneDrive(): Promise<void> {
        await disconnectOneDrive();
    }

    static async testOneDriveConnection(): Promise<void> {
        await testOneDriveConnection();
    }

    static getGoogleDriveConfig(): GoogleDriveSyncConfig {
        return getGoogleDriveSyncConfig();
    }

    static setGoogleDriveConfig(config: GoogleDriveSyncConfig): GoogleDriveSyncConfig {
        return setGoogleDriveSyncConfig(config);
    }

    static isGoogleDriveBrokerManaged(): boolean {
        return isGoogleDriveBrokerManaged();
    }

    static async getGoogleDriveConnection(): Promise<GoogleDriveConnection> {
        return getGoogleDriveConnection();
    }

    static async connectGoogleDrive(): Promise<GoogleDriveConnection> {
        return connectGoogleDrive();
    }

    static async disconnectGoogleDrive(): Promise<void> {
        await disconnectGoogleDrive();
    }

    static async testGoogleDriveConnection(): Promise<void> {
        await testGoogleDriveConnection();
    }

    /**
     * Get the currently configured sync path from the backend
     */
    static async getSyncPath(): Promise<string> {
        return readSyncPath(getSyncConfigDeps());
    }

    /**
     * Set the sync path in the backend
     */
    static async setSyncPath(path: string): Promise<{ success: boolean; path: string; error?: string }> {
        return writeSyncPath(path, getSyncConfigDeps());
    }

    private static async markSyncWrite(data: AppData) {
        const hash = await hashString(toStableJson(data));
        SyncService.lastWrittenHash = hash;
        SyncService.fileWriteIgnoreActive = true;
        SyncService.ignoreFileEventsUntil = Number.POSITIVE_INFINITY;
    }

    private static finalizeSyncWriteIgnoreWindow() {
        if (!SyncService.fileWriteIgnoreActive) return;
        SyncService.fileWriteIgnoreActive = false;
        SyncService.ignoreFileEventsUntil = SyncService.getMonotonicNow() + 2000;
    }

    /** Desktop's own transient-retry policy for one Dropbox transport call
     *  (network/5xx failures, per `DROPBOX_TRANSIENT_RETRY_OPTIONS`). The
     *  401-triggered token-refresh-and-retry-once policy is shared and lives
     *  in `createSyncBackendIO` (`packages/core/src/sync-backend-io.ts`);
     *  `isRetryableError` already excludes 401s, so this wrap never competes
     *  with that policy — it only covers the same operation's transient failures. */
    private static async runDropboxTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
        return withRetry(operation, DROPBOX_TRANSIENT_RETRY_OPTIONS);
    }

    private static async persistSuccessfulSyncStatus(
        syncStatus: NonNullable<AppSettings['lastSyncStatus']>,
        now: string,
        lastSyncHistory?: ReturnType<typeof appendSyncHistory>
    ): Promise<boolean> {
        try {
            await persistSyncSettings({
                lastSyncAt: now,
                lastSyncStatus: syncStatus,
                lastSyncError: undefined,
                ...(lastSyncHistory ? { lastSyncHistory } : {}),
            });
            SyncService.lastSuccessfulSyncLocalChangeAt = getStoreState().lastDataChangeAt;
            return true;
        } catch (error) {
            logSyncWarning('Failed to persist sync status', error);
            return false;
        }
    }

    /** Resolve backend config and construct the cycle's transport adapter —
     *  the core machine's setupCycle hook. */
    private static async setupDesktopCycle(
        context: DesktopSyncCycleContext,
        options: SyncRunOptions,
        setStep: (step: string) => void
    ): Promise<SyncRunCycleSetup> {
        context.backend = options.backendOverride ?? await SyncService.getSyncBackend();
        if (context.backend === 'off') {
            return { kind: 'disabled' };
        }

        if (
            (context.backend === 'cloud' || context.backend === 'webdav' || context.backend === 'cloudkit')
            && typeof window !== 'undefined'
        ) {
            const handleOffline = () => {
                context.networkWentOffline = true;
                context.requestAbortController.abort();
            };
            window.addEventListener('offline', handleOffline);
            context.removeNetworkListener = () => {
                window.removeEventListener('offline', handleOffline);
                context.removeNetworkListener = null;
            };
        }

        if (isTauriRuntimeEnv()) {
            setStep('snapshot');
            await yieldToRenderer();
            try {
                await tauriInvoke<string>('create_data_snapshot');
            } catch (error) {
                logSyncWarning('Failed to create pre-sync snapshot', error);
            }
        }

        if (
            (context.backend === 'cloud' || context.backend === 'webdav' || context.backend === 'cloudkit')
            && typeof navigator !== 'undefined'
            && navigator.onLine === false
        ) {
            throw new Error('Offline: network connection is unavailable for remote sync.');
        }

        context.webdavConfig = context.backend === 'webdav' ? await SyncService.getWebDavConfig() : null;
        context.cloudProvider = context.backend === 'cloud' ? await SyncService.getCloudProvider() : 'selfhosted';
        context.cloudConfig = context.backend === 'cloud' && context.cloudProvider === 'selfhosted'
            ? await SyncService.getCloudConfig()
            : null;
        context.dropboxAppKey = context.backend === 'cloud' && context.cloudProvider === 'dropbox'
            ? (await SyncService.getDropboxAppKey()).trim()
            : '';
        context.oneDriveClientId = context.backend === 'cloud' && context.cloudProvider === 'onedrive'
            ? SyncService.getOneDriveConfig().clientId.trim()
            : '';
        context.googleDriveClientId = context.backend === 'cloud' && context.cloudProvider === 'google-drive'
            ? SyncService.getGoogleDriveConfig().clientId.trim()
            : '';
        if (context.backend === 'cloud' && context.cloudProvider === 'dropbox' && !context.dropboxAppKey) {
            throw new Error('Dropbox app key is not configured');
        }
        if (context.backend === 'cloud' && context.cloudProvider === 'onedrive') {
            if (isTauriRuntimeEnv()) throw new Error('OneDrive Graph sync is available in the PWA only.');
            if (!context.oneDriveClientId) throw new Error('Microsoft Entra application client ID is not configured');
        }
        if (context.backend === 'cloud' && context.cloudProvider === 'google-drive') {
            if (isTauriRuntimeEnv()) throw new Error('Google Drive app-data sync is available in the PWA only.');
            if (!context.googleDriveClientId) throw new Error('Google OAuth web client ID is not configured');
        }
        context.syncPath = context.backend === 'file' ? await SyncService.getSyncPath() : '';
        context.fileBaseDir = context.backend === 'file'
            ? getFileSyncDir(context.syncPath, SYNC_FILE_NAME, LEGACY_SYNC_FILE_NAME)
            : '';

        // CloudKit setup: ensure zone and subscription exist before syncing.
        if (context.backend === 'cloudkit') {
            setStep('cloudkit_setup');
            await yieldToRenderer();
            await syncServiceDependencies.ensureCloudKitReady();
        }

        return {
            kind: 'ready',
            backend: context.backend,
            cloudProvider: context.cloudProvider,
            io: SyncService.createBackendIO(context),
            fastSyncScope: buildFastSyncScope(context),
        };
    }

    /** Ladder-visible config for `createSyncBackendIO` (ADR 0014's shared
     *  `SyncBackendIO` implementation, `packages/core/src/sync-backend-io.ts`).
     *  A separate, minimal object from `DesktopSyncCycleContext` — the ladder
     *  only needs enough to pick a branch and normalize a url; the transport
     *  closures below keep reading the rich `context` for everything else. */
    private static createBackendContext(context: DesktopSyncCycleContext): SyncBackendContext {
        return {
            backend: context.backend,
            cloudProvider: context.cloudProvider,
            webdav: context.webdavConfig?.url ? { url: context.webdavConfig.url } : null,
            cloud: context.cloudConfig?.url ? { url: context.cloudConfig.url } : null,
            filePath: context.fileBaseDir,
            dropboxAppKey: context.dropboxAppKey,
            dropboxRev: null,
            oneDriveClientId: context.oneDriveClientId,
            oneDriveETag: null,
            googleDriveClientId: context.googleDriveClientId,
            googleDriveRevision: null,
        };
    }

    /** Backend transport adapter for the core machine (ADR 0014). The ladder
     *  (which backend, url normalization, the Dropbox rev fingerprint format,
     *  the conflict mapping, and the auth-retry-once policy) lives in
     *  `createSyncBackendIO`; this only supplies desktop's transport truths. */
    private static createBackendIO(context: DesktopSyncCycleContext): SyncBackendIO {
        const ctx = SyncService.createBackendContext(context);

        const transport: SyncTransport = {
            webdavGet: async () => {
                // Error context must carry the file URL the request targets,
                // not the configured base folder — a folder-only url field
                // made #898 (and #758) logs unreadable for pinpointing the
                // failing request.
                const normalizedUrl = ctx.syncUrl!;
                // A "missing" remote on a folder that other devices populate
                // means the app is reading the wrong URL or the server hid
                // the file; make it visible in shared logs (#898).
                const logMissingRemote = (data: AppData | null | undefined): AppData | null => {
                    if (data == null) {
                        logSyncInfo('WebDAV remote read returned no data', { url: normalizedUrl });
                        return null;
                    }
                    return data;
                };
                if (isTauriRuntimeEnv()) {
                    return logMissingRemote(await withRetry(
                        () => tauriInvoke<AppData>('webdav_get_json'),
                        WEBDAV_READ_RETRY_OPTIONS,
                    ));
                }
                const webdavConfig = context.webdavConfig!;
                const fetcher = await createFetchWithAbortForContext(context);
                return logMissingRemote(await withRetry(
                    () => webdavGetJson<AppData>(normalizedUrl, {
                        allowInsecureHttp: webdavConfig.allowInsecureHttp,
                        username: webdavConfig.username,
                        password: webdavConfig.password || '',
                        fetcher,
                    }),
                    WEBDAV_READ_RETRY_OPTIONS,
                ));
            },
            webdavPut: async (sanitized) => {
                if (isTauriRuntimeEnv()) {
                    return tauriInvoke<RemoteJsonWriteResult | boolean>('webdav_put_json', { data: sanitized });
                }
                const config = await SyncService.getWebDavConfig();
                const normalizedUrl = normalizeWebdavUrl(config.url);
                ctx.syncUrl = normalizedUrl;
                const fetcher = await createFetchWithAbortForContext(context);
                return webdavPutJson(normalizedUrl, sanitized, {
                    allowInsecureHttp: config.allowInsecureHttp,
                    username: config.username,
                    password: config.password || '',
                    fetcher,
                });
            },
            webdavHead: async () => {
                const webdavConfig = context.webdavConfig!;
                const password = await resolveWebdavPassword(webdavConfig);
                const fetcher = await createFetchWithAbortForContext(context);
                return webdavHeadFile(ctx.syncUrl!, {
                    allowInsecureHttp: webdavConfig.allowInsecureHttp,
                    allowWeakFingerprint: webdavConfig.allowWeakFingerprint,
                    username: webdavConfig.username,
                    password,
                    fetcher,
                });
            },
            cloudGet: async () => {
                if (isTauriRuntimeEnv()) {
                    return tauriInvoke<AppData | null>('cloud_get_json');
                }
                const fetcher = await createFetchWithAbortForContext(context);
                return cloudGetJson<AppData>(ctx.syncUrl!, {
                    allowInsecureHttp: context.cloudConfig!.allowInsecureHttp,
                    token: context.cloudConfig!.token,
                    fetcher,
                });
            },
            cloudPut: async (sanitized) => {
                const config = context.cloudConfig ?? await SyncService.getCloudConfig();
                const normalizedUrl = normalizeCloudUrl(config.url);
                ctx.syncUrl = normalizedUrl;
                if (isTauriRuntimeEnv()) {
                    return tauriInvoke<CloudJsonWriteResult | boolean>('cloud_put_json', { data: sanitized });
                }
                const fetcher = await createFetchWithAbortForContext(context);
                return cloudPutJson(normalizedUrl, sanitized, {
                    allowInsecureHttp: config.allowInsecureHttp,
                    token: config.token,
                    fetcher,
                });
            },
            cloudHead: async () => {
                const fetcher = await createFetchWithAbortForContext(context);
                return cloudHeadJson(ctx.syncUrl!, {
                    allowInsecureHttp: context.cloudConfig!.allowInsecureHttp,
                    token: context.cloudConfig!.token,
                    fetcher,
                });
            },
            fileRead: async () => {
                if (!isTauriRuntimeEnv()) {
                    throw new Error('File sync is not available in the web app.');
                }
                return tauriInvoke<AppData>('read_sync_file');
            },
            fileWrite: async (sanitized) => {
                await SyncService.markSyncWrite(sanitized);
                await tauriInvoke('write_sync_file', { data: sanitized });
            },
            cloudKitRead: async () => syncServiceDependencies.readRemoteCloudKit(),
            cloudKitWrite: async (sanitized) => {
                await syncServiceDependencies.writeRemoteCloudKit(sanitized);
            },
            resolveDropboxToken: (forceRefresh) => SyncService.runDropboxTransientRetry(
                () => resolveDropboxAccessTokenForContext(context, forceRefresh)
            ),
            dropboxDownload: (token) => SyncService.downloadDropboxWithFallback(context, token),
            dropboxUpload: async (token, sanitized, expectedRev) => {
                const fetcher = await createFetchWithAbortForContext(context);
                return SyncService.runDropboxTransientRetry(
                    () => uploadDropboxAppData(token, sanitized, expectedRev, fetcher)
                );
            },
            dropboxMetadata: async (token) => {
                const fetcher = await createFetchWithAbortForContext(context);
                return SyncService.runDropboxTransientRetry(() => getDropboxAppDataMetadata(token, fetcher));
            },
            oneDriveDownload: () => downloadOneDriveAppData(),
            oneDriveUpload: async (sanitized, expectedETag) => {
                try {
                    return await uploadOneDriveAppData(sanitized, expectedETag);
                } catch (error) {
                    if (error instanceof OneDriveConflictError) throw new SyncRemoteWriteConflict();
                    throw error;
                }
            },
            oneDriveMetadata: () => getOneDriveAppDataMetadata(),
            googleDriveDownload: () => downloadGoogleDriveAppData(),
            googleDriveUpload: async (sanitized, expectedRevision) => {
                try {
                    return await uploadGoogleDriveAppData(sanitized, expectedRevision);
                } catch (error) {
                    if (error instanceof GoogleDriveConflictError) throw new SyncRemoteWriteConflict();
                    throw error;
                }
            },
            googleDriveMetadata: () => getGoogleDriveAppDataMetadata(),
            syncWebdavAttachments: async (data) => {
                const baseUrl = getBaseSyncUrl(context.webdavConfig!.url);
                return syncAttachments(data, context.webdavConfig!, baseUrl, attachmentBackendDeps);
            },
            syncCloudKitAttachments: async (data) => syncCloudKitAttachments(data, attachmentBackendDeps),
            syncFileAttachments: async (data) => syncFileAttachments(data, context.fileBaseDir, attachmentBackendDeps),
            syncCloudAttachments: async (data) => {
                const baseUrl = getCloudBaseUrl(context.cloudConfig!.url);
                return syncCloudAttachments(data, context.cloudConfig!, baseUrl, attachmentBackendDeps);
            },
            syncDropboxAttachments: async (data) => syncDropboxAttachments(
                data,
                (forceRefresh) => resolveDropboxAccessTokenForContext(context, forceRefresh),
                attachmentBackendDeps
            ),
        };

        return createSyncBackendIO(ctx, transport);
    }

    /** Dropbox remote read: try the native (Tauri) fetcher first, fall back to
     *  the browser fetcher when it comes back empty. Desktop-only truth — the
     *  Tauri http client and the browser fetch client can see different
     *  network paths (e.g. proxy configuration), so a native miss is worth a
     *  second try before treating the remote as empty. */
    private static async downloadDropboxWithFallback(
        context: DesktopSyncCycleContext,
        token: string
    ): Promise<{ data: AppData | null; rev: string | null }> {
        const nativeFetch = await getTauriFetch();
        const browserFetcher = createAbortableFetch(fetch, { baseSignal: context.requestAbortController.signal });

        if (!nativeFetch) {
            return SyncService.runDropboxTransientRetry(() => downloadDropboxAppData(token, browserFetcher));
        }

        const nativeFetcher = createAbortableFetch(nativeFetch, { baseSignal: context.requestAbortController.signal });
        const nativeRemote = await SyncService.runDropboxTransientRetry(() => downloadDropboxAppData(token, nativeFetcher));
        if (nativeRemote.data !== null) {
            return nativeRemote;
        }

        logSyncInfo('Retrying Dropbox remote read with browser fetch fallback');
        try {
            const browserRemote = await SyncService.runDropboxTransientRetry(() => downloadDropboxAppData(token, browserFetcher));
            if (browserRemote.data !== null) {
                logSyncInfo('Recovered Dropbox remote read via browser fetch fallback');
                return browserRemote;
            }
            return nativeRemote;
        } catch (error) {
            logSyncWarning('Dropbox browser fetch fallback failed', error);
            return nativeRemote;
        }
    }

    private static hasPendingLocalChangesForExternalSync(): boolean {
        const state = getStoreState();
        if (!state.settings?.lastSyncAt) return false;
        if (state.lastDataChangeAt <= 0) return false;
        return state.lastDataChangeAt > SyncService.lastSuccessfulSyncLocalChangeAt;
    }

    static hasPendingLocalChangesForAutoSync(): boolean {
        const state = getStoreState();
        if (state.lastDataChangeAt <= 0) return false;
        return state.lastDataChangeAt > SyncService.lastSuccessfulSyncLocalChangeAt;
    }

    static async resolveExternalSyncChange(
        resolution: ExternalSyncChangeResolution
    ): Promise<{ success: boolean; stats?: MergeStats; error?: string }> {
        if (!isTauriRuntimeEnv()) return { success: false, error: 'Desktop runtime is required.' };
        const backend = await SyncService.getSyncBackend();
        if (backend !== 'file') return { success: false, error: 'External file conflict handling is only available for file sync.' };

        const pendingChange = SyncService.pendingExternalSyncChange;
        SyncService.setPendingExternalSyncChange(null);

        try {
            if (resolution === 'merge') {
                return await SyncService.performSync();
            }

            if (resolution === 'keep-local') {
                await syncServiceDependencies.flushPendingSave();
                const localData = await injectExternalCalendars(await readLocalDataForSync());
                const sanitized = sanitizeAppDataForRemote(localData);
                await SyncService.markSyncWrite(sanitized);
                try {
                    await tauriInvoke('write_sync_file', { data: sanitized });
                    return await SyncService.performSync();
                } catch (error) {
                    SyncService.finalizeSyncWriteIgnoreWindow();
                    throw error;
                }
            }

            await syncServiceDependencies.flushPendingSave();
            const externalData = normalizeAppData(await tauriInvoke<AppData>('read_sync_file'));
            await persistLocalDataForSync(externalData);
            await getStoreState().fetchData({ silent: true });
            const now = new Date().toISOString();
            const nextHistory = appendSyncHistory(getStoreState().settings, {
                at: now,
                status: 'success',
                backend: 'file',
                type: 'pull',
                conflicts: 0,
                conflictIds: [],
                maxClockSkewMs: 0,
                timestampAdjustments: 0,
                details: 'external_override',
            });
            const persisted = await SyncService.persistSuccessfulSyncStatus('success', now, nextHistory);
            if (!persisted) {
                throw new Error('Failed to persist sync status');
            }
            if (pendingChange?.incomingHash) {
                SyncService.lastObservedHash = pendingChange.incomingHash;
            }
            return { success: true };
        } catch (error) {
            SyncService.setPendingExternalSyncChange(pendingChange);
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message };
        }
    }

    private static async handleFileChange(paths: string[]) {
        if (!isTauriRuntimeEnv()) return;
        if (SyncService.getMonotonicNow() < SyncService.ignoreFileEventsUntil) return;

        const hasSyncFile = paths.some((path) => isSyncFilePath(path, SYNC_FILE_NAME, LEGACY_SYNC_FILE_NAME));
        if (!hasSyncFile) return;

        try {
            const syncData = await tauriInvoke<AppData>('read_sync_file');
            const normalized = normalizeAppData(syncData);
            const hash = await hashString(toStableJson(normalized));
            if (hash === SyncService.lastWrittenHash) {
                return;
            }
            if (hash === SyncService.lastObservedHash) {
                return;
            }
            SyncService.lastObservedHash = hash;

            if (SyncService.hasPendingLocalChangesForExternalSync()) {
                if (SyncService.externalSyncTimer) {
                    clearTimeout(SyncService.externalSyncTimer);
                    SyncService.externalSyncTimer = null;
                }
                const localState = getStoreState();
                const syncPath = SyncService.fileWatcherPath ?? await SyncService.getSyncPath();
                const pending = SyncService.pendingExternalSyncChange;
                if (!pending || pending.incomingHash !== hash) {
                    SyncService.setPendingExternalSyncChange({
                        at: new Date().toISOString(),
                        incomingHash: hash,
                        syncPath,
                        hasLocalChanges: true,
                        localChangeAt: localState.lastDataChangeAt,
                        lastSyncAt: localState.settings?.lastSyncAt,
                    });
                }
                return;
            }

            if (SyncService.externalSyncTimer) {
                clearTimeout(SyncService.externalSyncTimer);
            }
            SyncService.externalSyncTimer = setTimeout(() => {
                SyncService.performSync()
                    .then((result) => {
                        if (result.success) {
                            SyncService.setPendingExternalSyncChange(null);
                            const conflicts = summarizeMergeStats(result.stats).conflicts;
                            const message = conflicts > 0
                                ? `Data updated from sync (${conflicts} conflict${conflicts === 1 ? '' : 's'} resolved).`
                                : 'Data updated from sync.';
                            try {
                                useUiStore.getState().showToast(message, 'info', 5000);
                            } catch {
                                // UI store may be unavailable during bootstrap/tests.
                            }
                        }
                    })
                    .catch((error) => syncServiceDependencies.reportError('Sync failed', error));
            }, 750);
        } catch (error) {
            logSyncWarning('Failed to process external sync change', error);
        }
    }

    private static resolveUnwatch(unwatch: unknown): (() => void) | null {
        if (typeof unwatch === 'function') return unwatch as () => void;
        if (unwatch && typeof (unwatch as any).stop === 'function') {
            return () => (unwatch as any).stop();
        }
        if (unwatch && typeof (unwatch as any).unwatch === 'function') {
            return () => (unwatch as any).unwatch();
        }
        return null;
    }

    static async startFileWatcher(): Promise<void> {
        if (!isTauriRuntimeEnv()) return;
        const backend = await SyncService.getSyncBackend();
        if (backend !== 'file') {
            await SyncService.stopFileWatcher();
            return;
        }
        const syncPath = await SyncService.getSyncPath();
        if (!syncPath) {
            await SyncService.stopFileWatcher();
            return;
        }
        const watchPath = syncPath;
        if (SyncService.fileWatcherStop && SyncService.fileWatcherPath === watchPath && SyncService.fileWatcherBackend === backend) {
            return;
        }

        await SyncService.stopFileWatcher();

        try {
            const { watch } = await import('@tauri-apps/plugin-fs');
            const unwatch = await watch(watchPath, (event: any) => {
                const paths = Array.isArray(event?.paths)
                    ? event.paths
                    : event?.path
                        ? [event.path]
                        : [];
                if (paths.length === 0) return;
                void SyncService.handleFileChange(paths);
            });
            SyncService.fileWatcherStop = SyncService.resolveUnwatch(unwatch);
            SyncService.fileWatcherPath = watchPath;
            SyncService.fileWatcherBackend = backend;
        } catch (error) {
            logSyncWarning('Failed to start sync file watcher', error);
        }
    }

    static async stopFileWatcher(): Promise<void> {
        if (SyncService.fileWatcherStop) {
            try {
                SyncService.fileWatcherStop();
            } catch (error) {
                logSyncWarning('Failed to stop sync watcher', error);
            }
        }
        if (SyncService.externalSyncTimer) {
            clearTimeout(SyncService.externalSyncTimer);
            SyncService.externalSyncTimer = null;
        }
        SyncService.fileWatcherStop = null;
        SyncService.fileWatcherPath = null;
        SyncService.fileWatcherBackend = null;
        SyncService.setPendingExternalSyncChange(null);
    }

    static async cleanupAttachmentsNow(): Promise<void> {
        if (!isTauriRuntimeEnv()) return;
        await syncServiceDependencies.flushPendingSave();
        const localSnapshotChangeAt = getStoreState().lastDataChangeAt;
        const ensureLocalSnapshotFresh = () => {
            ensureFreshLocalSyncSnapshot({
                localSnapshotChangeAt,
                getCurrentChangeAt: () => getStoreState().lastDataChangeAt,
                requestFollowUp: () => SyncService.requestQueuedSyncRun(),
            });
        };
        const backend = await SyncService.getSyncBackend();
        const data = await tauriInvoke<AppData>('get_data');
        ensureLocalSnapshotFresh();
        const cleaned = await cleanupOrphanedAttachments(
            data,
            backend,
            getAttachmentCleanupDeps(),
            { ensureLocalSnapshotFresh },
        );
        ensureLocalSnapshotFresh();
        await persistLocalDataForSync(cleaned);
        await getStoreState().fetchData({ silent: true });
    }

    static async listDataSnapshots(): Promise<string[]> {
        if (!isTauriRuntimeEnv()) return [];
        try {
            return await tauriInvoke<string[]>('list_data_snapshots');
        } catch (error) {
            syncServiceDependencies.reportError('Failed to list snapshots', error);
            return [];
        }
    }

    static async createDataSnapshot(): Promise<string | null> {
        if (!isTauriRuntimeEnv()) return null;
        try {
            return await tauriInvoke<string>('create_data_snapshot');
        } catch (error) {
            syncServiceDependencies.reportError('Failed to create snapshot', error);
            return null;
        }
    }

    static async restoreDataSnapshot(snapshotFileName: string): Promise<{ success: boolean; error?: string }> {
        if (!isTauriRuntimeEnv()) return { success: false, error: 'Desktop runtime is required.' };
        try {
            await tauriInvoke<boolean>('restore_data_snapshot', { snapshotFileName });
            await getStoreState().fetchData({ silent: true });
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message };
        }
    }

    /**
     * Perform a full sync cycle:
     * 1. Read Local & Remote Data
     * 2. Merge (Last-Write-Wins)
     * 3. Write merged data back to both Local & Remote
     * 4. Refresh Core Store
     */
    static async performSync(options: SyncRunOptions = {}): Promise<SyncRunResult> {
        if (SyncService.syncOrchestrator.getState().inFlight) {
            SyncService.queuedSyncOptions = options;
        }
        return SyncService.syncOrchestrator.run(options);
    }

    private static async runSyncCycle(options: SyncRunOptions): Promise<SyncRunResult> {
        SyncService.queuedSyncOptions = null;
        const context = createDesktopSyncCycleContext();
        const persistLocalData = async (data: AppData): Promise<void> => {
            if (isTauriRuntimeEnv()) {
                await persistLocalDataForSync(data);
            } else {
                await webStorage.saveData(data);
            }
        };

        SyncService.updateSyncStatus({
            inFlight: true,
            step: 'init',
            lastResult: SyncService.syncStatus.lastResult,
            lastResultAt: SyncService.syncStatus.lastResultAt,
        });
        await yieldToRenderer();

        let result: SyncRunResult;
        try {
            result = await runSharedSyncCycle({
                options: { manual: options.manual },
                storage: {
                    readPersistedLocal: () => readLocalDataForSync(),
                    persistLocal: persistLocalData,
                    applyDataToStore: (data) => syncServiceDependencies.applySyncedDataToStore(data),
                    persistSyncStatus: (updates) => persistSyncSettings(updates),
                    readFastSyncState: async (scope) => readFastSyncState(scope),
                    writeFastSyncState: async (state) => writeFastSyncState(state, logSyncWarning),
                    injectExternalCalendars: (data) => injectExternalCalendars(data),
                    persistExternalCalendars: (data) => persistExternalCalendars(data),
                },
                notifier: {
                    setStep: (step) => SyncService.updateSyncStatus({ step }),
                    logInfo: (message, extra) => logSyncInfo(message, extra),
                    logWarning: (message, error) => logSyncWarning(message, error),
                    logWarningExtra: (message, extra) => {
                        void syncServiceDependencies.logWarn(message, { scope: 'sync', extra });
                    },
                    sanitizeLogMessage: (message) => syncServiceDependencies.sanitizeLogMessage(message),
                    logSyncError: (error, errorContext) => syncServiceDependencies.logSyncError(error, {
                        backend: errorContext.backend,
                        step: errorContext.step,
                        url: errorContext.url,
                    }),
                    logMergeSummary: (mergeLog) => {
                        if (!isTauriRuntimeEnv()) return;
                        void syncServiceDependencies.logInfo(
                            mergeLog.message,
                            {
                                scope: 'sync',
                                extra: mergeLog.extra,
                                // Resolved conflicts must stay auditable in mindwtr.log even when
                                // diagnostics logging is off; the extra carries ids and field names
                                // only, never task content (#854).
                                force: mergeLog.summary.conflicts > 0,
                            }
                        );
                    },
                    tracePayload: (event, data, extra) => logSyncPayloadTrace(SYNC_TRACE_EVENT_MESSAGES[event], data, extra),
                    yieldToUi: () => yieldToRenderer(),
                },
                store: {
                    getLastDataChangeAt: () => getStoreState().lastDataChangeAt,
                    getInMemorySnapshot: () => syncServiceDependencies.getInMemoryAppDataSnapshot(),
                    flushPendingSave: () => syncServiceDependencies.flushPendingSave(),
                    setUiError: (message) => getStoreState().setError(message),
                    getSettings: () => getStoreState().settings,
                },
                hooks: {
                    setupCycle: (setupContext) => SyncService.setupDesktopCycle(context, options, setupContext.setStep),
                    requestFollowUp: () => SyncService.requestQueuedSyncRun(options, false),
                    ensureNetworkStillAvailable: () => {
                        if (context.backend !== 'cloud' && context.backend !== 'webdav' && context.backend !== 'cloudkit') return;
                        if (
                            context.networkWentOffline
                            || (typeof navigator !== 'undefined' && navigator.onLine === false)
                        ) {
                            context.requestAbortController.abort();
                            throw new Error('Sync paused: offline state detected');
                        }
                    },
                    acceptCoveredSnapshot: (expectedData) => SyncService.isCoveredLocalSnapshot(expectedData),
                    cleanupAttachmentTempFiles: () => cleanupAttachmentTempFiles(getAttachmentCleanupDeps()),
                    runAttachmentCleanup: async (data, cleanupContext) => {
                        const orphanedAttachments = findOrphanedAttachments(data);
                        const deletedAttachments = findDeletedAttachmentsForFileCleanup(data);
                        const pendingRemoteDeletes = data.settings.attachments?.pendingRemoteDeletes ?? [];
                        if (orphanedAttachments.length === 0 && deletedAttachments.length === 0 && pendingRemoteDeletes.length === 0) {
                            return null;
                        }
                        cleanupContext.setStep('attachments_cleanup');
                        await yieldToRenderer();
                        cleanupContext.ensureLocalSnapshotFresh(data);
                        await cleanupContext.ensureNetworkStillAvailable();
                        const ensureLocalSnapshotFresh = () => cleanupContext.ensureLocalSnapshotFresh(data);
                        const cleanedData = await cleanupOrphanedAttachments(
                            data,
                            context.backend,
                            getAttachmentCleanupDeps(),
                            { ensureLocalSnapshotFresh },
                        );
                        return {
                            data: cleanedData,
                            invalidateFastSyncState: orphanedAttachments.length > 0,
                        };
                    },
                    formatErrorMessage: (error, backend) => formatSyncErrorMessage(error, backend),
                    finalizeErrorStatus: async ({ at, message, history }) => {
                        getStoreState().setError(message);
                        await getStoreState().fetchData({ silent: true });
                        await persistSyncSettings({
                            lastSyncAt: at,
                            lastSyncStatus: 'error',
                            lastSyncError: message,
                            lastSyncHistory: history,
                        });
                    },
                    finalizeSuccess: (mergedData, info) => {
                        syncServiceDependencies.applySyncedDataToStore(mergedData);
                        info.acceptCoveredSnapshot(mergedData);
                        SyncService.lastSuccessfulSyncLocalChangeAt = getStoreState().lastDataChangeAt;
                        SyncService.setPendingExternalSyncChange(null);
                        getStoreState().setError(null);
                        SyncService.clearCoveredQueuedSyncRun(info.getLocalSnapshotChangeAt(), options);
                    },
                    onUnchangedSkip: () => {
                        SyncService.lastSuccessfulSyncLocalChangeAt = getStoreState().lastDataChangeAt;
                        SyncService.setPendingExternalSyncChange(null);
                    },
                },
                policy: {
                    preSyncAttachmentsBeforeFastCheck: false,
                    enableReadCheckSkip: false,
                    postMergeAttachmentErrorPolicy: 'warn',
                    attachmentPhasesEnabled: isTauriRuntimeEnv(),
                },
                performSyncCycle: (io) => syncServiceDependencies.performSyncCycle(io),
            });
        } finally {
            context.requestAbortController.abort();
            try {
                const releaseNetworkListener = context.removeNetworkListener as (() => void) | null;
                if (typeof releaseNetworkListener === 'function') {
                    releaseNetworkListener();
                }
                context.removeNetworkListener = null;
            } catch (error) {
                logSyncWarning('Failed to unsubscribe network listener after sync', error);
            }
            SyncService.finalizeSyncWriteIgnoreWindow();
        }
        const skippedRequeue = result.skipped === 'requeued';
        if (!skippedRequeue) {
            SyncService.finalizeAttachmentWarningState(
                { hadAttachmentWarning: result.hadAttachmentWarning === true },
                result
            );
        }
        SyncService.updateSyncStatus({
            inFlight: false,
            step: null,
            lastResult: skippedRequeue
                ? SyncService.syncStatus.lastResult
                : result.success
                    ? 'success'
                    : 'error',
            lastResultAt: skippedRequeue
                ? SyncService.syncStatus.lastResultAt
                : new Date().toISOString(),
        });

        if (!SyncService.syncOrchestrator.getState().queued) {
            SyncService.queuedSyncOptions = null;
        }

        return result;
    }
}

export const __syncServiceTestUtils = {
    setDependenciesForTests(overrides: Partial<SyncServiceDependencies>) {
        syncServiceDependencies = {
            ...syncServiceDependencies,
            ...overrides,
        };
    },
    resetDependenciesForTests() {
        syncServiceDependencies = {
            ...defaultSyncServiceDependencies,
        };
    },
    async persistLocalDataForTests(data: AppData) {
        await persistLocalDataForSync(data);
    },
    clearWebdavDownloadBackoff() {
        clearAttachmentSyncState();
    },
    clearAttachmentValidationFailures() {
        clearAttachmentValidationFailures();
    },
    simulateAttachmentValidationFailure(attachment: Attachment, error?: string) {
        return handleAttachmentValidationFailure(attachment, error);
    },
    getAttachmentValidationFailureAttempts(attachmentId: string) {
        return getAttachmentValidationFailureAttempts(attachmentId);
    },
};
