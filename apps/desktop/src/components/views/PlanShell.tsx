import type { ReactNode } from 'react';
import { CalendarDays, FolderKanban, Hourglass, ListChecks, Repeat2 } from 'lucide-react';

import { useLanguage } from '../../contexts/language-context';
import { cn } from '../../lib/utils';
import { ListView } from './ListView';

export type PlanSection = 'today' | 'calendar' | 'projects' | 'later' | 'recurring';

type PlanShellProps = {
    activeSection: PlanSection;
    children: ReactNode;
    onNavigate: (view: string) => void;
};

type LaterViewProps = {
    activeList: 'waiting' | 'someday';
    onNavigate: (view: 'waiting' | 'someday') => void;
};

const PLAN_TABS = [
    { id: 'today', view: 'plan', labelKey: 'calendar.today', fallback: 'Today', icon: ListChecks },
    { id: 'calendar', view: 'calendar', labelKey: 'nav.calendar', fallback: 'Calendar', icon: CalendarDays },
    { id: 'projects', view: 'projects', labelKey: 'nav.projects', fallback: 'Projects', icon: FolderKanban },
    { id: 'later', view: 'waiting', labelKey: 'plan.later', fallback: 'Later', icon: Hourglass },
    { id: 'recurring', view: 'recurring', labelKey: 'plan.recurring', fallback: 'Recurring', icon: Repeat2 },
] as const;

function translated(t: (key: string) => string, key: string, fallback: string): string {
    const value = t(key);
    return value && value !== key ? value : fallback;
}
export function PlanShell({ activeSection, children, onNavigate }: PlanShellProps) {
    const { t } = useLanguage();

    return (
        <section className="min-w-0 space-y-5" data-testid="plan-shell">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 pb-5">
                <div className="max-w-2xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                        {translated(t, 'nav.plan', 'Plan')}
                    </p>
                    <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">
                        {translated(t, 'plan.title', 'Shape the day')}
                    </h1>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                        {translated(t, 'plan.subtitle', 'Choose what matters, reserve time, and keep everything else out of the way.')}
                    </p>
                </div>
            </header>

            <nav
                aria-label={translated(t, 'plan.sections', 'Planning sections')}
                className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
            >
                {PLAN_TABS.map((tab) => {
                    const active = activeSection === tab.id;
                    const label = translated(t, tab.labelKey, tab.fallback);
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => onNavigate(tab.view)}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                                'inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                                active
                                    ? 'bg-foreground text-background shadow-sm'
                                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                            )}
                        >
                            <tab.icon className="h-4 w-4" aria-hidden="true" />
                            {label}
                        </button>
                    );
                })}
            </nav>

            <div className="min-w-0">{children}</div>
        </section>
    );
}

export function LaterView({ activeList, onNavigate }: LaterViewProps) {
    const { t } = useLanguage();
    const waitingLabel = translated(t, 'nav.waiting', 'Waiting');
    const somedayLabel = translated(t, 'nav.someday', 'Someday');

    return (
        <div className="space-y-4">
            <div className="inline-flex rounded-lg border border-border/70 bg-muted/35 p-1" aria-label={translated(t, 'plan.later', 'Later')}>
                {([
                    ['waiting', waitingLabel],
                    ['someday', somedayLabel],
                ] as const).map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onNavigate(id)}
                        aria-pressed={activeList === id}
                        className={cn(
                            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                            activeList === id
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <ListView
                title={activeList === 'waiting' ? waitingLabel : somedayLabel}
                statusFilter={activeList}
            />
        </div>
    );
}
