import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ArrowRight, CheckCircle2, ClipboardList, Clock3, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { Area, Project, Task, TaskPriority, TimeEstimate } from '@mindwtr/core';

import { cn } from '../lib/utils';
import {
    InboxProcessingScheduleFields,
    type InboxProcessingScheduleFieldKey,
    type InboxProcessingScheduleFieldsControls,
} from './InboxProcessingScheduleFields';

type QuickActionabilityChoice = 'actionable' | 'later' | 'trash' | 'someday' | 'reference';
type QuickTwoMinuteChoice = 'yes' | 'no';
type QuickExecutionChoice = 'defer' | 'delegate';

export type InboxProcessingQuickPanelProps = {
    t: (key: string) => string;
    processingTask: Task;
    remainingCount: number;
    processingTitle: string;
    processingDescription: string;
    setProcessingTitle: (value: string) => void;
    setProcessingDescription: (value: string) => void;
    processingMode: 'guided' | 'quick';
    onModeChange: (mode: 'guided' | 'quick') => void;
    onSkip: () => void;
    onClose: () => void;
    showReferenceOption: boolean;
    actionabilityChoice: QuickActionabilityChoice;
    setActionabilityChoice: (value: QuickActionabilityChoice) => void;
    twoMinuteChoice: QuickTwoMinuteChoice;
    setTwoMinuteChoice: (value: QuickTwoMinuteChoice) => void;
    executionChoice: QuickExecutionChoice;
    setExecutionChoice: (value: QuickExecutionChoice) => void;
    showScheduleFields: boolean;
    scheduleFields: InboxProcessingScheduleFieldsControls;
    visibleScheduleFieldKeys: InboxProcessingScheduleFieldKey[];
    delegateWho: string;
    setDelegateWho: (value: string) => void;
    delegateFollowUp: string;
    setDelegateFollowUp: (value: string) => void;
    onSendDelegateRequest: () => void;
    selectedContexts: string[];
    contextsDraft: string;
    selectedTags: string[];
    tagsDraft: string;
    selectedEnergyLevel?: Task['energyLevel'];
    setSelectedEnergyLevel: (value: Task['energyLevel']) => void;
    selectedAssignedTo: string;
    setSelectedAssignedTo: (value: string) => void;
    personOptions: string[];
    selectedTimeEstimate?: TimeEstimate;
    setSelectedTimeEstimate: (value: TimeEstimate | undefined) => void;
    timeEstimateOptions: TimeEstimate[];
    showContextsField: boolean;
    showTagsField: boolean;
    showEnergyLevelField: boolean;
    showAssignedToField: boolean;
    showTimeEstimateField: boolean;
    showPriorityField: boolean;
    selectedPriority?: TaskPriority;
    setSelectedPriority: (value: TaskPriority | undefined) => void;
    onContextsInputChange: (value: string) => void;
    onTagsInputChange: (value: string) => void;
    toggleContext: (ctx: string) => void;
    toggleTag: (tag: string) => void;
    suggestedContexts: string[];
    suggestedTags: string[];
    allContexts: string[];
    allTags: string[];
    projects: Project[];
    areas: Area[];
    selectedProjectId: string | null;
    setSelectedProjectId: (value: string | null) => void;
    selectedAreaId: string | null;
    setSelectedAreaId: (value: string | null) => void;
    showProjectField: boolean;
    showAreaField: boolean;
    convertToProject: boolean;
    setConvertToProject: (value: boolean) => void;
    projectTitleDraft: string;
    setProjectTitleDraft: (value: string) => void;
    nextActionDraft: string;
    setNextActionDraft: (value: string) => void;
    addProject: (title: string, color: string, initialProps?: Partial<Project>) => Promise<Project | null>;
    onSubmit: () => void | Promise<void>;
};

export type {
    QuickActionabilityChoice,
    QuickExecutionChoice,
    QuickTwoMinuteChoice,
};

const shouldCommitFromEnter = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target.closest('button, [role="button"], [role="option"], [role="listbox"]')) return false;
    const tagName = target.tagName.toLowerCase();
    return tagName === 'input' && (target as HTMLInputElement).type !== 'date' && (target as HTMLInputElement).type !== 'time';
};

const isSubmitShortcut = (event: Pick<KeyboardEvent | globalThis.KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>): boolean => (
    event.key === 'Enter' && !event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey)
);

export function InboxProcessingQuickPanel(props: InboxProcessingQuickPanelProps) {
    const {
        t,
        processingTask,
        remainingCount,
        processingTitle,
        processingDescription,
        setProcessingTitle,
        setProcessingDescription,
        onModeChange,
        onSkip,
        onClose,
        actionabilityChoice,
        setActionabilityChoice,
        scheduleFields,
        onSubmit,
    } = props;
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        panelRef.current?.scrollIntoView?.({ block: 'start' });
    }, [processingTask.id]);

    useEffect(() => {
        const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
            if (!isSubmitShortcut(event)) return;
            event.preventDefault();
            void onSubmit();
        };
        document.addEventListener('keydown', handleDocumentKeyDown);
        return () => document.removeEventListener('keydown', handleDocumentKeyDown);
    }, [onSubmit]);

    const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.key === 'Process' || event.nativeEvent.isComposing) return;
        if (isSubmitShortcut(event) || event.key !== 'Enter' || event.shiftKey || event.altKey) return;
        if (!shouldCommitFromEnter(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        void onSubmit();
    };

    const decisions: Array<{
        choice: QuickActionabilityChoice;
        icon: typeof CheckCircle2;
        label: string;
        activeClass: string;
    }> = [
        { choice: 'actionable', icon: CheckCircle2, label: t('list.next'), activeClass: 'border-primary bg-primary text-primary-foreground' },
        { choice: 'later', icon: Clock3, label: t('process.later'), activeClass: 'border-info/50 bg-info/10 text-info' },
        { choice: 'someday', icon: Clock3, label: t('process.someday'), activeClass: 'border-status-someday/50 bg-status-someday/10 text-status-someday' },
        { choice: 'trash', icon: Trash2, label: t('process.trash'), activeClass: 'border-destructive/50 bg-destructive/10 text-destructive' },
    ];

    return (
        <div
            ref={panelRef}
            className="overflow-visible border-y border-border/70 bg-card/40 py-1 animate-in fade-in"
            onKeyDown={handlePanelKeyDown}
            data-testid="simple-inbox-processing"
        >
            <header className="flex flex-wrap items-center justify-between gap-3 px-1 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <h2 className="truncate text-sm font-semibold">{t('process.title')}</h2>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {remainingCount} {t('process.remaining')}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => onModeChange('guided')}
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('common.more')}
                    </button>
                    <button type="button" onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground">
                        {t('inbox.skip')}
                    </button>
                    <button type="button" onClick={onClose} aria-label={t('common.close')} className="text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
            </header>

            <div className="space-y-5 px-1 py-5">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                    <div>
                        <label htmlFor="simple-inbox-title" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                            {t('taskEdit.titleLabel')}
                        </label>
                        <input
                            id="simple-inbox-title"
                            value={processingTitle}
                            onChange={(event) => setProcessingTitle(event.target.value)}
                            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                    </div>
                    <div>
                        <label htmlFor="simple-inbox-description" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                            {t('taskEdit.descriptionLabel')}
                        </label>
                        <textarea
                            id="simple-inbox-description"
                            value={processingDescription}
                            onChange={(event) => setProcessingDescription(event.target.value)}
                            placeholder={t('taskEdit.descriptionPlaceholder')}
                            rows={2}
                            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                    </div>
                </div>

                <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold">{t('process.actionable')}</legend>
                    <p className="text-xs leading-5 text-muted-foreground">{t('process.quickDesc')}</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {decisions.map(({ choice, icon: Icon, label, activeClass }) => {
                            const active = actionabilityChoice === choice;
                            return (
                                <button
                                    key={choice}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => setActionabilityChoice(choice)}
                                    className={cn(
                                        'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                                        active ? activeClass : 'border-border bg-background text-foreground hover:bg-muted/50',
                                    )}
                                >
                                    <Icon className="h-4 w-4" aria-hidden="true" />
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </fieldset>

                {actionabilityChoice === 'later' ? (
                    <div className="border-l-2 border-info/50 pl-4">
                        <p className="mb-3 text-xs leading-5 text-muted-foreground">{t('process.laterHint')}</p>
                        <InboxProcessingScheduleFields
                            t={t}
                            fields={scheduleFields}
                            visibleFieldKeys={['start']}
                            variant="quick"
                        />
                    </div>
                ) : null}

                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
                    <p className="max-w-xl text-xs leading-5 text-muted-foreground">
                        {actionabilityChoice === 'actionable' ? t('process.quickApplyHint') : t('process.quickMoveHint')}
                    </p>
                    <button
                        type="button"
                        onClick={() => void onSubmit()}
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-5 text-sm font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                        {t('process.next')}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                </footer>
            </div>
        </div>
    );
}
