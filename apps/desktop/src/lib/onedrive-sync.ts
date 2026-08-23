import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import type { AppData } from '@mindwtr/core';

const CONFIG_STORAGE_KEY = 'attention-planner:onedrive-sync:config:v1';
const ACCOUNT_HOME_ID_STORAGE_KEY = 'attention-planner:onedrive-sync:account-home-id:v1';
const DEFAULT_TENANT_ID = 'common';
const ONEDRIVE_SCOPES = ['Files.ReadWrite.AppFolder'];
const GRAPH_ROOT_URL = 'https://graph.microsoft.com/v1.0';
const APP_ROOT_URL = `${GRAPH_ROOT_URL}/me/drive/special/approot`;
const DATA_ITEM_URL = `${APP_ROOT_URL}:/data.json`;
const DATA_CONTENT_URL = `${DATA_ITEM_URL}:/content`;
const DEFAULT_CLIENT_ID = String(import.meta.env.VITE_MICROSOFT_CLIENT_ID || '').trim();

export type OneDriveSyncConfig = {
    clientId: string;
    tenantId: string;
};

export type OneDriveConnection = {
    accountName: string | null;
    configured: boolean;
    connected: boolean;
};

export type OneDriveDownloadResult = {
    data: AppData | null;
    eTag: string | null;
};

export type OneDriveMetadataResult = {
    eTag: string | null;
};

type DriveItemMetadata = {
    '@microsoft.graph.downloadUrl'?: string;
    eTag?: string;
    id?: string;
    name?: string;
};

type ClientState = {
    client: PublicClientApplication;
    fingerprint: string;
};

let clientState: ClientState | null = null;

export class OneDriveGraphError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'OneDriveGraphError';
        this.status = status;
    }
}

export class OneDriveConflictError extends Error {
    constructor() {
        super('OneDrive changed on another device during sync');
        this.name = 'OneDriveConflictError';
    }
}

function browserLocalStorage(): Storage | null {
    return typeof window === 'undefined' ? null : window.localStorage;
}

function normalizeConfig(input: Partial<OneDriveSyncConfig> | null | undefined): OneDriveSyncConfig {
    return {
        clientId: typeof input?.clientId === 'string' && input.clientId.trim()
            ? input.clientId.trim()
            : DEFAULT_CLIENT_ID,
        tenantId: typeof input?.tenantId === 'string' && input.tenantId.trim()
            ? input.tenantId.trim()
            : DEFAULT_TENANT_ID,
    };
}

export function getOneDriveRedirectUri(): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}`;
}

export function getOneDriveSyncConfig(): OneDriveSyncConfig {
    const storage = browserLocalStorage();
    if (!storage) return normalizeConfig(null);
    try {
        return normalizeConfig(JSON.parse(storage.getItem(CONFIG_STORAGE_KEY) ?? 'null') as Partial<OneDriveSyncConfig> | null);
    } catch {
        return normalizeConfig(null);
    }
}

export function setOneDriveSyncConfig(input: OneDriveSyncConfig): OneDriveSyncConfig {
    const previous = getOneDriveSyncConfig();
    const config = normalizeConfig(input);
    browserLocalStorage()?.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    if (`${previous.clientId}:${previous.tenantId}` !== `${config.clientId}:${config.tenantId}`) {
        browserLocalStorage()?.removeItem(ACCOUNT_HOME_ID_STORAGE_KEY);
        clientState = null;
    }
    return config;
}

function getSavedAccountHomeId(): string {
    return browserLocalStorage()?.getItem(ACCOUNT_HOME_ID_STORAGE_KEY)?.trim() || '';
}

function saveAccount(account: AccountInfo | null): void {
    const storage = browserLocalStorage();
    if (!storage) return;
    if (account?.homeAccountId) {
        storage.setItem(ACCOUNT_HOME_ID_STORAGE_KEY, account.homeAccountId);
    } else {
        storage.removeItem(ACCOUNT_HOME_ID_STORAGE_KEY);
    }
}

async function getClient(config = getOneDriveSyncConfig()): Promise<PublicClientApplication> {
    if (!config.clientId) throw new Error('Microsoft Entra application client ID is required for OneDrive sync.');
    const fingerprint = `${config.clientId}:${config.tenantId}`;
    if (clientState?.fingerprint === fingerprint) return clientState.client;

    const { BrowserCacheLocation, PublicClientApplication } = await import('@azure/msal-browser');
    const client = new PublicClientApplication({
        auth: {
            clientId: config.clientId,
            authority: `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}`,
            redirectUri: getOneDriveRedirectUri(),
        },
        cache: {
            cacheLocation: BrowserCacheLocation.LocalStorage,
        },
    });
    await client.initialize();
    const redirectResult = await client.handleRedirectPromise();
    if (redirectResult?.account) saveAccount(redirectResult.account);
    const account = resolveAccount(client);
    if (account) client.setActiveAccount(account);
    clientState = { client, fingerprint };
    return client;
}

function resolveAccount(client: PublicClientApplication): AccountInfo | null {
    const homeAccountId = getSavedAccountHomeId();
    if (!homeAccountId) return null;
    return client.getAccount({ homeAccountId }) ?? null;
}

export async function getOneDriveConnection(): Promise<OneDriveConnection> {
    const config = getOneDriveSyncConfig();
    if (!config.clientId) return { accountName: null, configured: false, connected: false };
    try {
        const account = resolveAccount(await getClient(config));
        return {
            accountName: account?.username ?? account?.name ?? null,
            configured: true,
            connected: Boolean(account),
        };
    } catch {
        return { accountName: null, configured: true, connected: false };
    }
}

export async function connectOneDrive(): Promise<OneDriveConnection> {
    const client = await getClient();
    const result = await client.loginPopup({
        prompt: 'select_account',
        scopes: ONEDRIVE_SCOPES,
    });
    if (!result.account) throw new Error('Microsoft sign-in did not return an account.');
    saveAccount(result.account);
    client.setActiveAccount(result.account);
    return getOneDriveConnection();
}

export async function disconnectOneDrive(): Promise<void> {
    const client = await getClient();
    const account = resolveAccount(client);
    if (account) await client.clearCache({ account });
    saveAccount(null);
}

async function acquireAccessToken(forceRefresh = false): Promise<string> {
    const client = await getClient();
    const account = resolveAccount(client);
    if (!account) throw new Error('Connect the personal OneDrive account first.');
    try {
        const result = await client.acquireTokenSilent({ account, forceRefresh, scopes: ONEDRIVE_SCOPES });
        return result.accessToken;
    } catch (error) {
        const { InteractionRequiredAuthError } = await import('@azure/msal-browser');
        if (error instanceof InteractionRequiredAuthError) {
            throw new Error('OneDrive session needs attention. Reconnect it in Settings → Sync.');
        }
        throw error;
    }
}

async function parseGraphError(response: Response, fallback: string): Promise<OneDriveGraphError> {
    let detail = '';
    try {
        const payload = await response.json() as { error?: { message?: string } };
        detail = payload.error?.message?.trim() || '';
    } catch {
        // The status and fallback remain sufficient when Graph returns no JSON.
    }
    return new OneDriveGraphError(response.status, detail || fallback);
}

async function graphFetch(input: string, init: RequestInit = {}): Promise<Response> {
    let forceRefresh = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const accessToken = await acquireAccessToken(forceRefresh);
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${accessToken}`);
        const response = await fetch(input, { ...init, cache: 'no-store', headers });
        if (response.status !== 401 || forceRefresh) return response;
        forceRefresh = true;
    }
    throw new Error('OneDrive authorization failed.');
}

async function ensureAppRoot(): Promise<void> {
    const response = await graphFetch(APP_ROOT_URL);
    if (!response.ok) throw await parseGraphError(response, `OneDrive app folder request failed (${response.status}).`);
}

async function readMetadata(): Promise<DriveItemMetadata | null> {
    await ensureAppRoot();
    const url = `${DATA_ITEM_URL}?$select=id,name,eTag,@microsoft.graph.downloadUrl`;
    const response = await graphFetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw await parseGraphError(response, `OneDrive metadata request failed (${response.status}).`);
    return await response.json() as DriveItemMetadata;
}

export async function downloadOneDriveAppData(): Promise<OneDriveDownloadResult> {
    const metadata = await readMetadata();
    if (!metadata) return { data: null, eTag: null };
    const downloadUrl = metadata['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) throw new Error('OneDrive did not return a download URL for the sync file.');
    const response = await fetch(downloadUrl, { cache: 'no-store' });
    if (!response.ok) throw new OneDriveGraphError(response.status, `OneDrive download failed (${response.status}).`);
    try {
        return { data: await response.json() as AppData, eTag: metadata.eTag ?? null };
    } catch {
        throw new Error('Invalid OneDrive sync data: the remote file is not valid JSON.');
    }
}

export async function uploadOneDriveAppData(
    data: AppData,
    expectedETag: string | null,
): Promise<OneDriveMetadataResult> {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.set(expectedETag ? 'If-Match' : 'If-None-Match', expectedETag || '*');
    const response = await graphFetch(DATA_CONTENT_URL, {
        body: JSON.stringify(data),
        headers,
        method: 'PUT',
    });
    if (response.status === 409 || response.status === 412) throw new OneDriveConflictError();
    if (!response.ok) throw await parseGraphError(response, `OneDrive upload failed (${response.status}).`);
    const metadata = await response.json() as DriveItemMetadata;
    return { eTag: metadata.eTag ?? null };
}

export async function getOneDriveAppDataMetadata(): Promise<OneDriveMetadataResult> {
    const metadata = await readMetadata();
    return { eTag: metadata?.eTag ?? null };
}

export async function testOneDriveConnection(): Promise<void> {
    await ensureAppRoot();
}

export const __oneDriveSyncTestUtils = {
    resetClientState(): void {
        clientState = null;
    },
};
