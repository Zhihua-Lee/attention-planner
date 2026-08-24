import {
    buildReminderSchedule,
    getSystemDefaultLanguage,
    getTranslationsSync,
    loadStoredLanguageSync,
    loadTranslations,
    useTaskStore,
} from '@mindwtr/core';

import { isTauriRuntime } from './runtime';
import {
    isSyncBrokerConfigured,
    openSyncBrokerSession,
    syncBrokerJson,
} from './sync-broker-client';

const DEVICE_ID_KEY = 'attention-planner:web-push:device-id:v1';
const RECURRING_HORIZON_DAYS = 90;
const MAX_ONE_SHOT_REMINDERS = 300;

export type PrivateWebPushState = {
    configured: boolean;
    permission: NotificationPermission | 'unsupported';
    subscribed: boolean;
    supported: boolean;
};

type PushConfigResponse = { vapidPublicKey: string };
type PrivateReminder = { id: string; fireAt: number };

function supported(): boolean {
    return !isTauriRuntime()
        && typeof window !== 'undefined'
        && typeof navigator !== 'undefined'
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && typeof Notification !== 'undefined';
}

function getDeviceId(): string {
    const existing = localStorage.getItem(DEVICE_ID_KEY)?.trim();
    if (existing && /^[A-Za-z0-9_-]{20,80}$/.test(existing)) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
}

function base64UrlToBytes(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
        + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function opaqueReminderId(deviceId: string, key: string, fireAt: number): Promise<string> {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${deviceId}\u0000${key}\u0000${fireAt}`),
    );
    return base64UrlEncode(new Uint8Array(digest).slice(0, 18));
}

function expandFireTimes(
    fireAt: Date,
    repeatInterval: 'daily' | 'weekly' | undefined,
    horizon: Date,
): Date[] {
    const times: Date[] = [];
    const cursor = new Date(fireAt);
    while (cursor <= horizon) {
        times.push(new Date(cursor));
        if (!repeatInterval) break;
        cursor.setDate(cursor.getDate() + (repeatInterval === 'daily' ? 1 : 7));
    }
    return times;
}

async function buildPrivateReminderList(deviceId: string): Promise<PrivateReminder[]> {
    const { projects, settings, tasks } = useTaskStore.getState();
    const now = new Date();
    const language = typeof localStorage === 'undefined'
        ? getSystemDefaultLanguage()
        : loadStoredLanguageSync(localStorage, getSystemDefaultLanguage());
    await loadTranslations(language);
    const schedule = buildReminderSchedule({
        maxOneShotReminders: MAX_ONE_SHOT_REMINDERS,
        now,
        projects,
        settings,
        tasks,
        translations: getTranslationsSync(language),
    });
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + RECURRING_HORIZON_DAYS);
    const reminders: PrivateReminder[] = [];
    for (const request of schedule.requests) {
        for (const fireAt of expandFireTimes(request.fireAt, request.repeatInterval, horizon)) {
            if (fireAt <= now) continue;
            reminders.push({
                fireAt: fireAt.getTime(),
                id: await opaqueReminderId(deviceId, request.key, fireAt.getTime()),
            });
        }
    }
    return reminders.sort((left, right) => left.fireAt - right.fireAt);
}

async function currentSubscription(): Promise<PushSubscription | null> {
    if (!supported()) return null;
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
}

async function syncSubscription(subscription: PushSubscription): Promise<void> {
    const deviceId = getDeviceId();
    await syncBrokerJson('/push/sync', {
        body: JSON.stringify({
            deviceId,
            reminders: await buildPrivateReminderList(deviceId),
            subscription: subscription.toJSON(),
        }),
        method: 'POST',
    });
}

export async function getPrivateWebPushState(): Promise<PrivateWebPushState> {
    const isSupported = supported();
    return {
        configured: isSyncBrokerConfigured(),
        permission: isSupported ? Notification.permission : 'unsupported',
        subscribed: Boolean(isSupported && await currentSubscription()),
        supported: isSupported,
    };
}

export async function enablePrivateWebPushNotifications(): Promise<PrivateWebPushState> {
    if (!isSyncBrokerConfigured()) throw new Error('The secure notification broker is not configured.');
    if (!supported()) {
        throw new Error('On iPhone, add this site to the Home Screen first, then open the installed app.');
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted.');
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
        const { vapidPublicKey } = await syncBrokerJson<PushConfigResponse>('/push/config');
        subscription = await registration.pushManager.subscribe({
            applicationServerKey: base64UrlToBytes(vapidPublicKey) as BufferSource,
            userVisibleOnly: true,
        });
    }
    await syncSubscription(subscription);
    return getPrivateWebPushState();
}

export async function disablePrivateWebPushNotifications(): Promise<PrivateWebPushState> {
    const subscription = await currentSubscription();
    if (subscription) await subscription.unsubscribe();
    if (isSyncBrokerConfigured()) {
        await syncBrokerJson('/push/unsubscribe', {
            body: JSON.stringify({ deviceId: getDeviceId() }),
            method: 'POST',
        });
    }
    return getPrivateWebPushState();
}

export async function syncPrivateWebPushSchedule(): Promise<void> {
    if (!isSyncBrokerConfigured()) return;
    const subscription = await currentSubscription();
    if (!subscription) return;
    await syncSubscription(subscription);
}

export async function sendPrivateWebPushTest(): Promise<void> {
    if (!await currentSubscription()) throw new Error('Enable Web Push on this device first.');
    await syncBrokerJson('/push/test', {
        body: JSON.stringify({ deviceId: getDeviceId() }),
        method: 'POST',
    });
}

export function openPrivateWebPushBrokerSession(): void {
    openSyncBrokerSession('/?view=settings');
}

export function startPrivateWebPushScheduleSync(): () => void {
    if (!supported() || !isSyncBrokerConfigured()) return () => undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queue = (delay = 1_000) => {
        if (stopped) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            void syncPrivateWebPushSchedule().catch(() => undefined);
        }, delay);
    };
    const unsubscribe = useTaskStore.subscribe((state, previous) => {
        if (state.lastDataChangeAt !== previous.lastDataChangeAt) queue();
    });
    const onOnline = () => queue(250);
    const onVisibility = () => {
        if (document.visibilityState === 'visible') queue(250);
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    queue(250);
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        unsubscribe();
        window.removeEventListener('online', onOnline);
        document.removeEventListener('visibilitychange', onVisibility);
    };
}
