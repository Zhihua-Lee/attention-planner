import { X } from 'lucide-react';
import { useLanguage } from '../contexts/language-context';
import { useUiStore } from '../store/ui-store';
import { cn } from '../lib/utils';

export function ToastHost() {
    const { t } = useLanguage();
    const toasts = useUiStore((state) => state.toasts);
    const dismissToast = useUiStore((state) => state.dismissToast);
    const dismissLabel = t('common.dismiss');
    const dismissText = dismissLabel && dismissLabel !== 'common.dismiss' ? dismissLabel : 'Dismiss';

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-3 right-3 z-[100] flex flex-col gap-2 sm:left-auto sm:right-4 sm:w-[360px]">
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={cn(
                        "w-full min-w-0 rounded-md border bg-card px-3 py-2 shadow-lg text-sm flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2",
                        toast.tone === 'success' && "border-success/40 text-success",
                        toast.tone === 'error' && "border-destructive/40 text-destructive",
                        toast.tone === 'info' && "border-border bg-card text-foreground"
                    )}
                    role="status"
                    aria-live="polite"
                >
                    <span className="min-w-0 flex-1 break-words">{toast.message}</span>
                    {toast.action && (
                        <button
                            type="button"
                            onClick={() => {
                                toast.action?.onClick();
                                dismissToast(toast.id);
                            }}
                            className="min-h-11 min-w-11 shrink-0 rounded px-2 text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
                        >
                            {toast.action.label}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => dismissToast(toast.id)}
                        className="min-h-11 min-w-11 shrink-0 flex items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary cursor-pointer transition-colors -mr-1"
                        aria-label={dismissText}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            ))}
        </div>
    );
}
