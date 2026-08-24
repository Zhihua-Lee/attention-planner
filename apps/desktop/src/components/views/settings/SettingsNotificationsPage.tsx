import { useEffect, useState } from 'react';
import type { AppData } from '@mindwtr/core';

import { reportError } from '../../../lib/report-error';
import { requestDesktopNotificationPermission } from '../../../lib/notification-service';
import {
    disablePrivateWebPushNotifications,
    enablePrivateWebPushNotifications,
    getPrivateWebPushState,
    openPrivateWebPushBrokerSession,
    sendPrivateWebPushTest,
    type PrivateWebPushState,
} from '../../../lib/private-web-push';
import { Switch } from '../../ui/Switch';

type Labels = {
    notificationsDesc: string;
    notificationsEnable: string;
    startDateNotifications: string;
    startDateNotificationsDesc: string;
    dueDateNotifications: string;
    dueDateNotificationsDesc: string;
    reviewAtNotifications: string;
    reviewAtNotificationsDesc: string;
    weeklyReview: string;
    weeklyReviewDesc: string;
    weeklyReviewDay: string;
    weeklyReviewTime: string;
    dailyDigest: string;
    dailyDigestDesc: string;
    dailyDigestMorning: string;
    dailyDigestEvening: string;
};

type WeekdayOption = { value: number; label: string };

export type SettingsNotificationsPageProps = {
    t: Labels;
    notificationsEnabled: boolean;
    startDateNotificationsEnabled: boolean;
    dueDateNotificationsEnabled: boolean;
    reviewAtNotificationsEnabled: boolean;
    weeklyReviewEnabled: boolean;
    weeklyReviewDay: number;
    weeklyReviewTime: string;
    weekdayOptions: WeekdayOption[];
    dailyDigestMorningEnabled: boolean;
    dailyDigestEveningEnabled: boolean;
    dailyDigestMorningTime: string;
    dailyDigestEveningTime: string;
    updateSettings: (updates: Partial<AppData['settings']>) => Promise<void>;
    showSaved: () => void;
};

export function SettingsNotificationsPage({
    t,
    notificationsEnabled,
    startDateNotificationsEnabled,
    dueDateNotificationsEnabled,
    reviewAtNotificationsEnabled,
    weeklyReviewEnabled,
    weeklyReviewDay,
    weeklyReviewTime,
    weekdayOptions,
    dailyDigestMorningEnabled,
    dailyDigestEveningEnabled,
    dailyDigestMorningTime,
    dailyDigestEveningTime,
    updateSettings,
    showSaved,
}: SettingsNotificationsPageProps) {
    const [webPushState, setWebPushState] = useState<PrivateWebPushState | null>(null);
    const [webPushBusy, setWebPushBusy] = useState(false);
    const [webPushError, setWebPushError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void getPrivateWebPushState()
            .then((state) => { if (!cancelled) setWebPushState(state); })
            .catch((error) => reportError('Failed to inspect Web Push state', error));
        return () => { cancelled = true; };
    }, []);

    const handleWebPushToggle = async () => {
        setWebPushBusy(true);
        setWebPushError(null);
        try {
            setWebPushState(webPushState?.subscribed
                ? await disablePrivateWebPushNotifications()
                : await enablePrivateWebPushNotifications());
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Web Push setup failed.';
            setWebPushError(message);
            reportError('Failed to update Web Push subscription', error);
        } finally {
            setWebPushBusy(false);
        }
    };

    const handleWebPushTest = async () => {
        setWebPushBusy(true);
        setWebPushError(null);
        try {
            await sendPrivateWebPushTest();
            showSaved();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Test notification failed.';
            setWebPushError(message);
            reportError('Failed to send Web Push test', error);
        } finally {
            setWebPushBusy(false);
        }
    };

    const handleUpdate = async (updates: Partial<AppData['settings']>) => {
        if (updates.notificationsEnabled === true) {
            try {
                await requestDesktopNotificationPermission();
            } catch (error) {
                reportError('Failed to request notification permission', error);
            }
        }
        updateSettings(updates)
            .then(showSaved)
            .catch((error) => reportError('Failed to update notification settings', error));
    };

    return (
        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
            <p className="text-sm text-muted-foreground">{t.notificationsDesc}</p>

            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-medium">{t.notificationsEnable}</p>
                </div>
                <Switch
                    checked={notificationsEnabled}
                    onCheckedChange={(checked) => handleUpdate({ notificationsEnabled: checked })}
                    aria-label={t.notificationsEnable}
                />
            </div>

            {webPushState?.configured && (
                <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
                    <div>
                        <p className="text-sm font-medium">iPhone 后台推送</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            关闭 PWA 或锁屏后仍可收到提醒。服务器只保存推送端点、提醒时间和不可逆 ID，不保存任务标题或正文。
                        </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        状态：{webPushState.subscribed
                            ? '此设备已启用'
                            : webPushState.supported
                                ? '此设备尚未启用'
                                : '请先在 iPhone Safari 中“添加到主屏幕”，再从主屏幕打开应用'}
                    </p>
                    {webPushError && <p className="text-xs text-destructive">{webPushError}</p>}
                    <div className="flex flex-wrap justify-end gap-2">
                        {webPushError?.includes('Cloudflare Access') && (
                            <button
                                type="button"
                                onClick={() => openPrivateWebPushBrokerSession()}
                                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90"
                            >
                                安全登录
                            </button>
                        )}
                        {webPushState.subscribed && (
                            <button
                                type="button"
                                onClick={() => void handleWebPushTest()}
                                disabled={webPushBusy}
                                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                发送测试通知
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => void handleWebPushToggle()}
                            disabled={webPushBusy || !notificationsEnabled || (!webPushState.supported && !webPushState.subscribed)}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {webPushBusy ? '处理中…' : webPushState.subscribed ? '关闭此设备推送' : '启用此设备推送'}
                        </button>
                    </div>
                </div>
            )}

            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-medium">{t.startDateNotifications}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t.startDateNotificationsDesc}</p>
                </div>
                <Switch
                    checked={startDateNotificationsEnabled}
                    onCheckedChange={(checked) => handleUpdate({ startDateNotificationsEnabled: checked })}
                    aria-label={t.startDateNotifications}
                    disabled={!notificationsEnabled}
                />
            </div>

            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-medium">{t.dueDateNotifications}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t.dueDateNotificationsDesc}</p>
                </div>
                <Switch
                    checked={dueDateNotificationsEnabled}
                    onCheckedChange={(checked) => handleUpdate({ dueDateNotificationsEnabled: checked })}
                    aria-label={t.dueDateNotifications}
                    disabled={!notificationsEnabled}
                />
            </div>

            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-medium">{t.reviewAtNotifications}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t.reviewAtNotificationsDesc}</p>
                </div>
                <Switch
                    checked={reviewAtNotificationsEnabled}
                    onCheckedChange={(checked) => handleUpdate({ reviewAtNotificationsEnabled: checked })}
                    aria-label={t.reviewAtNotifications}
                    disabled={!notificationsEnabled}
                />
            </div>

            <div className="border-t border-border/50"></div>

            <div className="space-y-3">
                <div>
                    <p className="text-sm font-medium">{t.weeklyReview}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t.weeklyReviewDesc}</p>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-medium">{t.weeklyReview}</div>
                    <Switch
                        checked={weeklyReviewEnabled}
                        onCheckedChange={(checked) => handleUpdate({ weeklyReviewEnabled: checked })}
                        aria-label={t.weeklyReview}
                        disabled={!notificationsEnabled}
                    />
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-medium">{t.weeklyReviewDay}</div>
                    <select
                        aria-label={t.weeklyReviewDay}
                        value={weeklyReviewDay}
                        disabled={!notificationsEnabled || !weeklyReviewEnabled}
                        onChange={(e) => handleUpdate({ weeklyReviewDay: Number(e.target.value) })}
                        className="bg-muted px-2 py-1 rounded text-sm border border-border disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {weekdayOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-medium">{t.weeklyReviewTime}</div>
                    <input
                        type="time"
                        aria-label={t.weeklyReviewTime}
                        value={weeklyReviewTime}
                        disabled={!notificationsEnabled || !weeklyReviewEnabled}
                        onChange={(e) => handleUpdate({ weeklyReviewTime: e.target.value })}
                        className="bg-muted px-2 py-1 rounded text-sm border border-border disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                </div>
            </div>

            <div className="border-t border-border/50"></div>

            <div className="space-y-3">
                <div>
                    <p className="text-sm font-medium">{t.dailyDigest}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t.dailyDigestDesc}</p>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-medium">{t.dailyDigestMorning}</div>
                    <div className="flex items-center gap-3">
                        <input
                            type="time"
                            aria-label={t.dailyDigestMorning}
                            value={dailyDigestMorningTime}
                            disabled={!notificationsEnabled || !dailyDigestMorningEnabled}
                            onChange={(e) => handleUpdate({ dailyDigestMorningTime: e.target.value })}
                            className="bg-muted px-2 py-1 rounded text-sm border border-border disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <Switch
                            checked={dailyDigestMorningEnabled}
                            onCheckedChange={(checked) => handleUpdate({ dailyDigestMorningEnabled: checked })}
                            aria-label={t.dailyDigestMorning}
                            disabled={!notificationsEnabled}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-medium">{t.dailyDigestEvening}</div>
                    <div className="flex items-center gap-3">
                        <input
                            type="time"
                            aria-label={t.dailyDigestEvening}
                            value={dailyDigestEveningTime}
                            disabled={!notificationsEnabled || !dailyDigestEveningEnabled}
                            onChange={(e) => handleUpdate({ dailyDigestEveningTime: e.target.value })}
                            className="bg-muted px-2 py-1 rounded text-sm border border-border disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <Switch
                            checked={dailyDigestEveningEnabled}
                            onCheckedChange={(checked) => handleUpdate({ dailyDigestEveningEnabled: checked })}
                            aria-label={t.dailyDigestEvening}
                            disabled={!notificationsEnabled}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
