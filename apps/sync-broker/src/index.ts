import webpush, { type PushSubscription } from 'web-push';

const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SESSION_COOKIE = 'attention_planner_session';
const SESSION_TTL_SECONDS = 180 * 24 * 60 * 60;
const MAX_REMINDERS = 750;
const MAX_REMINDER_HORIZON_MS = 366 * 24 * 60 * 60 * 1000;
const GENERIC_NOTIFICATION = {
    title: 'Attention Planner',
    body: '你有一个到期提醒',
    icon: '/icon.png',
    badge: '/icon.png',
    url: '/?view=now',
};

interface Env {
    USER_VAULTS: DurableObjectNamespace;
    NOTIFICATION_DEVICES: DurableObjectNamespace;
    PUBLIC_ORIGIN: string;
    GOOGLE_REDIRECT_URI: string;
    VAPID_SUBJECT: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    ALLOWED_EMAIL: string;
    TOKEN_ENCRYPTION_KEY: string;
    VAPID_PUBLIC_KEY: string;
    VAPID_PRIVATE_KEY: string;
    LOCAL_DEV_EMAIL?: string;
    LOCAL_DEV_TOKEN?: string;
}

type StoredOAuthState = {
    codeVerifier: string;
    state: string;
    returnTo: string;
    expiresAt: number;
};

type DeviceReminder = {
    id: string;
    fireAt: number;
};

type DeviceConfig = {
    subscription: PushSubscription;
    reminders: DeviceReminder[];
    updatedAt: number;
};

type AlarmInfo = { isRetry?: boolean; retryCount?: number };

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}

function errorJson(message: string, status: number): Response {
    return json({ error: message }, status);
}

function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
        + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBase64Url(length = 32): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Base64Url(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return base64UrlEncode(new Uint8Array(digest));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
    let raw: Uint8Array;
    try {
        raw = base64UrlDecode(secret.trim());
    } catch {
        throw new Error('TOKEN_ENCRYPTION_KEY is not valid base64url');
    }
    if (raw.byteLength !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
    return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptText(value: string, secret: string): Promise<string> {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        await encryptionKey(secret),
        new TextEncoder().encode(value) as BufferSource,
    );
    return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

async function decryptText(value: string, secret: string): Promise<string> {
    const [ivValue, encryptedValue] = value.split('.');
    if (!ivValue || !encryptedValue) throw new Error('Stored token is malformed');
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64UrlDecode(ivValue) as BufferSource },
        await encryptionKey(secret),
        base64UrlDecode(encryptedValue) as BufferSource,
    );
    return new TextDecoder().decode(decrypted);
}

function normalizeEmail(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase();
}

function sanitizeReturnTo(value: string | null): string {
    const fallback = '/?view=settings';
    if (!value || value.length > 500 || !value.startsWith('/') || value.startsWith('//')) return fallback;
    if (/[\r\n]/.test(value)) return fallback;
    return value;
}

function assertSameOrigin(request: Request, env: Env): Response | null {
    return request.headers.get('Origin') === env.PUBLIC_ORIGIN
        ? null
        : errorJson('Cross-origin request rejected', 403);
}

function requestCookie(request: Request, name: string): string | null {
    for (const part of (request.headers.get('Cookie') || '').split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
        return part.slice(separator + 1).trim() || null;
    }
    return null;
}

async function createSessionToken(email: string, secret: string, now = Date.now()): Promise<string> {
    return encryptText(JSON.stringify({ email: normalizeEmail(email), exp: now + SESSION_TTL_SECONDS * 1_000, v: 1 }), secret);
}

async function readSessionToken(value: string, secret: string, now = Date.now()): Promise<string | null> {
    try {
        const payload = JSON.parse(await decryptText(value, secret)) as { email?: unknown; exp?: unknown; v?: unknown };
        if (payload.v !== 1 || typeof payload.exp !== 'number' || payload.exp <= now) return null;
        const email = normalizeEmail(typeof payload.email === 'string' ? payload.email : '');
        return email || null;
    } catch {
        return null;
    }
}

function sessionCookie(value: string): string {
    return `${SESSION_COOKIE}=${value}; Path=/api; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

async function authenticatedEmail(
    request: Request,
    env: Env,
): Promise<string | null> {
    const url = new URL(request.url);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    let email = '';
    if (
        isLocal
        && env.LOCAL_DEV_EMAIL
        && env.LOCAL_DEV_TOKEN
        && request.headers.get('X-Local-Dev-Token') === env.LOCAL_DEV_TOKEN
    ) {
        email = normalizeEmail(env.LOCAL_DEV_EMAIL);
    } else {
        const session = requestCookie(request, SESSION_COOKIE);
        if (session) email = normalizeEmail(await readSessionToken(session, env.TOKEN_ENCRYPTION_KEY));
    }
    const allowed = normalizeEmail(env.ALLOWED_EMAIL);
    if (!allowed || !email || email !== allowed) return null;
    return email;
}

async function readJson<T>(request: Request): Promise<T> {
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
        throw new Error('Expected application/json');
    }
    return request.json<T>();
}

function validateDeviceId(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(value)) {
        throw new Error('Invalid device ID');
    }
    return value;
}

function validateSubscription(value: unknown): PushSubscription {
    const candidate = value as Partial<PushSubscription> | null;
    const keys = candidate?.keys as Record<string, unknown> | undefined;
    if (
        !candidate
        || typeof candidate.endpoint !== 'string'
        || candidate.endpoint.length > 2048
        || !candidate.endpoint.startsWith('https://')
        || typeof keys?.p256dh !== 'string'
        || typeof keys?.auth !== 'string'
    ) {
        throw new Error('Invalid push subscription');
    }
    return {
        endpoint: candidate.endpoint,
        expirationTime: typeof candidate.expirationTime === 'number' ? candidate.expirationTime : null,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
    };
}

function validateReminders(value: unknown): DeviceReminder[] {
    if (!Array.isArray(value) || value.length > MAX_REMINDERS) throw new Error('Invalid reminder list');
    const now = Date.now();
    const unique = new Map<string, DeviceReminder>();
    for (const item of value) {
        const candidate = item as Partial<DeviceReminder> | null;
        if (
            !candidate
            || typeof candidate.id !== 'string'
            || !/^[A-Za-z0-9_-]{16,64}$/.test(candidate.id)
            || typeof candidate.fireAt !== 'number'
            || !Number.isFinite(candidate.fireAt)
            || candidate.fireAt < now - 5 * 60_000
            || candidate.fireAt > now + MAX_REMINDER_HORIZON_MS
        ) {
            throw new Error('Invalid reminder');
        }
        unique.set(candidate.id, { id: candidate.id, fireAt: Math.trunc(candidate.fireAt) });
    }
    return [...unique.values()].sort((left, right) => left.fireAt - right.fireAt);
}

function vaultStub(env: Env, email: string): DurableObjectStub {
    return env.USER_VAULTS.get(env.USER_VAULTS.idFromName(email));
}

async function oauthStateStub(env: Env, state: string): Promise<DurableObjectStub> {
    return env.USER_VAULTS.get(env.USER_VAULTS.idFromName(`oauth-state:${await sha256Hex(state)}`));
}

async function oauthStateRequest(
    env: Env,
    state: string,
    path: string,
    init?: RequestInit,
): Promise<Response> {
    return (await oauthStateStub(env, state)).fetch(new Request(`https://state.internal${path}`, init));
}

async function vaultRequest(
    env: Env,
    email: string,
    path: string,
    init?: RequestInit,
): Promise<Response> {
    return vaultStub(env, email).fetch(new Request(`https://vault.internal${path}`, init));
}

async function startGoogleOAuth(env: Env, request: Request): Promise<Response> {
    const state = randomBase64Url();
    const codeVerifier = randomBase64Url(64);
    const returnTo = sanitizeReturnTo(new URL(request.url).searchParams.get('return'));
    await oauthStateRequest(env, state, '/state', {
        body: JSON.stringify({ codeVerifier, state, returnTo, expiresAt: Date.now() + 10 * 60_000 }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });
    const params = new URLSearchParams({
        access_type: 'offline',
        client_id: env.GOOGLE_CLIENT_ID,
        code_challenge: await sha256Base64Url(codeVerifier),
        code_challenge_method: 'S256',
        include_granted_scopes: 'false',
        prompt: 'consent',
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        response_type: 'code',
        scope: GOOGLE_SCOPE,
        state,
    });
    return Response.redirect(`${GOOGLE_AUTH_URL}?${params}`, 302);
}

async function exchangeGoogleCode(
    env: Env,
    code: string,
    codeVerifier: string,
): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            code,
            code_verifier: codeVerifier,
            grant_type: 'authorization_code',
            redirect_uri: env.GOOGLE_REDIRECT_URI,
        }),
    });
    const payload = await response.json<{ access_token?: string; refresh_token?: string; error?: string }>();
    if (!response.ok || !payload.access_token || !payload.refresh_token) {
        throw new Error(payload.error || 'Google did not return an offline refresh token');
    }
    return { accessToken: payload.access_token, refreshToken: payload.refresh_token };
}

async function identifyGoogleUser(accessToken: string): Promise<string | null> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json<{ email?: string; email_verified?: boolean }>();
    if (!response.ok || payload.email_verified !== true) return null;
    return normalizeEmail(payload.email);
}

async function finishGoogleOAuth(env: Env, request: Request): Promise<Response> {
    const url = new URL(request.url);
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    if (!state || !code || url.searchParams.has('error')) {
        return Response.redirect(`${env.PUBLIC_ORIGIN}/?view=settings&google=denied`, 302);
    }
    const stateResponse = await oauthStateRequest(env, state, '/state/consume', {
        body: JSON.stringify({ state }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });
    if (!stateResponse.ok) return errorJson('OAuth state is invalid or expired', 400);
    const { codeVerifier, returnTo } = await stateResponse.json<{ codeVerifier: string; returnTo: string }>();
    const { accessToken, refreshToken } = await exchangeGoogleCode(env, code, codeVerifier);
    const email = await identifyGoogleUser(accessToken);
    if (!email || email !== normalizeEmail(env.ALLOWED_EMAIL)) {
        await fetch(GOOGLE_REVOKE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: refreshToken }),
        }).catch(() => undefined);
        return errorJson('This Google account is not authorized', 403);
    }
    await vaultRequest(env, email, '/token', {
        body: await encryptText(refreshToken, env.TOKEN_ENCRYPTION_KEY),
        method: 'PUT',
    });
    const separator = returnTo.includes('?') ? '&' : '?';
    return new Response(null, {
        status: 302,
        headers: {
            'Cache-Control': 'no-store',
            Location: `${env.PUBLIC_ORIGIN}${returnTo}${separator}google=connected`,
            'Referrer-Policy': 'no-referrer',
            'Set-Cookie': sessionCookie(await createSessionToken(email, env.TOKEN_ENCRYPTION_KEY)),
        },
    });
}

async function getEncryptedRefreshToken(env: Env, email: string): Promise<string | null> {
    const response = await vaultRequest(env, email, '/token');
    return response.status === 404 ? null : response.text();
}

async function issueGoogleAccessToken(env: Env, email: string): Promise<Response> {
    const encrypted = await getEncryptedRefreshToken(env, email);
    if (!encrypted) return errorJson('Google Drive is not connected', 401);
    const refreshToken = await decryptText(encrypted, env.TOKEN_ENCRYPTION_KEY);
    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });
    const payload = await response.json<{
        access_token?: string;
        error?: string;
        expires_in?: number;
        scope?: string;
        token_type?: string;
    }>();
    if (!response.ok || !payload.access_token) {
        if (payload.error === 'invalid_grant') {
            await vaultRequest(env, email, '/token', { method: 'DELETE' });
        }
        return errorJson('Google authorization must be renewed', 401);
    }
    return json({
        accessToken: payload.access_token,
        expiresIn: Number(payload.expires_in) || 3600,
        scope: payload.scope || GOOGLE_SCOPE,
        tokenType: payload.token_type || 'Bearer',
    });
}

async function disconnectGoogle(env: Env, email: string): Promise<Response> {
    const encrypted = await getEncryptedRefreshToken(env, email);
    if (encrypted) {
        const refreshToken = await decryptText(encrypted, env.TOKEN_ENCRYPTION_KEY);
        await fetch(GOOGLE_REVOKE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: refreshToken }),
        }).catch(() => undefined);
    }
    await vaultRequest(env, email, '/token', { method: 'DELETE' });
    return json({ connected: false });
}

async function notificationStub(env: Env, email: string, deviceId: string): Promise<DurableObjectStub> {
    const ownerKey = (await sha256Hex(email)).slice(0, 32);
    const id = env.NOTIFICATION_DEVICES.idFromName(`${ownerKey}:${deviceId}`);
    return env.NOTIFICATION_DEVICES.get(id);
}

async function syncPushDevice(env: Env, email: string, request: Request): Promise<Response> {
    const input = await readJson<{ deviceId?: unknown; reminders?: unknown; subscription?: unknown }>(request);
    const deviceId = validateDeviceId(input.deviceId);
    const subscription = validateSubscription(input.subscription);
    const reminders = validateReminders(input.reminders);
    const stub = await notificationStub(env, email, deviceId);
    return stub.fetch(new Request('https://device.internal/sync', {
        body: JSON.stringify({ reminders, subscription }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    }));
}

async function deletePushDevice(env: Env, email: string, request: Request): Promise<Response> {
    const input = await readJson<{ deviceId?: unknown }>(request);
    const stub = await notificationStub(env, email, validateDeviceId(input.deviceId));
    return stub.fetch(new Request('https://device.internal/', { method: 'DELETE' }));
}

async function testPushDevice(env: Env, email: string, request: Request): Promise<Response> {
    const input = await readJson<{ deviceId?: unknown }>(request);
    const stub = await notificationStub(env, email, validateDeviceId(input.deviceId));
    return stub.fetch(new Request('https://device.internal/test', { method: 'POST' }));
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '') || '/';

    if (request.method === 'GET' && (path === '/session' || path === '/google/connect')) {
        return startGoogleOAuth(env, request);
    }
    if (request.method === 'GET' && path === '/google/callback') {
        return finishGoogleOAuth(env, request);
    }

    const email = await authenticatedEmail(request, env);
    if (!email) return errorJson('Secure Google sign-in required', 403);
    if (request.method === 'GET' && path === '/health') {
        return json({ authenticated: true, oauth: true, push: true });
    }
    if (request.method === 'GET' && path === '/google/status') {
        return json({ connected: Boolean(await getEncryptedRefreshToken(env, email)), persistent: true });
    }

    if (request.method === 'POST') {
        const originError = assertSameOrigin(request, env);
        if (originError) return originError;
    }
    if (request.method === 'POST' && path === '/google/token') {
        return issueGoogleAccessToken(env, email);
    }
    if (request.method === 'POST' && path === '/google/disconnect') {
        return disconnectGoogle(env, email);
    }
    if (request.method === 'GET' && path === '/push/config') {
        return json({
            privacy: 'Only the push endpoint, opaque reminder IDs, and reminder times are stored.',
            vapidPublicKey: env.VAPID_PUBLIC_KEY,
        });
    }
    if (request.method === 'POST' && path === '/push/sync') {
        return syncPushDevice(env, email, request);
    }
    if (request.method === 'POST' && path === '/push/test') {
        return testPushDevice(env, email, request);
    }
    if (request.method === 'POST' && path === '/push/unsubscribe') {
        return deletePushDevice(env, email, request);
    }
    return errorJson('Not found', 404);
}

export class UserVault {
    constructor(private readonly state: DurableObjectState) {}

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === 'POST' && url.pathname === '/state') {
            const value = await request.json<StoredOAuthState>();
            await this.state.storage.put('oauth-state', value);
            return json({ stored: true });
        }
        if (request.method === 'POST' && url.pathname === '/state/consume') {
            const input = await request.json<{ state?: string }>();
            const stored = await this.state.storage.get<StoredOAuthState>('oauth-state');
            await this.state.storage.delete('oauth-state');
            if (!stored || stored.expiresAt < Date.now() || !input.state || input.state !== stored.state) {
                return errorJson('Invalid state', 400);
            }
            return json({ codeVerifier: stored.codeVerifier, returnTo: stored.returnTo });
        }
        if (url.pathname === '/token' && request.method === 'PUT') {
            await this.state.storage.put('refresh-token', await request.text());
            return json({ stored: true });
        }
        if (url.pathname === '/token' && request.method === 'GET') {
            const value = await this.state.storage.get<string>('refresh-token');
            return value ? new Response(value, { headers: { 'Cache-Control': 'no-store' } }) : new Response(null, { status: 404 });
        }
        if (url.pathname === '/token' && request.method === 'DELETE') {
            await this.state.storage.delete('refresh-token');
            return json({ deleted: true });
        }
        return errorJson('Not found', 404);
    }
}

export class NotificationDevice {
    constructor(
        private readonly state: DurableObjectState,
        private readonly env: Env,
    ) {}

    private async scheduleNext(config: DeviceConfig): Promise<void> {
        const next = config.reminders[0]?.fireAt;
        if (next === undefined) {
            await this.state.storage.deleteAlarm();
            return;
        }
        await this.state.storage.setAlarm(Math.max(Date.now() + 100, next));
    }

    async fetch(request: Request): Promise<Response> {
        const path = new URL(request.url).pathname;
        if (request.method === 'POST' && path === '/sync') {
            const input = await request.json<{ reminders: DeviceReminder[]; subscription: PushSubscription }>();
            const config: DeviceConfig = {
                reminders: validateReminders(input.reminders),
                subscription: validateSubscription(input.subscription),
                updatedAt: Date.now(),
            };
            await this.state.storage.put('config', config);
            await this.scheduleNext(config);
            return json({ reminderCount: config.reminders.length, scheduled: true });
        }
        if (request.method === 'POST' && path === '/test') {
            const config = await this.state.storage.get<DeviceConfig>('config');
            if (!config) return errorJson('Push is not enabled for this device', 409);
            const fireAt = Date.now() + 5_000;
            const nextConfig: DeviceConfig = {
                ...config,
                reminders: [...config.reminders, { id: `test_${randomBase64Url(18)}`, fireAt }]
                    .sort((left, right) => left.fireAt - right.fireAt),
                updatedAt: Date.now(),
            };
            await this.state.storage.put('config', nextConfig);
            await this.scheduleNext(nextConfig);
            return json({ scheduled: true, fireAt });
        }
        if (request.method === 'DELETE') {
            await this.state.storage.deleteAlarm();
            await this.state.storage.deleteAll();
            return json({ deleted: true });
        }
        return errorJson('Not found', 404);
    }

    async alarm(alarmInfo?: AlarmInfo): Promise<void> {
        const config = await this.state.storage.get<DeviceConfig>('config');
        if (!config) return;
        const now = Date.now();
        const due = config.reminders.filter((reminder) => reminder.fireAt <= now + 1_000);
        if (due.length === 0) {
            await this.scheduleNext(config);
            return;
        }
        const payload = JSON.stringify({
            body: GENERIC_NOTIFICATION.body,
            data: { url: GENERIC_NOTIFICATION.url },
            icon: GENERIC_NOTIFICATION.icon,
            badge: GENERIC_NOTIFICATION.badge,
            tag: due[0].id,
            title: GENERIC_NOTIFICATION.title,
        });
        try {
            await webpush.sendNotification(config.subscription, payload, {
                TTL: 60 * 60,
                urgency: 'high',
                vapidDetails: {
                    privateKey: this.env.VAPID_PRIVATE_KEY,
                    publicKey: this.env.VAPID_PUBLIC_KEY,
                    subject: this.env.VAPID_SUBJECT,
                },
            });
        } catch (error) {
            const statusCode = (error as { statusCode?: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
                await this.state.storage.deleteAll();
                return;
            }
            if ((alarmInfo?.retryCount ?? 0) >= 5) {
                await this.state.storage.setAlarm(Date.now() + 5 * 60_000);
                return;
            }
            throw error;
        }
        const dueIds = new Set(due.map((reminder) => reminder.id));
        const nextConfig = {
            ...config,
            reminders: config.reminders.filter((reminder) => !dueIds.has(reminder.id)),
        };
        await this.state.storage.put('config', nextConfig);
        await this.scheduleNext(nextConfig);
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        try {
            return await handleRequest(request, env);
        } catch (error) {
            console.error('Broker request failed', error instanceof Error ? error.message : 'Unknown error');
            return errorJson('Request failed', 500);
        }
    },
};

export const __brokerTestUtils = {
    createSessionToken,
    decryptText,
    encryptText,
    readSessionToken,
    sanitizeReturnTo,
    validateReminders,
    validateSubscription,
};
