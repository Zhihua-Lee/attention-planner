const ENV_BROKER_URL = String(import.meta.env.VITE_SYNC_BROKER_URL || '').trim();

export class SyncBrokerAuthenticationError extends Error {
    constructor() {
        super('Secure sync session required. Sign in through Cloudflare Access, then try again.');
        this.name = 'SyncBrokerAuthenticationError';
    }
}

function brokerBaseUrl(): string {
    if (ENV_BROKER_URL) return ENV_BROKER_URL.replace(/\/$/, '');
    if (typeof window !== 'undefined' && window.location.origin === 'https://todo.onthat.top') return '/api';
    return '';
}

export function isSyncBrokerConfigured(): boolean {
    return Boolean(brokerBaseUrl());
}

function brokerUrl(path: string): string {
    const base = brokerBaseUrl();
    if (!base) throw new Error('The secure sync broker is not configured in this build.');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function syncBrokerJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
        response = await fetch(brokerUrl(path), {
            ...init,
            cache: 'no-store',
            credentials: 'include',
            headers,
            redirect: 'follow',
        });
    } catch {
        // Access redirects can surface as a blocked cross-origin fetch rather than
        // a readable HTML response. A top-level broker navigation completes login.
        throw new SyncBrokerAuthenticationError();
    }
    const contentType = response.headers.get('Content-Type') || '';
    if (response.redirected || (!contentType.includes('application/json') && response.status !== 204)) {
        throw new SyncBrokerAuthenticationError();
    }
    const payload = response.status === 204 ? null : await response.json() as { error?: string } & T;
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new SyncBrokerAuthenticationError();
        throw new Error(payload?.error || `Secure sync request failed (${response.status}).`);
    }
    return payload as T;
}

export function navigateToSyncBroker(path: string, returnTo = '/?view=settings'): void {
    if (typeof window === 'undefined') throw new Error('Secure sign-in requires a browser.');
    const target = new URL(brokerUrl(path), window.location.origin);
    target.searchParams.set('return', returnTo);
    window.location.assign(target.toString());
}

export function openSyncBrokerSession(returnTo = '/?view=settings'): void {
    navigateToSyncBroker('/session', returnTo);
}
