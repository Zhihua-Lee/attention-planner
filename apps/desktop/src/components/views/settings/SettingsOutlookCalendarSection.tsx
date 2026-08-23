import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import {
    OUTLOOK_CALENDAR_CHANGED_EVENT,
    connectOutlookCalendar,
    disconnectOutlookCalendar,
    fetchOutlookCalendarEvents,
    getOutlookCalendarConfig,
    getOutlookCalendarConnection,
    getOutlookRedirectUri,
    setOutlookCalendarConfig,
    type OutlookCalendarConnection,
} from '../../../lib/outlook-calendar';
import { Switch } from '../../ui/Switch';

type SettingsOutlookCalendarSectionProps = {
    isTauri: boolean;
    showSaved: () => void;
};

const EMPTY_CONNECTION: OutlookCalendarConnection = {
    accountName: null,
    configured: false,
    connected: false,
    enabled: false,
    lastSyncAt: null,
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? 'Unknown Outlook error');
}

export function SettingsOutlookCalendarSection({
    isTauri,
    showSaved,
}: SettingsOutlookCalendarSectionProps) {
    const initialConfig = useMemo(() => getOutlookCalendarConfig(), []);
    const [open, setOpen] = useState(false);
    const [clientId, setClientId] = useState(initialConfig.clientId);
    const [tenantId, setTenantId] = useState(initialConfig.tenantId);
    const [enabled, setEnabled] = useState(initialConfig.enabled);
    const [savedFingerprint, setSavedFingerprint] = useState(
        `${initialConfig.clientId}:${initialConfig.tenantId}:${initialConfig.enabled}`,
    );
    const [connection, setConnection] = useState<OutlookCalendarConnection>(EMPTY_CONNECTION);
    const [busy, setBusy] = useState<'connect' | 'disconnect' | 'refresh' | 'save' | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refreshConnection = useCallback(async () => {
        setConnection(await getOutlookCalendarConnection());
    }, []);

    useEffect(() => {
        void refreshConnection();
        const listener = () => void refreshConnection();
        window.addEventListener(OUTLOOK_CALENDAR_CHANGED_EVENT, listener);
        return () => window.removeEventListener(OUTLOOK_CALENDAR_CHANGED_EVENT, listener);
    }, [refreshConnection]);

    const currentFingerprint = `${clientId.trim()}:${tenantId.trim() || 'common'}:${enabled}`;
    const hasUnsavedChanges = currentFingerprint !== savedFingerprint;
    const canUsePopup = !isTauri && Boolean(clientId.trim()) && !hasUnsavedChanges;

    const handleSave = useCallback(async () => {
        setBusy('save');
        setError(null);
        try {
            const config = setOutlookCalendarConfig({ clientId, tenantId, enabled });
            setClientId(config.clientId);
            setTenantId(config.tenantId);
            setEnabled(config.enabled);
            setSavedFingerprint(`${config.clientId}:${config.tenantId}:${config.enabled}`);
            await refreshConnection();
            showSaved();
        } catch (saveError) {
            setError(errorMessage(saveError));
        } finally {
            setBusy(null);
        }
    }, [clientId, enabled, refreshConnection, showSaved, tenantId]);

    const handleConnect = useCallback(async () => {
        setBusy('connect');
        setError(null);
        try {
            setConnection(await connectOutlookCalendar());
        } catch (connectError) {
            setError(errorMessage(connectError));
        } finally {
            setBusy(null);
        }
    }, []);

    const handleDisconnect = useCallback(async () => {
        setBusy('disconnect');
        setError(null);
        try {
            await disconnectOutlookCalendar();
            await refreshConnection();
        } catch (disconnectError) {
            setError(errorMessage(disconnectError));
        } finally {
            setBusy(null);
        }
    }, [refreshConnection]);

    const handleRefresh = useCallback(async () => {
        setBusy('refresh');
        setError(null);
        try {
            const start = new Date();
            start.setDate(start.getDate() - 1);
            const end = new Date();
            end.setDate(end.getDate() + 60);
            await fetchOutlookCalendarEvents(start, end);
            await refreshConnection();
        } catch (refreshError) {
            setError(errorMessage(refreshError));
        } finally {
            setBusy(null);
        }
    }, [refreshConnection]);

    const status = connection.connected
        ? `已连接：${connection.accountName || 'Microsoft 账号'}`
        : connection.configured
            ? '已配置，尚未连接'
            : '未配置';

    return (
        <div className="bg-card border border-border rounded-lg">
            <div className="p-4 flex items-start justify-between gap-4">
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                    className="min-w-0 flex-1 text-left flex items-center justify-between gap-4"
                >
                    <div className="min-w-0">
                        <div className="text-sm font-medium">Microsoft Outlook（日历只读）</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            用最小 Calendars.Read 权限，把当前会议并入日历与 NOW 卡片。
                        </p>
                    </div>
                    {open
                        ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>
                <Switch
                    aria-label="启用 Outlook 日历"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                />
            </div>

            {open && (
                <div className="border-t border-border p-4 space-y-4">
                    <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground space-y-1">
                        <p>在 Microsoft Entra 注册一个“单页应用 (SPA)”，并添加下面的重定向 URI：</p>
                        <code className="block select-all break-all text-foreground">{getOutlookRedirectUri()}</code>
                        <p>API 权限只需 Microsoft Graph → Delegated → Calendars.Read；无需客户端密钥。</p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-1">
                            <span className="text-sm font-medium">应用程序（客户端）ID</span>
                            <input
                                value={clientId}
                                onChange={(event) => setClientId(event.target.value)}
                                placeholder="00000000-0000-0000-0000-000000000000"
                                autoComplete="off"
                                className="w-full bg-muted p-2 rounded text-sm font-mono border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="text-sm font-medium">租户 ID / 域名</span>
                            <input
                                value={tenantId}
                                onChange={(event) => setTenantId(event.target.value)}
                                placeholder="common"
                                autoComplete="off"
                                className="w-full bg-muted p-2 rounded text-sm font-mono border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </label>
                    </div>

                    <div className="space-y-1 text-xs">
                        <p><span className="text-muted-foreground">状态：</span>{status}</p>
                        {connection.lastSyncAt && (
                            <p><span className="text-muted-foreground">最近同步：</span>{new Date(connection.lastSyncAt).toLocaleString()}</p>
                        )}
                        {hasUnsavedChanges && <p className="text-warning">配置有改动，请先保存再连接。</p>}
                        {isTauri && (
                            <p className="text-warning">Alpha 阶段 OAuth 登录请在 Web/PWA 中完成；Windows 桌面壳暂不弹出授权窗口。</p>
                        )}
                        {error && <p role="alert" className="text-destructive">{error}</p>}
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                        {connection.connected && (
                            <button
                                type="button"
                                onClick={handleDisconnect}
                                disabled={busy !== null}
                                className="px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
                            >
                                {busy === 'disconnect' ? '断开中…' : '断开'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleRefresh}
                            disabled={busy !== null || !connection.connected || !enabled}
                            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 disabled:opacity-50"
                        >
                            {busy === 'refresh' ? '同步中…' : '立即同步'}
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={busy !== null || !clientId.trim()}
                            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 disabled:opacity-50"
                        >
                            {busy === 'save' ? '保存中…' : '保存配置'}
                        </button>
                        <button
                            type="button"
                            onClick={handleConnect}
                            disabled={busy !== null || !canUsePopup || connection.connected}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
                        >
                            {busy === 'connect' ? '连接中…' : '连接 Microsoft'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
