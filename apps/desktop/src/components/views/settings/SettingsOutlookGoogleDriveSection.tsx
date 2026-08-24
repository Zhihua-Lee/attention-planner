import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import {
    ensureGoogleDriveCalendarExportFile,
    getGoogleDriveCalendarExportStatus,
    type GoogleDriveCalendarExportStatus,
} from '../../../lib/google-drive-calendar';

const EMPTY_STATUS: GoogleDriveCalendarExportStatus = {
    connected: false,
    fileReady: false,
    modifiedTime: null,
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? 'Unknown Google Drive error');
}

export function SettingsOutlookGoogleDriveSection() {
    const [open, setOpen] = useState(true);
    const [status, setStatus] = useState(EMPTY_STATUS);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setError(null);
        try {
            setStatus(await getGoogleDriveCalendarExportStatus());
        } catch (refreshError) {
            setError(errorMessage(refreshError));
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const prepare = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            setStatus(await ensureGoogleDriveCalendarExportFile());
        } catch (prepareError) {
            setError(errorMessage(prepareError));
        } finally {
            setBusy(false);
        }
    }, []);

    const statusLabel = status.fileReady
        ? '私有导出文件已准备好'
        : status.connected
            ? 'Google Drive 已连接，尚未创建导出文件'
            : '请先在“设置 → 同步”连接 Google Drive';

    return (
        <div className="bg-card border border-border rounded-lg">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                className="w-full p-4 text-left flex items-center justify-between gap-4"
            >
                <div className="min-w-0">
                    <div className="text-sm font-medium">Outlook → Google Drive（日历只读）</div>
                    <p className="text-xs text-muted-foreground mt-1">
                        学校账号由 Power Automate 定时导出最小字段，PWA 从你的私人 Drive 直接读取。
                    </p>
                </div>
                {open
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>

            {open && (
                <div className="border-t border-border p-4 space-y-4">
                    <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground space-y-1">
                        <p>文件名：<code className="text-foreground">outlook-calendar.json</code>（普通“我的云端硬盘”中的私有文件）。</p>
                        <p>导出字段：事件 ID、标题、开始/结束、地点、全天状态；不导出正文、参会者、会议链接或组织者。</p>
                        <p>Cloudflare 只换取短时令牌，不接收文件内容；浏览器直接从 Google Drive 下载。</p>
                    </div>

                    <div className="space-y-1 text-xs">
                        <p><span className="text-muted-foreground">状态：</span>{statusLabel}</p>
                        {status.modifiedTime && (
                            <p><span className="text-muted-foreground">文件最近更新：</span>{new Date(status.modifiedTime).toLocaleString()}</p>
                        )}
                        {error && <p role="alert" className="text-destructive">{error}</p>}
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => void refresh()}
                            disabled={busy}
                            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 disabled:opacity-50"
                        >
                            刷新状态
                        </button>
                        <button
                            type="button"
                            onClick={prepare}
                            disabled={busy || !status.connected || status.fileReady}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
                        >
                            {busy ? '准备中…' : status.fileReady ? '文件已准备' : '准备私有导出文件'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
