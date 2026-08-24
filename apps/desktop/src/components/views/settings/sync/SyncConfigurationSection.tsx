import { AlertCircle, CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { Switch } from '../../../ui/Switch';
import type { SettingsSyncPageProps } from './types';

type SyncConfigurationSectionProps = Pick<
    SettingsSyncPageProps,
    | 't'
    | 'isTauri'
    | 'isMacOS'
    | 'webdavUrlError'
    | 'cloudUrlError'
    | 'syncBackend'
    | 'onSetSyncBackend'
    | 'syncPath'
    | 'onSyncPathChange'
    | 'onSaveSyncPath'
    | 'onBrowseSyncPath'
    | 'webdavUrl'
    | 'webdavUsername'
    | 'webdavPassword'
    | 'webdavHasPassword'
    | 'webdavAllowInsecureHttp'
    | 'isSavingWebDav'
    | 'isTestingWebDav'
    | 'webdavTestState'
    | 'onWebdavUrlChange'
    | 'onWebdavUsernameChange'
    | 'onWebdavPasswordChange'
    | 'onWebdavAllowInsecureHttpChange'
    | 'onSaveWebDav'
    | 'onTestWebDavConnection'
    | 'cloudUrl'
    | 'cloudToken'
    | 'cloudRememberToken'
    | 'cloudAllowInsecureHttp'
    | 'cloudProvider'
    | 'dropboxConfigured'
    | 'dropboxConnected'
    | 'dropboxBusy'
    | 'dropboxAuthInProgress'
    | 'dropboxRedirectUri'
    | 'dropboxTestState'
    | 'oneDriveAccountName'
    | 'oneDriveBusy'
    | 'oneDriveClientId'
    | 'oneDriveConnected'
    | 'oneDriveRedirectUri'
    | 'oneDriveTenantId'
    | 'oneDriveTestState'
    | 'googleDriveBusy'
    | 'googleDriveClientId'
    | 'googleDriveConnected'
    | 'googleDriveManaged'
    | 'googleDriveOrigin'
    | 'googleDriveTestState'
    | 'onCloudUrlChange'
    | 'onCloudTokenChange'
    | 'onCloudRememberTokenChange'
    | 'onCloudAllowInsecureHttpChange'
    | 'onCloudProviderChange'
    | 'onSaveCloud'
    | 'onConnectDropbox'
    | 'onDisconnectDropbox'
    | 'onTestDropboxConnection'
    | 'onOneDriveClientIdChange'
    | 'onOneDriveTenantIdChange'
    | 'onSaveOneDrive'
    | 'onConnectOneDrive'
    | 'onDisconnectOneDrive'
    | 'onTestOneDriveConnection'
    | 'onGoogleDriveClientIdChange'
    | 'onSaveGoogleDrive'
    | 'onConnectGoogleDrive'
    | 'onDisconnectGoogleDrive'
    | 'onTestGoogleDriveConnection'
>;

type BackendButtonOption = 'off' | 'file' | 'dropbox' | 'onedrive' | 'google-drive' | 'webdav' | 'selfhosted' | 'cloudkit';
type BackendButtonGroup = {
    description: string;
    options: BackendButtonOption[];
    title: string;
};

const BackendButton = ({
    active,
    children,
    onClick,
}: {
    active: boolean;
    children: React.ReactNode;
    onClick: () => void;
}) => (
    <button
        aria-pressed={active}
        onClick={onClick}
        className={cn(
            'px-3 py-1.5 rounded-md text-sm font-medium transition-colors border',
            active
                ? 'bg-primary/10 text-primary border-primary ring-1 ring-primary'
                : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground',
        )}
    >
        {children}
    </button>
);

const SwitchRow = ({
    checked,
    hint,
    label,
    onCheckedChange,
}: {
    checked: boolean;
    hint: string;
    label: string;
    onCheckedChange: (checked: boolean) => void;
}) => (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 p-3">
        <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Switch
            aria-label={label}
            checked={checked}
            onCheckedChange={onCheckedChange}
        />
    </div>
);

const ConnectionBadge = ({
    state,
    successLabel,
    errorLabel,
}: {
    state: 'idle' | 'success' | 'error';
    successLabel: string;
    errorLabel: string;
}) => {
    if (state === 'idle') return null;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                state === 'success'
                    ? 'border-success/40 text-success'
                    : 'border-destructive/40 text-destructive'
            )}
        >
            {state === 'success'
                ? <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                : <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />}
            {state === 'success' ? successLabel : errorLabel}
        </span>
    );
};

const renderDropboxPanel = ({
    dropboxBusy,
    dropboxAuthInProgress,
    dropboxConfigured,
    dropboxConnected,
    dropboxRedirectUri,
    dropboxTestState,
    onConnectDropbox,
    onDisconnectDropbox,
    onTestDropboxConnection,
    t,
}: Pick<
    SyncConfigurationSectionProps,
    | 'dropboxBusy'
    | 'dropboxAuthInProgress'
    | 'dropboxConfigured'
    | 'dropboxConnected'
    | 'dropboxRedirectUri'
    | 'dropboxTestState'
    | 'onConnectDropbox'
    | 'onDisconnectDropbox'
    | 'onTestDropboxConnection'
    | 't'
>) => (
    <div className="space-y-3">
        <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t.dropboxAppKey}</label>
            <p className="text-xs text-muted-foreground">{t.dropboxAppKeyHint}</p>
            {dropboxAuthInProgress && dropboxRedirectUri.trim() && (
                <p className="text-xs text-muted-foreground">
                    {t.dropboxRedirectUri}: <span className="font-mono break-all">{dropboxRedirectUri}</span>
                </p>
            )}
            {!dropboxConfigured && (
                <p className="text-xs text-destructive">
                    Dropbox app key is not configured in this build.
                </p>
            )}
            <p className="text-xs text-muted-foreground">
                {t.dropboxStatus}: {dropboxConnected ? t.dropboxConnected : t.dropboxNotConnected}
            </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
            <button
                onClick={dropboxConnected ? onDisconnectDropbox : onConnectDropbox}
                disabled={dropboxBusy || !dropboxConfigured}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 whitespace-nowrap disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
                {dropboxConnected ? t.dropboxDisconnect : t.dropboxConnect}
            </button>
            <button
                onClick={onTestDropboxConnection}
                disabled={dropboxBusy || !dropboxConfigured}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {dropboxBusy ? t.syncing : t.dropboxTest}
            </button>
            <ConnectionBadge
                state={dropboxTestState}
                successLabel={t.dropboxTestReachable}
                errorLabel={t.dropboxTestFailed}
            />
        </div>
    </div>
);

const renderOneDrivePanel = ({
    oneDriveAccountName,
    oneDriveBusy,
    oneDriveClientId,
    oneDriveConnected,
    oneDriveRedirectUri,
    oneDriveTenantId,
    oneDriveTestState,
    onConnectOneDrive,
    onDisconnectOneDrive,
    onOneDriveClientIdChange,
    onOneDriveTenantIdChange,
    onSaveOneDrive,
    onTestOneDriveConnection,
}: Pick<
    SyncConfigurationSectionProps,
    | 'oneDriveAccountName'
    | 'oneDriveBusy'
    | 'oneDriveClientId'
    | 'oneDriveConnected'
    | 'oneDriveRedirectUri'
    | 'oneDriveTenantId'
    | 'oneDriveTestState'
    | 'onConnectOneDrive'
    | 'onDisconnectOneDrive'
    | 'onOneDriveClientIdChange'
    | 'onOneDriveTenantIdChange'
    | 'onSaveOneDrive'
    | 'onTestOneDriveConnection'
>) => (
    <div className="space-y-3">
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            任务数据只写入个人 OneDrive 的应用专用目录 <span className="font-mono">Apps/Attention Planner</span>。
            此连接与学校 Outlook 日历账号相互独立。
        </div>
        <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Microsoft Entra Client ID</label>
                <input
                    type="text"
                    value={oneDriveClientId}
                    onChange={(event) => onOneDriveClientIdChange(event.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="bg-muted p-2 rounded text-sm font-mono border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Tenant / Authority</label>
                <input
                    type="text"
                    value={oneDriveTenantId}
                    onChange={(event) => onOneDriveTenantIdChange(event.target.value)}
                    placeholder="common"
                    className="bg-muted p-2 rounded text-sm font-mono border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
            </div>
        </div>
        <p className="text-xs text-muted-foreground">
            SPA 回调地址：<span className="font-mono break-all">{oneDriveRedirectUri}</span>
        </p>
        <p className="text-xs text-muted-foreground">
            状态：{oneDriveConnected ? `已连接 ${oneDriveAccountName || '个人 OneDrive'}` : '未连接'}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
            <button
                onClick={onSaveOneDrive}
                disabled={oneDriveBusy || !oneDriveClientId.trim()}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                保存配置
            </button>
            <button
                onClick={oneDriveConnected ? onDisconnectOneDrive : onConnectOneDrive}
                disabled={oneDriveBusy || !oneDriveClientId.trim()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
                {oneDriveConnected ? '断开 OneDrive' : '连接个人 OneDrive'}
            </button>
            <button
                onClick={onTestOneDriveConnection}
                disabled={oneDriveBusy || !oneDriveConnected}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {oneDriveBusy ? '处理中…' : '测试连接'}
            </button>
            <ConnectionBadge
                state={oneDriveTestState}
                successLabel="OneDrive 可访问"
                errorLabel="OneDrive 连接失败"
            />
        </div>
    </div>
);

const renderGoogleDrivePanel = ({
    googleDriveBusy,
    googleDriveClientId,
    googleDriveConnected,
    googleDriveManaged,
    googleDriveOrigin,
    googleDriveTestState,
    onConnectGoogleDrive,
    onDisconnectGoogleDrive,
    onGoogleDriveClientIdChange,
    onSaveGoogleDrive,
    onTestGoogleDriveConnection,
}: Pick<
    SyncConfigurationSectionProps,
    | 'googleDriveBusy'
    | 'googleDriveClientId'
    | 'googleDriveConnected'
    | 'googleDriveManaged'
    | 'googleDriveOrigin'
    | 'googleDriveTestState'
    | 'onConnectGoogleDrive'
    | 'onDisconnectGoogleDrive'
    | 'onGoogleDriveClientIdChange'
    | 'onSaveGoogleDrive'
    | 'onTestGoogleDriveConnection'
>) => (
    <div className="space-y-3">
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            任务数据写入 Google Drive 隐藏的 <span className="font-mono">appDataFolder</span>。
            Outlook 导出使用 <span className="font-mono">drive.file</span>，只允许访问本应用创建或你明确打开的普通 Drive 文件，不能浏览整个云端硬盘。
            {googleDriveManaged
                ? ' 刷新令牌由仅允许指定 Google 账号登录的服务加密保存，PWA 只领取短时令牌并直接连接 Google Drive。'
                : ' 浏览器访问令牌约一小时后到期，届时需要重新连接。'}
        </div>
        {!googleDriveManaged && (
            <>
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Google OAuth Web Client ID</label>
                    <input
                        type="text"
                        value={googleDriveClientId}
                        onChange={(event) => onGoogleDriveClientIdChange(event.target.value)}
                        placeholder="000000000000-xxxxxxxx.apps.googleusercontent.com"
                        className="bg-muted p-2 rounded text-sm font-mono border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                </div>
                <p className="text-xs text-muted-foreground">
                    已获授权的 JavaScript 来源：<span className="font-mono break-all">{googleDriveOrigin}</span>
                </p>
            </>
        )}
        <p className="text-xs text-muted-foreground">
            状态：{googleDriveConnected
                ? googleDriveManaged ? '已长期授权；短时令牌将自动刷新' : '本次浏览器会话已连接'
                : '尚未连接'}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
            {!googleDriveManaged && (
                <button
                    onClick={onSaveGoogleDrive}
                    disabled={googleDriveBusy || !googleDriveClientId.trim()}
                    className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    保存配置
                </button>
            )}
            <button
                onClick={googleDriveConnected ? onDisconnectGoogleDrive : onConnectGoogleDrive}
                disabled={googleDriveBusy || !googleDriveClientId.trim()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
                {googleDriveConnected ? '断开 Google Drive' : '连接 Google Drive'}
            </button>
            <button
                onClick={onTestGoogleDriveConnection}
                disabled={googleDriveBusy || !googleDriveConnected}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {googleDriveBusy ? '处理中…' : '测试连接'}
            </button>
            <ConnectionBadge
                state={googleDriveTestState}
                successLabel="Google appDataFolder 可访问"
                errorLabel="Google Drive 连接失败"
            />
        </div>
    </div>
);

const renderSelfHostedCloudPanel = ({
    cloudAllowInsecureHttp,
    cloudRememberToken,
    cloudToken,
    cloudUrl,
    cloudUrlError,
    isTauri,
    onCloudAllowInsecureHttpChange,
    onCloudRememberTokenChange,
    onCloudTokenChange,
    onCloudUrlChange,
    onSaveCloud,
    t,
}: Pick<
    SyncConfigurationSectionProps,
    | 'cloudAllowInsecureHttp'
    | 'cloudRememberToken'
    | 'cloudToken'
    | 'cloudUrl'
    | 'isTauri'
    | 'onCloudAllowInsecureHttpChange'
    | 'onCloudRememberTokenChange'
    | 'onCloudTokenChange'
    | 'onCloudUrlChange'
    | 'onSaveCloud'
    | 't'
> & { cloudUrlError: boolean }) => (
    <div className="space-y-3">
        <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t.cloudUrl}</label>
            <input
                type="text"
                value={cloudUrl}
                onChange={(e) => onCloudUrlChange(e.target.value)}
                placeholder="https://example.com"
                className={cn(
                    'bg-muted p-2 rounded text-sm font-mono border focus:outline-none focus:ring-2 focus:ring-primary',
                    cloudUrlError ? 'border-destructive' : 'border-border',
                )}
            />
            <p className="text-xs text-muted-foreground">{t.cloudHint}</p>
            {cloudUrlError && (
                <p className="text-xs text-destructive">Enter a valid http(s) URL.</p>
            )}
        </div>

        <SwitchRow
            checked={cloudAllowInsecureHttp}
            label={t.allowInsecureHttp}
            hint={t.allowInsecureHttpHint}
            onCheckedChange={onCloudAllowInsecureHttpChange}
        />

        <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t.cloudToken}</label>
            <input
                type="password"
                value={cloudToken}
                onChange={(e) => onCloudTokenChange(e.target.value)}
                className="bg-muted p-2 rounded text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
        </div>

        {!isTauri && (
            <SwitchRow
                checked={cloudRememberToken}
                label={t.cloudRememberToken}
                hint={t.cloudRememberTokenHint}
                onCheckedChange={onCloudRememberTokenChange}
            />
        )}

        <div className="flex justify-end">
            <button
                onClick={onSaveCloud}
                disabled={cloudUrlError}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 whitespace-nowrap disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
                {t.cloudSave}
            </button>
        </div>
    </div>
);

const renderWebDavPanel = ({
    isSavingWebDav,
    isTauri,
    isTestingWebDav,
    onSaveWebDav,
    onTestWebDavConnection,
    onWebdavAllowInsecureHttpChange,
    onWebdavPasswordChange,
    onWebdavUrlChange,
    onWebdavUsernameChange,
    t,
    webdavAllowInsecureHttp,
    webdavHasPassword,
    webdavPassword,
    webdavTestState,
    webdavUrl,
    webdavUrlError,
    webdavUsername,
}: Pick<
    SyncConfigurationSectionProps,
    | 'isSavingWebDav'
    | 'isTauri'
    | 'isTestingWebDav'
    | 'onSaveWebDav'
    | 'onTestWebDavConnection'
    | 'onWebdavAllowInsecureHttpChange'
    | 'onWebdavPasswordChange'
    | 'onWebdavUrlChange'
    | 'onWebdavUsernameChange'
    | 't'
    | 'webdavAllowInsecureHttp'
    | 'webdavHasPassword'
    | 'webdavPassword'
    | 'webdavTestState'
    | 'webdavUrl'
    | 'webdavUsername'
> & { webdavUrlError: boolean }) => (
    <div className="space-y-3">
        <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t.webdavUrl}</label>
            <input
                type="text"
                value={webdavUrl}
                onChange={(e) => onWebdavUrlChange(e.target.value)}
                placeholder="https://example.com/remote.php/dav/files/user/data.json"
                className={cn(
                    'bg-muted p-2 rounded text-sm font-mono border focus:outline-none focus:ring-2 focus:ring-primary',
                    webdavUrlError ? 'border-destructive' : 'border-border',
                )}
            />
            <p className="text-xs text-muted-foreground">{t.webdavHint}</p>
            {webdavUrlError && (
                <p className="text-xs text-destructive">Enter a valid http(s) URL.</p>
            )}
        </div>

        <SwitchRow
            checked={webdavAllowInsecureHttp}
            label={t.allowInsecureHttp}
            hint={t.allowInsecureHttpHint}
            onCheckedChange={onWebdavAllowInsecureHttpChange}
        />

        <div className="grid sm:grid-cols-2 gap-2">
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">{t.webdavUsername}</label>
                <input
                    type="text"
                    value={webdavUsername}
                    onChange={(e) => onWebdavUsernameChange(e.target.value)}
                    className="bg-muted p-2 rounded text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">{t.webdavPassword}</label>
                <input
                    type="password"
                    value={webdavPassword}
                    onChange={(e) => onWebdavPasswordChange(e.target.value)}
                    placeholder={webdavHasPassword && !webdavPassword ? '••••••••' : ''}
                    className="bg-muted p-2 rounded text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
            </div>
        </div>
        {!isTauri && (
            <p className="text-xs text-warning">
                Web warning: WebDAV passwords are stored in browser storage. Use only on trusted devices.
            </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
            <button
                onClick={onTestWebDavConnection}
                disabled={webdavUrlError || !webdavUrl.trim() || isTestingWebDav}
                aria-label={t.webdavTestAccessibility}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isTestingWebDav ? t.syncing : t.testConnection}
            </button>
            <button
                onClick={onSaveWebDav}
                disabled={webdavUrlError || isSavingWebDav}
                aria-busy={isSavingWebDav}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 whitespace-nowrap disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
                {t.webdavSave}
            </button>
            <ConnectionBadge
                state={webdavTestState}
                successLabel={t.dropboxTestReachable}
                errorLabel={t.dropboxTestFailed}
            />
        </div>
        <p className="text-xs text-muted-foreground">{t.webdavTestHint}</p>
    </div>
);

export function SyncConfigurationSection({
    cloudAllowInsecureHttp,
    cloudRememberToken,
    cloudProvider,
    cloudToken,
    cloudUrl,
    cloudUrlError,
    dropboxBusy,
    dropboxAuthInProgress,
    dropboxConfigured,
    dropboxConnected,
    dropboxRedirectUri,
    dropboxTestState,
    oneDriveAccountName,
    oneDriveBusy,
    oneDriveClientId,
    oneDriveConnected,
    oneDriveRedirectUri,
    oneDriveTenantId,
    oneDriveTestState,
    googleDriveBusy,
    googleDriveClientId,
    googleDriveConnected,
    googleDriveManaged,
    googleDriveOrigin,
    googleDriveTestState,
    isMacOS,
    isSavingWebDav,
    isTauri,
    isTestingWebDav,
    onBrowseSyncPath,
    onCloudAllowInsecureHttpChange,
    onCloudRememberTokenChange,
    onCloudProviderChange,
    onCloudTokenChange,
    onCloudUrlChange,
    onConnectDropbox,
    onDisconnectDropbox,
    onSaveCloud,
    onSaveSyncPath,
    onSaveWebDav,
    onSetSyncBackend,
    onSyncPathChange,
    onTestDropboxConnection,
    onOneDriveClientIdChange,
    onOneDriveTenantIdChange,
    onSaveOneDrive,
    onConnectOneDrive,
    onDisconnectOneDrive,
    onTestOneDriveConnection,
    onGoogleDriveClientIdChange,
    onSaveGoogleDrive,
    onConnectGoogleDrive,
    onDisconnectGoogleDrive,
    onTestGoogleDriveConnection,
    onTestWebDavConnection,
    onWebdavAllowInsecureHttpChange,
    onWebdavPasswordChange,
    onWebdavUrlChange,
    onWebdavUsernameChange,
    syncBackend,
    syncPath,
    t,
    webdavAllowInsecureHttp,
    webdavHasPassword,
    webdavPassword,
    webdavTestState,
    webdavUrl,
    webdavUrlError,
    webdavUsername,
}: SyncConfigurationSectionProps) {
    const isSelfHostedSelected = syncBackend === 'cloud' && cloudProvider === 'selfhosted';
    const isDropboxSelected = syncBackend === 'cloud' && cloudProvider === 'dropbox';
    const isOneDriveSelected = syncBackend === 'cloud' && cloudProvider === 'onedrive';
    const isGoogleDriveSelected = syncBackend === 'cloud' && cloudProvider === 'google-drive';
    const backendGroups: BackendButtonGroup[] = [
        {
            title: t.syncBackendGroupCloud,
            description: t.syncBackendGroupCloudDesc,
            options: [...(!isTauri ? (['google-drive', 'onedrive'] as const) : []), 'dropbox', ...(isMacOS ? (['cloudkit'] as const) : [])],
        },
        {
            title: t.syncBackendGroupFile,
            description: t.syncBackendGroupFileDesc,
            options: ['file'],
        },
        {
            title: t.syncBackendGroupAdvanced,
            description: t.syncBackendGroupAdvancedDesc,
            options: ['webdav', 'selfhosted'],
        },
    ];
    const backendControlOptions: BackendButtonOption[] = [
        'off',
        ...backendGroups.flatMap((group) => group.options),
    ];
    const getBackendOptionLabel = (option: BackendButtonOption): string => {
        switch (option) {
            case 'off':
                return t.syncBackendOff;
            case 'file':
                return t.syncBackendFile;
            case 'dropbox':
                return t.cloudProviderDropbox;
            case 'onedrive':
                return 'OneDrive';
            case 'google-drive':
                return 'Google Drive';
            case 'webdav':
                return t.syncBackendWebdav;
            case 'selfhosted':
                return t.cloudProviderSelfHosted;
            case 'cloudkit':
                return t.syncBackendCloudkit;
        }
    };
    const isBackendOptionActive = (option: BackendButtonOption): boolean => {
        switch (option) {
            case 'off':
            case 'file':
            case 'webdav':
                return syncBackend === option;
            case 'dropbox':
                return isDropboxSelected;
            case 'onedrive':
                return isOneDriveSelected;
            case 'google-drive':
                return isGoogleDriveSelected;
            case 'selfhosted':
                return isSelfHostedSelected;
            case 'cloudkit':
                return syncBackend === 'cloudkit';
        }
    };
    const selectedBackendGroup = backendGroups.find((group) =>
        group.options.some((option) => isBackendOptionActive(option))
    );
    const selectBackendOption = (option: BackendButtonOption) => {
        switch (option) {
            case 'dropbox':
                onCloudProviderChange('dropbox');
                if (syncBackend !== 'cloud') onSetSyncBackend('cloud');
                return;
            case 'onedrive':
                onCloudProviderChange('onedrive');
                if (syncBackend !== 'cloud') onSetSyncBackend('cloud');
                return;
            case 'google-drive':
                onCloudProviderChange('google-drive');
                if (syncBackend !== 'cloud') onSetSyncBackend('cloud');
                return;
            case 'selfhosted':
                onCloudProviderChange('selfhosted');
                if (syncBackend !== 'cloud') onSetSyncBackend('cloud');
                return;
            case 'cloudkit':
                onSetSyncBackend('cloudkit');
                return;
            default:
                onSetSyncBackend(option);
        }
    };

    return (
        <section className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
                <RefreshCw className="w-5 h-5" />
                {t.sync}
            </h2>

            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                <a
                    href="https://docs.mindwtr.app/data-sync/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                    Data and Sync guide
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>

                <div className="space-y-1">
                    <span className="text-sm font-medium">{t.syncBackend}</span>
                    <p className="text-xs text-muted-foreground">{t.syncBackendChoiceHint}</p>
                </div>

                <div
                    aria-label={t.syncBackend}
                    className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 p-2"
                    role="group"
                >
                    {backendControlOptions.map((option) => (
                        <BackendButton
                            key={option}
                            active={isBackendOptionActive(option)}
                            onClick={() => selectBackendOption(option)}
                        >
                            {getBackendOptionLabel(option)}
                        </BackendButton>
                    ))}
                </div>

                {selectedBackendGroup && (
                    <div className="space-y-1">
                        <div className="text-sm font-semibold text-foreground">{selectedBackendGroup.title}</div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            {selectedBackendGroup.description}
                        </p>
                    </div>
                )}

                {syncBackend === 'file' && (
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium">{t.syncFolderLocation}</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={syncPath}
                                onChange={(e) => onSyncPathChange(e.target.value)}
                                placeholder="/path/to/your/sync/folder"
                                className="flex-1 bg-muted p-2 rounded text-sm font-mono border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            <button
                                onClick={onSaveSyncPath}
                                disabled={!syncPath.trim() || !isTauri}
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed whitespace-nowrap"
                            >
                                {t.savePath}
                            </button>
                            <button
                                onClick={onBrowseSyncPath}
                                disabled={!isTauri}
                                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {t.browse}
                            </button>
                        </div>
                        <p className="text-xs text-muted-foreground">{t.pathHint}</p>
                    </div>
                )}

                {syncBackend === 'webdav' && renderWebDavPanel({
                    isSavingWebDav,
                    isTauri,
                    isTestingWebDav,
                    onSaveWebDav,
                    onTestWebDavConnection,
                    onWebdavAllowInsecureHttpChange,
                    onWebdavPasswordChange,
                    onWebdavUrlChange,
                    onWebdavUsernameChange,
                    t,
                    webdavAllowInsecureHttp,
                    webdavHasPassword,
                    webdavPassword,
                    webdavTestState,
                    webdavUrl,
                    webdavUrlError,
                    webdavUsername,
                })}

                {isSelfHostedSelected && renderSelfHostedCloudPanel({
                    cloudAllowInsecureHttp,
                    cloudRememberToken,
                    cloudToken,
                    cloudUrl,
                    cloudUrlError,
                    isTauri,
                    onCloudAllowInsecureHttpChange,
                    onCloudRememberTokenChange,
                    onCloudTokenChange,
                    onCloudUrlChange,
                    onSaveCloud,
                    t,
                })}

                {syncBackend === 'cloudkit' && (
                    <p className="text-sm text-muted-foreground">{t.cloudkitDesc}</p>
                )}

                {isDropboxSelected && renderDropboxPanel({
                    dropboxBusy,
                    dropboxAuthInProgress,
                    dropboxConfigured,
                    dropboxConnected,
                    dropboxRedirectUri,
                    dropboxTestState,
                    onConnectDropbox,
                    onDisconnectDropbox,
                    onTestDropboxConnection,
                    t,
                })}

                {isOneDriveSelected && renderOneDrivePanel({
                    oneDriveAccountName,
                    oneDriveBusy,
                    oneDriveClientId,
                    oneDriveConnected,
                    oneDriveRedirectUri,
                    oneDriveTenantId,
                    oneDriveTestState,
                    onConnectOneDrive,
                    onDisconnectOneDrive,
                    onOneDriveClientIdChange,
                    onOneDriveTenantIdChange,
                    onSaveOneDrive,
                    onTestOneDriveConnection,
                })}

                {isGoogleDriveSelected && renderGoogleDrivePanel({
                    googleDriveBusy,
                    googleDriveClientId,
                    googleDriveConnected,
                    googleDriveManaged,
                    googleDriveOrigin,
                    googleDriveTestState,
                    onConnectGoogleDrive,
                    onDisconnectGoogleDrive,
                    onGoogleDriveClientIdChange,
                    onSaveGoogleDrive,
                    onTestGoogleDriveConnection,
                })}
            </div>
        </section>
    );
}
