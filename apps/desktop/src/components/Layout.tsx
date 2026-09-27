import { TaskDetailLauncher } from './planner/TaskDetailLauncher';
import { openTaskDetails } from '../lib/lifecycle-actions';
import type { ReactNode } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { Layout as LegacyLayout } from './LegacyLayout';
import { PwaCaptureHost, QUICK_CAPTURE_EVENT } from './capture/PwaCaptureHost';
import { useLanguage } from '../contexts/language-context';
import { PlannerEnvironment } from './planner/usePlannerEnvironment';
import { TaskDetailHost } from './planner/TaskDetailHost';
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
    return <PlannerEnvironment><TaskDetailLauncher.Provider value={openTaskDetails}>
        <LegacyLayout {...props}>
            {!isFocusMode && <div className="sticky top-0 z-20 mb-6 flex items-center justify-between gap-3 border-b border-border/70 bg-background/95 py-3 backdrop-blur-sm" data-testid="workspace-actions">
                <button type="button" onClick={() => props.onViewChange('calendar')}
                    aria-current={props.currentView === 'calendar' ? 'page' : undefined}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none">
                    <CalendarDays className="h-5 w-5" aria-hidden="true" />{t('nav.calendar')}
                </button>
                <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(QUICK_CAPTURE_EVENT, { detail: { captureMode: 'text' } }))}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-[background-color,box-shadow] hover:bg-primary/90 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none">
                    <Plus className="h-5 w-5" aria-hidden="true" />{t('nav.addTask')}
                </button>
            </div>}
            {props.children}
        </LegacyLayout>
        <PwaCaptureHost />
        <TaskDetailHost />
    </TaskDetailLauncher.Provider></PlannerEnvironment>;
}
