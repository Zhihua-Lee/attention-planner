import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import type { ExternalCalendarEvent, ExternalCalendarSubscription } from '@mindwtr/core';

const CONFIG_STORAGE_KEY = 'attention-planner:outlook-calendar:config:v1';
const ACCOUNT_HOME_ID_STORAGE_KEY = 'attention-planner:outlook-calendar:account-home-id:v1';
const DELTA_CACHE_PREFIX = 'attention-planner:outlook-calendar:delta:v1:';
const LAST_SYNC_STORAGE_KEY = 'attention-planner:outlook-calendar:last-sync:v1';
export const OUTLOOK_CALENDAR_CHANGED_EVENT = 'attention-planner:outlook-calendar-changed';
export const OUTLOOK_CALENDAR_SOURCE_ID = 'outlook-graph';

const OUTLOOK_SCOPES = ['Calendars.Read'];
const DEFAULT_TENANT_ID = 'common';
const DEFAULT_CLIENT_ID = String(import.meta.env.VITE_MICROSOFT_CLIENT_ID || '').trim();
const GRAPH_CALENDAR_VIEW_DELTA_URL = 'https://graph.microsoft.com/v1.0/me/calendarView/delta';

export type OutlookCalendarConfig = {
    clientId: string;
    enabled: boolean;
    tenantId: string;
};

export type OutlookCalendarConnection = {
    accountName: string | null;
    configured: boolean;
    connected: boolean;
    enabled: boolean;
    lastSyncAt: string | null;
};

export type OutlookCalendarFetchResult = {
    calendar: ExternalCalendarSubscription;
    events: ExternalCalendarEvent[];
};

type GraphDateTime = {
    dateTime?: string;
    timeZone?: string;
};

type GraphCalendarEvent = {
    '@removed'?: unknown;
    bodyPreview?: string;
    end?: GraphDateTime;
    id?: string;
    isAllDay?: boolean;
    location?: { displayName?: string };
    start?: GraphDateTime;
    subject?: string;
};

type GraphDeltaPage = {
    '@odata.deltaLink'?: string;
    '@odata.nextLink'?: string;
    value?: GraphCalendarEvent[];
};

type OutlookDeltaCache = {
    deltaLink: string;
    events: Record<string, ExternalCalendarEvent>;
};

type FetchOutlookDeltaOptions = {
    accessToken: string;
    accountKey: string;
    fetcher?: typeof fetch;
    rangeEnd: Date;
    rangeStart: Date;
    storage?: Storage | null;
};

class OutlookGraphError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = 'OutlookGraphError';
    }
}

let clientState: {
    fingerprint: string;
    client: PublicClientApplication;
} | null = null;

function browserLocalStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function browserSessionStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

function notifyChanged(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(OUTLOOK_CALENDAR_CHANGED_EVENT));
    }
}

export function getOutlookRedirectUri(): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/redirect`;
}

export function getOutlookCalendarConfig(): OutlookCalendarConfig {
    const defaults: OutlookCalendarConfig = {
        clientId: DEFAULT_CLIENT_ID,
        enabled: false,
        tenantId: DEFAULT_TENANT_ID,
    };
    const storage = browserLocalStorage();
    if (!storage) return defaults;
    try {
        const parsed = JSON.parse(storage.getItem(CONFIG_STORAGE_KEY) ?? 'null') as Partial<OutlookCalendarConfig> | null;
        if (!parsed || typeof parsed !== 'object') return defaults;
        return {
            clientId: typeof parsed.clientId === 'string' && parsed.clientId.trim()
                ? parsed.clientId.trim()
                : DEFAULT_CLIENT_ID,
            enabled: parsed.enabled === true,
            tenantId: typeof parsed.tenantId === 'string' && parsed.tenantId.trim()
                ? parsed.tenantId.trim()
                : DEFAULT_TENANT_ID,
        };
    } catch {
        return defaults;
    }
}

function clearDeltaCache(storage = browserSessionStorage()): void {
    if (!storage) return;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(DELTA_CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
    storage.removeItem(LAST_SYNC_STORAGE_KEY);
}

export function setOutlookCalendarConfig(input: OutlookCalendarConfig): OutlookCalendarConfig {
    const config: OutlookCalendarConfig = {
        clientId: input.clientId.trim(),
        enabled: input.enabled,
        tenantId: input.tenantId.trim() || DEFAULT_TENANT_ID,
    };
    browserLocalStorage()?.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    const fingerprint = `${config.clientId}:${config.tenantId}`;
    if (clientState && clientState.fingerprint !== fingerprint) {
        clientState = null;
        clearDeltaCache();
        browserLocalStorage()?.removeItem(ACCOUNT_HOME_ID_STORAGE_KEY);
    }
    notifyChanged();
    return config;
}

function getLastSyncAt(): string | null {
    return browserSessionStorage()?.getItem(LAST_SYNC_STORAGE_KEY) ?? null;
}

async function getClient(config: OutlookCalendarConfig): Promise<PublicClientApplication> {
    if (!config.clientId) throw new Error('Microsoft Entra application client ID is required.');
    const fingerprint = `${config.clientId}:${config.tenantId}`;
    if (clientState?.fingerprint === fingerprint) return clientState.client;

    const { BrowserCacheLocation, PublicClientApplication } = await import('@azure/msal-browser');
    const client = new PublicClientApplication({
        auth: {
            clientId: config.clientId,
            authority: `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}`,
            redirectUri: getOutlookRedirectUri(),
        },
        cache: {
            cacheLocation: BrowserCacheLocation.SessionStorage,
        },
    });
    await client.initialize();
    const redirectResult = await client.handleRedirectPromise();
    if (redirectResult?.account) saveAccountHomeId(redirectResult.account);
    const account = currentAccount(client);
    if (account) client.setActiveAccount(account);
    clientState = { fingerprint, client };
    return client;
}

function currentAccount(client: PublicClientApplication): AccountInfo | null {
    const homeAccountId = browserLocalStorage()?.getItem(ACCOUNT_HOME_ID_STORAGE_KEY)?.trim() || '';
    if (!homeAccountId) return null;
    return client.getAccount({ homeAccountId }) ?? null;
}

function saveAccountHomeId(account: AccountInfo | null): void {
    const storage = browserLocalStorage();
    if (!storage) return;
    if (account?.homeAccountId) {
        storage.setItem(ACCOUNT_HOME_ID_STORAGE_KEY, account.homeAccountId);
    } else {
        storage.removeItem(ACCOUNT_HOME_ID_STORAGE_KEY);
    }
}

export async function getOutlookCalendarConnection(): Promise<OutlookCalendarConnection> {
    const config = getOutlookCalendarConfig();
    if (!config.clientId) {
        return {
            accountName: null,
            configured: false,
            connected: false,
            enabled: config.enabled,
            lastSyncAt: getLastSyncAt(),
        };
    }
    try {
        const account = currentAccount(await getClient(config));
        return {
            accountName: account?.username ?? account?.name ?? null,
            configured: true,
            connected: Boolean(account),
            enabled: config.enabled,
            lastSyncAt: getLastSyncAt(),
        };
    } catch {
        return {
            accountName: null,
            configured: true,
            connected: false,
            enabled: config.enabled,
            lastSyncAt: getLastSyncAt(),
        };
    }
}

export async function connectOutlookCalendar(): Promise<OutlookCalendarConnection> {
    const config = getOutlookCalendarConfig();
    const client = await getClient(config);
    const result = await client.loginPopup({
        prompt: 'select_account',
        scopes: OUTLOOK_SCOPES,
    });
    if (result.account) {
        saveAccountHomeId(result.account);
        client.setActiveAccount(result.account);
    }
    clearDeltaCache();
    notifyChanged();
    return getOutlookCalendarConnection();
}

export async function disconnectOutlookCalendar(): Promise<void> {
    const config = getOutlookCalendarConfig();
    if (config.clientId) {
        const client = await getClient(config);
        const account = currentAccount(client);
        if (account) await client.clearCache({ account });
    }
    saveAccountHomeId(null);
    clearDeltaCache();
    notifyChanged();
}

async function acquireAccessToken(client: PublicClientApplication, account: AccountInfo): Promise<string> {
    try {
        const result = await client.acquireTokenSilent({ account, scopes: OUTLOOK_SCOPES });
        return result.accessToken;
    } catch (error) {
        const { InteractionRequiredAuthError } = await import('@azure/msal-browser');
        if (error instanceof InteractionRequiredAuthError) {
            throw new Error('Outlook session needs attention. Reconnect it in Settings → Integrations.');
        }
        throw error;
    }
}

function parseGraphDateTime(value: GraphDateTime | undefined): string | null {
    const raw = value?.dateTime?.trim();
    if (!raw) return null;
    const normalized = /(?:z|[+-]\d\d:\d\d)$/i.test(raw) ? raw : `${raw}Z`;
    const time = Date.parse(normalized);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function mapOutlookGraphEvent(event: GraphCalendarEvent): ExternalCalendarEvent | null {
    if (event['@removed'] || !event.id) return null;
    const start = parseGraphDateTime(event.start);
    const end = parseGraphDateTime(event.end);
    if (!start || !end) return null;
    return {
        id: `${OUTLOOK_CALENDAR_SOURCE_ID}:${event.id}`,
        sourceId: OUTLOOK_CALENDAR_SOURCE_ID,
        nativeEventId: event.id,
        title: event.subject?.trim() || '(Untitled Outlook event)',
        start,
        end,
        allDay: event.isAllDay === true,
        description: event.bodyPreview?.trim() || undefined,
        location: event.location?.displayName?.trim() || undefined,
    };
}

function deltaCacheKey(accountKey: string, rangeStart: Date, rangeEnd: Date): string {
    return `${DELTA_CACHE_PREFIX}${encodeURIComponent(accountKey)}:${rangeStart.toISOString()}:${rangeEnd.toISOString()}`;
}

function loadDeltaCache(storage: Storage | null, key: string): OutlookDeltaCache | null {
    if (!storage) return null;
    try {
        const parsed = JSON.parse(storage.getItem(key) ?? 'null') as OutlookDeltaCache | null;
        if (!parsed || typeof parsed.deltaLink !== 'string' || !parsed.events || typeof parsed.events !== 'object') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function initialDeltaUrl(rangeStart: Date, rangeEnd: Date): string {
    const url = new URL(GRAPH_CALENDAR_VIEW_DELTA_URL);
    url.searchParams.set('startDateTime', rangeStart.toISOString());
    url.searchParams.set('endDateTime', rangeEnd.toISOString());
    return url.toString();
}

async function requestGraphPage(url: string, accessToken: string, fetcher: typeof fetch): Promise<GraphDeltaPage> {
    const response = await fetcher(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Prefer: 'outlook.timezone="UTC"',
        },
    });
    if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new OutlookGraphError(response.status, detail || `Microsoft Graph returned HTTP ${response.status}.`);
    }
    return await response.json() as GraphDeltaPage;
}

export async function fetchOutlookCalendarDelta({
    accessToken,
    accountKey,
    fetcher = fetch,
    rangeEnd,
    rangeStart,
    storage = browserSessionStorage(),
}: FetchOutlookDeltaOptions): Promise<ExternalCalendarEvent[]> {
    const cacheKey = deltaCacheKey(accountKey, rangeStart, rangeEnd);
    const cached = loadDeltaCache(storage, cacheKey);
    const events = { ...(cached?.events ?? {}) };
    let nextUrl = cached?.deltaLink ?? initialDeltaUrl(rangeStart, rangeEnd);
    let deltaLink = cached?.deltaLink ?? '';

    try {
        while (nextUrl) {
            const page = await requestGraphPage(nextUrl, accessToken, fetcher);
            for (const graphEvent of page.value ?? []) {
                if (!graphEvent.id) continue;
                if (graphEvent['@removed']) {
                    delete events[graphEvent.id];
                    continue;
                }
                const mapped = mapOutlookGraphEvent(graphEvent);
                if (mapped) events[graphEvent.id] = mapped;
            }
            nextUrl = page['@odata.nextLink'] ?? '';
            deltaLink = page['@odata.deltaLink'] ?? deltaLink;
        }
    } catch (error) {
        if (cached && error instanceof OutlookGraphError && error.status === 410) {
            storage?.removeItem(cacheKey);
            return fetchOutlookCalendarDelta({ accessToken, accountKey, fetcher, rangeEnd, rangeStart, storage });
        }
        throw error;
    }

    if (!deltaLink) throw new Error('Microsoft Graph delta response did not include a delta link.');
    storage?.setItem(cacheKey, JSON.stringify({ deltaLink, events } satisfies OutlookDeltaCache));
    storage?.setItem(LAST_SYNC_STORAGE_KEY, new Date().toISOString());
    return Object.values(events).filter((event) => {
        const start = Date.parse(event.start);
        const end = Date.parse(event.end);
        return start < rangeEnd.getTime() && end > rangeStart.getTime();
    });
}

export async function fetchOutlookCalendarEvents(
    rangeStart: Date,
    rangeEnd: Date,
): Promise<OutlookCalendarFetchResult | null> {
    const config = getOutlookCalendarConfig();
    if (!config.enabled || !config.clientId) return null;
    const client = await getClient(config);
    const account = currentAccount(client);
    if (!account) return null;
    const accessToken = await acquireAccessToken(client, account);
    const events = await fetchOutlookCalendarDelta({
        accessToken,
        accountKey: account.homeAccountId,
        rangeEnd,
        rangeStart,
    });
    notifyChanged();
    return {
        calendar: {
            id: OUTLOOK_CALENDAR_SOURCE_ID,
            name: 'Outlook',
            url: 'outlook://microsoft-graph',
            enabled: true,
            color: '#0078d4',
        },
        events,
    };
}
