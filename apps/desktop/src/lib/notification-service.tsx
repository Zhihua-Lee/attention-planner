import {
    buildReminderNotificationBody,
    getDailyDigestSummary,
    getDigestSchedule,
    getProjectReviewReminderIntent,
    getTaskReminderPlan,
    type Language,
    type Task,
    getTranslationsSync,
    loadTranslations,
    loadStoredLanguageSync,
    getSystemDefaultLanguage,
} from '@mindwtr/core';
import { useTaskStore } from '@mindwtr/core';
import { isFlatpakRuntime, isTauriRuntime } from './runtime';
import { startPrivateWebPushScheduleSync } from './private-web-push';

const notifiedAtByTask = new Map<string, string>();
const repeatNotifiedByTask = new Map<string, string>();
const notifiedAtByProject = new Map<string, string>();
const digestSentOnByKind = new Map<'morning' | 'evening', string>();
let weeklyReviewSentOnDate: string | null = null;
let intervalId: number | null = null;
let storeSubscription: (() => void) | null = null;
let started = false;
let startPromise: Promise<void> | null = null;
let checkDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckAt = 0;
let stopPrivateWebPushSync: (() => void) | null = null;

type TauriNotificationApi = {
    sendNotification: (payload: { title: string; body?: string }) => void;
    isPermissionGranted?: () => Promise<boolean>;
    requestPermission?: () => Promise<unknown>;
};

let tauriNotificationApi: TauriNotificationApi | null = null;

const CHECK_INTERVAL_MS = 15_000;
const REPEAT_CATCH_UP_MS = CHECK_INTERVAL_MS;
/**
 * Picks the due-time repeat occurrence to fire on this poll tick, or null.
 *
 * Repeat occurrences are in the past (the due time already fired the single reminder), so they are
 * resolved here rather than via the future-only `getNextScheduledAt`. Only an occurrence reached
 * within the last poll window fires; one missed while the app was not polling is skipped, which is
 * how desktop repeats inherit the "only fires while the app is open" limitation. Dedup key embeds
 * the due ISO, so editing the due time invalidates prior-occurrence keys automatically.
 */
export function resolveDueRepeatToFire(
    task: Task,
    now: Date,
    alreadyNotifiedKey: string | undefined,
    options: { includeDueDate: boolean },
): { key: string; index: number } | null {
    const repeats = getTaskReminderPlan(task, now, {
        includeDueDate: options.includeDueDate,
    }).repeats;
    if (repeats.length === 0) return null;
    const nowMs = now.getTime();
    let chosen = null as (typeof repeats)[number] | null;
    for (const repeat of repeats) {
        const t = repeat.scheduledAt.getTime();
        if (t <= nowMs && nowMs - t <= REPEAT_CATCH_UP_MS) {
            chosen = repeat;
        }
    }
    if (!chosen || chosen.repeatIndex === undefined) return null;
    if (alreadyNotifiedKey === chosen.dedupeKey) return null;
    return { key: chosen.dedupeKey, index: chosen.repeatIndex };
}

function getCurrentLanguage(): Language {
    if (typeof localStorage === 'undefined') return 'en';
    return loadStoredLanguageSync(localStorage, getSystemDefaultLanguage());
}

function localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Moved to core (`buildReminderNotificationBody`) so mobile can share the same labelled,
// markdown-stripped body instead of showing raw description text (#reminder-schedule).
export const buildDesktopTaskNotificationBody = buildReminderNotificationBody;

async function loadTauriNotificationApi(): Promise<TauriNotificationApi | null> {
    if (!isTauriRuntime()) return null;
    if (tauriNotificationApi) return tauriNotificationApi;
    try {
        // Optional dependency. If unavailable, we fall back to Web Notifications.
        const mod = await import('@tauri-apps/plugin-notification');
        tauriNotificationApi = mod as unknown as TauriNotificationApi;
        return tauriNotificationApi;
    } catch {
        return null;
    }
}

async function ensurePermission() {
    const tauriApi = await loadTauriNotificationApi();
    if (tauriApi?.isPermissionGranted && tauriApi?.requestPermission) {
        try {
            const granted = await tauriApi.isPermissionGranted();
            if (!granted) {
                await tauriApi.requestPermission();
            }
            return;
        } catch {
            // Ignore and fall through to web notifications.
        }
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        const canPrompt =
            typeof navigator !== 'undefined'
            && 'userActivation' in navigator
            && (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive;
        if (!canPrompt) return;
        try {
            await Notification.requestPermission();
        } catch {
            // ignore
        }
    }
}

export async function requestDesktopNotificationPermission() {
    await ensurePermission();
    await loadTauriNotificationApi();
}

export async function sendDesktopImmediateNotification(title: string, body?: string) {
    const { settings } = useTaskStore.getState();
    if (settings.notificationsEnabled === false) return;
    await ensurePermission();
    await loadTauriNotificationApi();
    await sendNotification(title, body);
}

async function sendFlatpakPortalNotification(title: string, body?: string): Promise<boolean> {
    if (!isTauriRuntime() || !isFlatpakRuntime()) return false;

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('send_flatpak_notification', {
            title,
            body: body?.trim() ? body : undefined,
        });
        return true;
    } catch {
        return false;
    }
}

async function sendNotification(title: string, body?: string) {
    if (await sendFlatpakPortalNotification(title, body)) {
        return;
    }

    if (tauriNotificationApi?.sendNotification) {
        try {
            tauriNotificationApi.sendNotification({ title, body });
            return;
        } catch {
            // Fall back to Web Notifications below.
        }
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
            new Notification(title, body ? { body } : undefined);
        } catch {
            // ignore
        }
    }
}

function checkDueAndNotify() {
    const now = new Date();
    const { tasks, projects, settings } = useTaskStore.getState();

    if (settings.notificationsEnabled === false) return;

    const dateKey = localDateKey(now);
    const lang = getCurrentLanguage();
    void loadTranslations(lang);
    const tr = getTranslationsSync(lang);

    const includeStartTime = settings.startDateNotificationsEnabled !== false;
    const includeDueDate = settings.dueDateNotificationsEnabled !== false;
    const includeReviewAt = settings.reviewAtNotificationsEnabled !== false;
    tasks.forEach((task: Task) => {
        const plan = getTaskReminderPlan(task, now, {
            includeStartTime,
            includeDueDate,
            includeReviewAt,
        });
        const repeat = resolveDueRepeatToFire(task, now, repeatNotifiedByTask.get(task.id), { includeDueDate });
        if (repeat) {
            void sendNotification(task.title, buildDesktopTaskNotificationBody(task, 'due-repeat', tr));
            repeatNotifiedByTask.set(task.id, repeat.key);
        }

        const next = plan.next;
        if (!next) return;
        const diffMs = next.scheduledAt.getTime() - now.getTime();
        if (diffMs > CHECK_INTERVAL_MS) return;

        if (notifiedAtByTask.get(task.id) === next.dedupeKey) return;

        void sendNotification(task.title, buildDesktopTaskNotificationBody(task, next.kind, tr));
        notifiedAtByTask.set(task.id, next.dedupeKey);
    });

    if (includeReviewAt) {
        projects.forEach((project) => {
            const reminder = getProjectReviewReminderIntent(project, now);
            if (!reminder) return;
            const diffMs = reminder.scheduledAt.getTime() - now.getTime();
            if (diffMs > CHECK_INTERVAL_MS) return;
            if (notifiedAtByProject.get(project.id) === reminder.dedupeKey) return;
            void sendNotification(project.title, tr['review.projectsStep'] ?? 'Review project');
            notifiedAtByProject.set(project.id, reminder.dedupeKey);
        });
    }

    const digest = getDigestSchedule(settings);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    if (digest.morning.enabled) {
        const target = digest.morning.hour * 60 + digest.morning.minute;
        if (nowMinutes >= target && digestSentOnByKind.get('morning') !== dateKey) {
            const summary = getDailyDigestSummary(tasks, projects, now);
            const reviewDue = summary.reviewDueTasks + summary.reviewDueProjects;
            const hasAny =
                summary.dueToday > 0 || summary.overdue > 0 || summary.focusToday > 0 || reviewDue > 0;

            const body = hasAny
                ? [
                    `${tr['digest.dueToday']}: ${summary.dueToday}`,
                    `${tr['digest.overdue']}: ${summary.overdue}`,
                    `${tr['digest.focus']}: ${summary.focusToday}`,
                    `${tr['digest.reviewDue']}: ${reviewDue}`,
                ].join(' • ')
                : tr['digest.noItems'];

            void sendNotification(tr['digest.morningTitle'], body);
            digestSentOnByKind.set('morning', dateKey);
        }
    }

    if (digest.evening.enabled) {
        const target = digest.evening.hour * 60 + digest.evening.minute;
        if (nowMinutes >= target && digestSentOnByKind.get('evening') !== dateKey) {
            void sendNotification(tr['digest.eveningTitle'], tr['digest.eveningBody']);
            digestSentOnByKind.set('evening', dateKey);
        }
    }

    if (digest.weekly.enabled) {
        const target = digest.weekly.hour * 60 + digest.weekly.minute;
        if (now.getDay() === digest.weekly.day && nowMinutes >= target && weeklyReviewSentOnDate !== dateKey) {
            void sendNotification(tr['digest.weeklyReviewTitle'], tr['digest.weeklyReviewBody']);
            weeklyReviewSentOnDate = dateKey;
        }
    }
}

export async function startDesktopNotifications() {
    if (startPromise) {
        await startPromise;
        return;
    }
    if (started) return;
    startPromise = (async () => {
        started = true;
        try {
            await loadTranslations(getCurrentLanguage());
            await ensurePermission();
            await loadTauriNotificationApi();
        } catch (error) {
            started = false;
            throw error;
        }

        if (intervalId) clearInterval(intervalId);
        intervalId = window.setInterval(checkDueAndNotify, CHECK_INTERVAL_MS);
        checkDueAndNotify();

        // Re-check on data changes.
        storeSubscription?.();
        storeSubscription = useTaskStore.subscribe((state, prevState) => {
            if (state.lastDataChangeAt === prevState.lastDataChangeAt) return;
            if (checkDebounceTimer) {
                clearTimeout(checkDebounceTimer);
            }
            checkDebounceTimer = setTimeout(() => {
                const now = Date.now();
                if (now - lastCheckAt < 2_000) return;
                lastCheckAt = now;
                checkDueAndNotify();
            }, 750);
        });
        stopPrivateWebPushSync?.();
        stopPrivateWebPushSync = startPrivateWebPushScheduleSync();
    })();
    try {
        await startPromise;
    } finally {
        startPromise = null;
    }
}

export function stopDesktopNotifications() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }

    if (checkDebounceTimer) {
        clearTimeout(checkDebounceTimer);
        checkDebounceTimer = null;
    }

    storeSubscription?.();
    storeSubscription = null;
    stopPrivateWebPushSync?.();
    stopPrivateWebPushSync = null;

    notifiedAtByTask.clear();
    repeatNotifiedByTask.clear();
    notifiedAtByProject.clear();
    digestSentOnByKind.clear();
    weeklyReviewSentOnDate = null;
    started = false;
}
