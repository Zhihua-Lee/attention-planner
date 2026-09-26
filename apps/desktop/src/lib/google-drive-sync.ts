import type { AppData } from '@mindwtr/core';
import {
    isSyncBrokerConfigured,
    navigateToSyncBroker,
    syncBrokerJson,
} from './sync-broker-client';

const CONFIG_STORAGE_KEY = 'attention-planner:google-drive-sync:config:v1';
const TOKEN_STORAGE_KEY = 'attention-planner:google-drive-sync:token:v1';
const GOOGLE_IDENTITY_SCRIPT_ID = 'attention-planner-google-identity';
const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const GOOGLE_DRIVE_SCOPE = [
    'https://www.googleapis.com/auth/drive.appdata',
    'https://www.googleapis.com/auth/drive.file',
].join(' ');
const DRIVE_API_ROOT = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_CONDITIONAL_API_ROOT = 'https://www.googleapis.com/drive/v2';
const DRIVE_CONDITIONAL_UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v2';
const DATA_FILE_NAME = 'attention-planner-v2.json';
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const DEFAULT_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
const MANAGED_CLIENT_ID = 'managed-by-attention-planner-broker';

export type GoogleDriveSyncConfig = {
    clientId: string;
};

export type GoogleDriveConnection = {
    configured: boolean;
    connected: boolean;
    expiresAt: number | null;
    persistent: boolean;
};

export type GoogleDriveDownloadResult = {
    data: AppData | null;
    revision: string | null;
};

export type GoogleDriveMetadataResult = {
    revision: string | null;
};

type GoogleTokenResponse = {
    access_token?: string;
    error?: string;
    error_description?: string;
    expires_in?: number;
    scope?: string;
};

type GoogleTokenClient = {
    requestAccessToken(options?: { prompt?: string }): void;
};

type GoogleOAuth2 = {
    initTokenClient(config: {
        callback(response: GoogleTokenResponse): void;
        client_id: string;
        error_callback?(error: { type?: string }): void;
        include_granted_scopes?: boolean;
        scope: string;
    }): GoogleTokenClient;
    revoke(token: string, callback?: () => void): void;
};

type GoogleIdentityWindow = Window & typeof globalThis & {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
};

type StoredToken = {
    accessToken: string;
    expiresAt: number;
};

type DriveFileMetadata = {
    id?: string;
    etag?: string;
    md5Checksum?: string;
    modifiedTime?: string;
    name?: string;
    version?: string;
};

let inMemoryToken: StoredToken | null = null;
let identityScriptPromise: Promise<GoogleOAuth2> | null = null;

export class GoogleDriveApiError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'GoogleDriveApiError';
        this.status = status;
    }
}

export class GoogleDriveConflictError extends Error {
    constructor() {
        super('Google Drive changed on another device during sync');
        this.name = 'GoogleDriveConflictError';
    }
}

function browserLocalStorage(): Storage | null {
    return typeof window === 'undefined' ? null : window.localStorage;
}

function browserSessionStorage(): Storage | null {
    return typeof window === 'undefined' ? null : window.sessionStorage;
}

function normalizeConfig(input: Partial<GoogleDriveSyncConfig> | null | undefined): GoogleDriveSyncConfig {
    return {
        clientId: typeof input?.clientId === 'string' && input.clientId.trim()
            ? input.clientId.trim()
            : DEFAULT_CLIENT_ID || (isSyncBrokerConfigured() ? MANAGED_CLIENT_ID : ''),
    };
}

export function isGoogleDriveBrokerManaged(): boolean {
    return isSyncBrokerConfigured();
}

export function getGoogleDriveSyncConfig(): GoogleDriveSyncConfig {
    const storage = browserLocalStorage();
    if (!storage) return normalizeConfig(null);
    try {
        return normalizeConfig(JSON.parse(storage.getItem(CONFIG_STORAGE_KEY) ?? 'null') as Partial<GoogleDriveSyncConfig> | null);
    } catch {
        return normalizeConfig(null);
    }
}

export function setGoogleDriveSyncConfig(input: GoogleDriveSyncConfig): GoogleDriveSyncConfig {
    const previous = getGoogleDriveSyncConfig();
    const config = normalizeConfig(input);
    browserLocalStorage()?.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    if (previous.clientId !== config.clientId) clearStoredToken();
    return config;
}

function isTokenUsable(token: StoredToken | null): token is StoredToken {
    return Boolean(token?.accessToken && token.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now());
}

function readStoredToken(): StoredToken | null {
    if (isTokenUsable(inMemoryToken)) return inMemoryToken;
    const storage = browserSessionStorage();
    if (!storage) return null;
    try {
        const stored = JSON.parse(storage.getItem(TOKEN_STORAGE_KEY) ?? 'null') as Partial<StoredToken> | null;
        const token = typeof stored?.accessToken === 'string' && typeof stored?.expiresAt === 'number'
            ? { accessToken: stored.accessToken, expiresAt: stored.expiresAt }
            : null;
        if (isTokenUsable(token)) {
            inMemoryToken = token;
            return token;
        }
    } catch {
        // Invalid session state is equivalent to an expired connection.
    }
    clearStoredToken();
    return null;
}

function storeToken(response: GoogleTokenResponse): StoredToken {
    if (!response.access_token) {
        const detail = response.error_description?.trim() || response.error?.trim();
        throw new Error(detail || 'Google authorization did not return an access token.');
    }
    const expiresInSeconds = Number(response.expires_in);
    const token = {
        accessToken: response.access_token,
        expiresAt: Date.now() + (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600) * 1000,
    };
    inMemoryToken = token;
    browserSessionStorage()?.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
    return token;
}

function clearStoredToken(): void {
    inMemoryToken = null;
    browserSessionStorage()?.removeItem(TOKEN_STORAGE_KEY);
}

function getGoogleOAuth2(): GoogleOAuth2 | null {
    if (typeof window === 'undefined') return null;
    return (window as GoogleIdentityWindow).google?.accounts?.oauth2 ?? null;
}

async function loadGoogleIdentityServices(): Promise<GoogleOAuth2> {
    const existing = getGoogleOAuth2();
    if (existing) return existing;
    if (typeof document === 'undefined') throw new Error('Google authorization requires a browser.');
    if (identityScriptPromise) return identityScriptPromise;

    identityScriptPromise = new Promise<GoogleOAuth2>((resolve, reject) => {
        const finish = () => {
            const oauth2 = getGoogleOAuth2();
            if (oauth2) resolve(oauth2);
            else reject(new Error('Google Identity Services did not initialize.'));
        };
        const fail = () => reject(new Error('Failed to load Google Identity Services.'));
        const current = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID) as HTMLScriptElement | null;
        if (current) {
            current.addEventListener('load', finish, { once: true });
            current.addEventListener('error', fail, { once: true });
            return;
        }
        const script = document.createElement('script');
        script.id = GOOGLE_IDENTITY_SCRIPT_ID;
        script.src = GOOGLE_IDENTITY_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.addEventListener('load', finish, { once: true });
        script.addEventListener('error', fail, { once: true });
        document.head.appendChild(script);
    }).catch((error) => {
        identityScriptPromise = null;
        throw error;
    });

    return identityScriptPromise;
}

export async function getGoogleDriveConnection(): Promise<GoogleDriveConnection> {
    const config = getGoogleDriveSyncConfig();
    if (isSyncBrokerConfigured()) {
        const status = await syncBrokerJson<{ connected: boolean; persistent: boolean }>('/google/status');
        const token = readStoredToken();
        return {
            configured: true,
            connected: status.connected,
            expiresAt: token?.expiresAt ?? null,
            persistent: status.persistent === true,
        };
    }
    const token = readStoredToken();
    return {
        configured: Boolean(config.clientId),
        connected: Boolean(config.clientId && token),
        expiresAt: token?.expiresAt ?? null,
        persistent: false,
    };
}

export async function connectGoogleDrive(): Promise<GoogleDriveConnection> {
    if (isSyncBrokerConfigured()) {
        navigateToSyncBroker('/google/connect', '/?view=settings');
        return new Promise<GoogleDriveConnection>(() => undefined);
    }
    const config = getGoogleDriveSyncConfig();
    if (!config.clientId) throw new Error('Google OAuth web client ID is required for Drive sync.');
    const oauth2 = await loadGoogleIdentityServices();
    await new Promise<void>((resolve, reject) => {
        const client = oauth2.initTokenClient({
            client_id: config.clientId,
            scope: GOOGLE_DRIVE_SCOPE,
            include_granted_scopes: false,
            callback: (response) => {
                try {
                    storeToken(response);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            },
            error_callback: (error) => reject(new Error(
                error.type === 'popup_closed'
                    ? 'Google sign-in was cancelled.'
                    : 'Google sign-in popup could not be completed.',
            )),
        });
        client.requestAccessToken({ prompt: 'select_account' });
    });
    return getGoogleDriveConnection();
}

export async function disconnectGoogleDrive(): Promise<void> {
    if (isSyncBrokerConfigured()) {
        clearStoredToken();
        await syncBrokerJson('/google/disconnect', { method: 'POST' });
        return;
    }
    const token = readStoredToken();
    clearStoredToken();
    if (!token) return;
    const oauth2 = getGoogleOAuth2();
    if (!oauth2) return;
    await new Promise<void>((resolve) => oauth2.revoke(token.accessToken, resolve));
}

async function acquireAccessToken(): Promise<string> {
    const token = readStoredToken();
    if (token) return token.accessToken;
    if (isSyncBrokerConfigured()) {
        const response = await syncBrokerJson<{ accessToken: string; expiresIn: number }>('/google/token', {
            method: 'POST',
        });
        return storeToken({
            access_token: response.accessToken,
            expires_in: response.expiresIn,
        }).accessToken;
    }
    throw new Error('Google Drive session expired. Reconnect it in Settings → Sync.');
}

async function parseGoogleApiError(response: Response, fallback: string): Promise<GoogleDriveApiError> {
    let detail = '';
    try {
        const payload = await response.json() as { error?: { message?: string } };
        detail = payload.error?.message?.trim() || '';
    } catch {
        // Status plus fallback remains useful when Google returns no JSON.
    }
    return new GoogleDriveApiError(response.status, detail || fallback);
}

export async function googleDriveFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await acquireAccessToken()}`);
    const response = await fetch(input, { ...init, cache: 'no-store', headers });
    if (response.status === 401) {
        clearStoredToken();
        throw new GoogleDriveApiError(401, 'Google Drive session expired. Reconnect it in Settings → Sync.');
    }
    return response;
}

function escapeDriveQueryString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listDataFiles(): Promise<DriveFileMetadata[]> {
    const params = new URLSearchParams({
        fields: 'files(id,name,version,modifiedTime,md5Checksum),nextPageToken,incompleteSearch',
        orderBy: 'modifiedTime desc',
        pageSize: '10',
        q: `name = '${escapeDriveQueryString(DATA_FILE_NAME)}' and trashed = false`,
        spaces: 'appDataFolder',
    });
    const response = await googleDriveFetch(`${DRIVE_API_ROOT}/files?${params}`);
    if (!response.ok) throw await parseGoogleApiError(response, `Google Drive file lookup failed (${response.status}).`);
    const payload = await response.json() as {
        files?: DriveFileMetadata[];
        nextPageToken?: unknown;
        incompleteSearch?: unknown;
    } | null;
    if (!payload || !Array.isArray(payload.files)
        || (payload.nextPageToken !== undefined && typeof payload.nextPageToken !== 'string')
        || (payload.incompleteSearch !== undefined && typeof payload.incompleteSearch !== 'boolean')) {
        throw new Error('Google Drive returned an invalid app sync file list.');
    }
    if (payload.files.length > 1 || payload.nextPageToken || payload.incompleteSearch) {
        throw new Error('Google Drive returned multiple or incomplete app sync files. Sync stopped to avoid choosing the wrong copy.');
    }
    if (payload.files.some(file => !file || typeof file.id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(file.id)
        || file.name !== DATA_FILE_NAME || typeof file.version !== 'string' || !/^\d{1,30}$/.test(file.version))) {
        throw new Error('Google Drive returned invalid app sync file metadata.');
    }
    return payload.files;
}

async function readMetadata(): Promise<DriveFileMetadata | null> {
    return (await listDataFiles())[0] ?? null;
}

export async function downloadGoogleDriveAppData(): Promise<GoogleDriveDownloadResult> {
    const metadata = await readMetadata();
    if (!metadata?.id) return { data: null, revision: null };
    const response = await googleDriveFetch(`${DRIVE_API_ROOT}/files/${encodeURIComponent(metadata.id)}?alt=media`);
    if (response.status === 404) throw new GoogleDriveConflictError();
    if (!response.ok) throw await parseGoogleApiError(response, `Google Drive download failed (${response.status}).`);
    let data: AppData;
    try {
        data = await response.json() as AppData;
    } catch {
        throw new Error('Invalid Google Drive sync data: the remote file is not valid JSON.');
    }
    // A media download and its earlier list result are separate requests. Do not
    // attach an old version to newer content (or upload a merge based on that pair).
    const after = await readMetadata();
    if (after?.id !== metadata.id || after.version !== metadata.version) throw new GoogleDriveConflictError();
    return { data, revision: metadata.version ?? null };
}

function createMultipartBody(data: AppData): { body: Blob; contentType: string } {
    const boundary = `attention_planner_${crypto.randomUUID().replace(/-/g, '')}`;
    const metadata = JSON.stringify({
        mimeType: 'application/json',
        name: DATA_FILE_NAME,
        parents: ['appDataFolder'],
    });
    const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
        JSON.stringify(data),
        `\r\n--${boundary}--`,
    ]);
    return { body, contentType: `multipart/related; boundary=${boundary}` };
}

async function createDataFile(data: AppData): Promise<GoogleDriveMetadataResult> {
    if (await readMetadata()) throw new GoogleDriveConflictError();
    const multipart = createMultipartBody(data);
    const response = await googleDriveFetch(`${DRIVE_UPLOAD_ROOT}/files?uploadType=multipart&fields=id,version`, {
        body: multipart.body,
        headers: { 'Content-Type': multipart.contentType },
        method: 'POST',
    });
    if (response.status === 409 || response.status === 412) throw new GoogleDriveConflictError();
    if (!response.ok) throw await parseGoogleApiError(response, `Google Drive upload failed (${response.status}).`);
    const metadata = await response.json() as DriveFileMetadata;
    return { revision: metadata.version ?? null };
}

async function updateDataFile(
    data: AppData,
    expectedRevision: string,
): Promise<GoogleDriveMetadataResult> {
    const metadata = await readMetadata();
    if (!metadata?.id || metadata.version !== expectedRevision) throw new GoogleDriveConflictError();

    const metadataResponse = await googleDriveFetch(
        `${DRIVE_CONDITIONAL_API_ROOT}/files/${encodeURIComponent(metadata.id)}?fields=id,version,etag`,
    );
    if (metadataResponse.status === 404) throw new GoogleDriveConflictError();
    if (!metadataResponse.ok) {
        throw await parseGoogleApiError(metadataResponse, `Google Drive metadata request failed (${metadataResponse.status}).`);
    }
    const freshMetadata = await metadataResponse.json() as DriveFileMetadata;
    if (freshMetadata?.id !== metadata.id || freshMetadata.version !== expectedRevision) throw new GoogleDriveConflictError();

    const headers = new Headers({ 'Content-Type': 'application/json' });
    // v2 exposes the file's ETag in JSON. Its matching v2 media endpoint must
    // enforce the precondition even when another client writes after this read.
    // Never substitute a v3 response-header ETag or fall back to a blind upload.
    const eTag = freshMetadata.etag;
    if (typeof eTag !== 'string' || !/^"[\x21\x23-\x7e]{1,512}"$/.test(eTag)) {
        throw new Error('Google Drive did not provide a strong file ETag. Sync stopped without uploading data.');
    }
    headers.set('If-Match', eTag);
    const response = await googleDriveFetch(
        `${DRIVE_CONDITIONAL_UPLOAD_ROOT}/files/${encodeURIComponent(metadata.id)}?uploadType=media&fields=id,version`,
        { body: JSON.stringify(data), headers, method: 'PUT' },
    );
    if (response.status === 409 || response.status === 412) throw new GoogleDriveConflictError();
    if (!response.ok) throw await parseGoogleApiError(response, `Google Drive upload failed (${response.status}).`);
    const updated = await response.json() as DriveFileMetadata;
    if (updated?.id !== metadata.id || typeof updated.version !== 'string' || !/^\d{1,30}$/.test(updated.version)
        || BigInt(updated.version) <= BigInt(expectedRevision)) {
        throw new Error('Google Drive returned an invalid upload result. Sync again to verify the remote data.');
    }
    return { revision: updated.version };
}

export async function uploadGoogleDriveAppData(
    data: AppData,
    expectedRevision: string | null,
): Promise<GoogleDriveMetadataResult> {
    return expectedRevision ? updateDataFile(data, expectedRevision) : createDataFile(data);
}

export async function getGoogleDriveAppDataMetadata(): Promise<GoogleDriveMetadataResult> {
    const metadata = await readMetadata();
    return { revision: metadata?.version ?? null };
}

export async function testGoogleDriveConnection(): Promise<void> {
    await readMetadata();
}

export const __googleDriveSyncTestUtils = {
    reset(): void {
        inMemoryToken = null;
        identityScriptPromise = null;
    },
};
