import type { AppData } from '@mindwtr/core';

const CONFIG_STORAGE_KEY = 'attention-planner:google-drive-sync:config:v1';
const TOKEN_STORAGE_KEY = 'attention-planner:google-drive-sync:token:v1';
const GOOGLE_IDENTITY_SCRIPT_ID = 'attention-planner-google-identity';
const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_API_ROOT = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v3';
const DATA_FILE_NAME = 'data.json';
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const DEFAULT_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

export type GoogleDriveSyncConfig = {
    clientId: string;
};

export type GoogleDriveConnection = {
    configured: boolean;
    connected: boolean;
    expiresAt: number | null;
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
            : DEFAULT_CLIENT_ID,
    };
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
    const token = readStoredToken();
    return {
        configured: Boolean(config.clientId),
        connected: Boolean(config.clientId && token),
        expiresAt: token?.expiresAt ?? null,
    };
}

export async function connectGoogleDrive(): Promise<GoogleDriveConnection> {
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
    const token = readStoredToken();
    clearStoredToken();
    if (!token) return;
    const oauth2 = getGoogleOAuth2();
    if (!oauth2) return;
    await new Promise<void>((resolve) => oauth2.revoke(token.accessToken, resolve));
}

function acquireAccessToken(): string {
    const token = readStoredToken();
    if (!token) {
        throw new Error('Google Drive session expired. Reconnect it in Settings → Sync.');
    }
    return token.accessToken;
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

async function googleFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${acquireAccessToken()}`);
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
        fields: 'files(id,name,version,modifiedTime,md5Checksum)',
        orderBy: 'modifiedTime desc',
        pageSize: '10',
        q: `name = '${escapeDriveQueryString(DATA_FILE_NAME)}' and trashed = false`,
        spaces: 'appDataFolder',
    });
    const response = await googleFetch(`${DRIVE_API_ROOT}/files?${params}`);
    if (!response.ok) throw await parseGoogleApiError(response, `Google Drive file lookup failed (${response.status}).`);
    const payload = await response.json() as { files?: DriveFileMetadata[] };
    const files = Array.isArray(payload.files) ? payload.files.filter((file) => file.id) : [];
    if (files.length > 1) {
        throw new Error('Google Drive contains multiple app sync files. Sync stopped to avoid choosing the wrong copy.');
    }
    return files;
}

async function readMetadata(): Promise<DriveFileMetadata | null> {
    return (await listDataFiles())[0] ?? null;
}

export async function downloadGoogleDriveAppData(): Promise<GoogleDriveDownloadResult> {
    const metadata = await readMetadata();
    if (!metadata?.id) return { data: null, revision: null };
    const response = await googleFetch(`${DRIVE_API_ROOT}/files/${encodeURIComponent(metadata.id)}?alt=media`);
    if (!response.ok) throw await parseGoogleApiError(response, `Google Drive download failed (${response.status}).`);
    try {
        return { data: await response.json() as AppData, revision: metadata.version ?? null };
    } catch {
        throw new Error('Invalid Google Drive sync data: the remote file is not valid JSON.');
    }
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
    const response = await googleFetch(`${DRIVE_UPLOAD_ROOT}/files?uploadType=multipart&fields=id,version`, {
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

    const metadataResponse = await googleFetch(
        `${DRIVE_API_ROOT}/files/${encodeURIComponent(metadata.id)}?fields=id,version`,
    );
    if (metadataResponse.status === 404) throw new GoogleDriveConflictError();
    if (!metadataResponse.ok) {
        throw await parseGoogleApiError(metadataResponse, `Google Drive metadata request failed (${metadataResponse.status}).`);
    }
    const freshMetadata = await metadataResponse.json() as DriveFileMetadata;
    if (freshMetadata.version !== expectedRevision) throw new GoogleDriveConflictError();

    const headers = new Headers({ 'Content-Type': 'application/json' });
    const eTag = metadataResponse.headers.get('etag');
    if (eTag) headers.set('If-Match', eTag);
    const response = await googleFetch(
        `${DRIVE_UPLOAD_ROOT}/files/${encodeURIComponent(metadata.id)}?uploadType=media&fields=id,version`,
        { body: JSON.stringify(data), headers, method: 'PATCH' },
    );
    if (response.status === 409 || response.status === 412) throw new GoogleDriveConflictError();
    if (!response.ok) throw await parseGoogleApiError(response, `Google Drive upload failed (${response.status}).`);
    const updated = await response.json() as DriveFileMetadata;
    return { revision: updated.version ?? null };
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
