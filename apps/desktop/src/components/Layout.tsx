import type { ReactNode } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { Layout as LegacyLayout } from './LegacyLayout';
import { PwaCaptureHost, QUICK_CAPTURE_EVENT, LEGACY_CAPTURE_EVENT } from './capture/PwaCaptureHost';
import { useLanguage } from '../contexts/language-context';
import { isTauriRuntime } from '../lib/runtime';
import { useUiStore } from '../store/ui-store';

interface LayoutProps {
    children: ReactNode;
    currentView: string;
    onViewChange: (view: string) => void;
    onOpenSyncSettings?: () => void;
}

// Keep the established sync, sidebar, drag/drop and desktop shell intact while
// making the two daily operations visible from every workspace. This toolbar
// uses the same navigation callback (and edit guards) as the existing sidebar.
export function Layout(props: LayoutProps) {
    const { t } = useLanguage();
    const isFocusMode = useUiStore(state => state.isFocusMode);
    const native = isTauriRuntime();
    return <>
        <LegacyLayout {...props}>
            {!isFocusMode && <div className="sticky top-0 z-20 mb-4 flex items-center justify-between gap-3 border-b border-border bg-background py-2" data-testid="workspace-actions">
                <button type="button" onClick={() => props.onViewChange('calendar')}
                    aria-current={props.currentView === 'calendar' ? 'page' : undefined}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-foreground hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <CalendarDays className="h-5 w-5" aria-hidden="true" />{t('nav.calendar')}
                </button>
                <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(native ? LEGACY_CAPTURE_EVENT : QUICK_CAPTURE_EVENT, { detail: { captureMode: 'text' } }))}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <Plus className="h-5 w-5" aria-hidden="true" />{t('nav.addTask')}
                </button>
            </div>}
            {props.children}
        </LegacyLayout>
        {!native && <PwaCaptureHost />}
    </>;
}
