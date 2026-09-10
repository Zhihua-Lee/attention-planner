import type { FormEvent, ReactNode, RefObject } from 'react';
import type {
    Area,
    Project,
    TaskPriority,
    TaskSortBy,
    TaskStatus,
    TimeEstimate,
} from '@mindwtr/core';
import { DEFAULT_AREA_COLOR, tFallback } from '@mindwtr/core';
import { AlertTriangle, Folder } from 'lucide-react';

import { ListBulkActions } from './ListBulkActions';
import { BulkSelectionToolbar } from './BulkSelectionToolbar';
import { ListFiltersPanel } from './ListFiltersPanel';
import { ListHeader } from './ListHeader';
import { ListQuickAdd } from './ListQuickAdd';
import type { TaskListGroupBy } from './next-grouping';

const NEXT_WARNING_THRESHOLD = 15;

type ListControlsPanelProps = {
    activeGroupBy: TaskListGroupBy;
    addInputRef: RefObject<HTMLInputElement | null>;
    allTokens: string[];
    areaById: Map<string, Area>;
    areaOptions: Array<{ id: string; name: string }>;
    deferredProjects: Project[];
    densityMode: 'comfortable' | 'compact' | 'condensed';
    formatEstimate: (estimate: TimeEstimate) => string;
    filterSummaryLabel: string;
    filterSummarySuffix: string;
    hasFilters: boolean;
    inboxProcessor: ReactNode;
    isBatchDeleting: boolean;
    bulkMoveCurrentStatus: TaskStatus | 'all';
    showGroupBy: boolean;
    isNextView: boolean;
    isProcessing: boolean;
    isWaitingView: boolean;
    onAddContext: () => void;
    onAddTag: () => void;
    onAssignArea: (areaId: string | null) => Promise<void>;
    onBulkOrganize?: () => void;
    groupByOptions: readonly TaskListGroupBy[];
    sortByOptions?: readonly TaskSortBy[];
    onChangeGroupBy: (value: TaskListGroupBy) => void;
    onChangeQuickAdd: (value: string) => void;
    onChangeSearch: (value: string) => void;
    onChangeSelectedWaitingPerson: (value: string) => void;
    onChangeSortBy: (value: TaskSortBy) => void;
    onClearFilters: () => void;
    onClearSelection: () => void;
    onClearSelectedWaitingPerson: () => void;
    onCreateProject: (title: string) => Promise<string | null>;
    onDeleteSelection: () => Promise<void>;
    onMoveToStatus: (status: TaskStatus) => Promise<void>;
    onOpenAudioQuickAdd: () => void;
    onOpenContentQuickAdd: () => void;
    onOpenProject: (projectId: string) => void;
    onReactivateProject: (projectId: string) => void;
    onRemoveContext: () => void;
    onRemoveTag: () => void;
    disableRemoveTag?: boolean;
    onResetCopilot: () => void;
    onSubmitQuickAdd: (event: FormEvent) => void;
    onSelectAllVisible: () => void;
    onToggleDetails: () => void;
    onToggleEstimate: (estimate: TimeEstimate) => void;
    onToggleFiltersOpen: () => void;
    onTogglePriority: (priority: TaskPriority) => void;
    onToggleSelection: () => void;
    onToggleToken: (token: string) => void;
    onToggleDensity: () => void;
    showPriorityFilters: boolean;
    priorityOptions: TaskPriority[];
    projects: Project[];
    quickAddFooter?: ReactNode;
    quickAddValue: string;
    searchQuery: string;
    selectedCount: number;
    allVisibleTasksSelected: boolean;
    selectedPriorities: TaskPriority[];
    selectedTimeEstimates: TimeEstimate[];
    selectedTokens: string[];
    selectedWaitingPerson: string;
    selectionMode: boolean;
    showDeferredProjectSection: boolean;
    showFilters: boolean;
    showFiltersPanel: boolean;
    showListDetails: boolean;
    showQuickAdd: boolean;
    showViewFilterInput: boolean;
    sortBy: TaskSortBy;
    t: (key: string) => string;
    taskCount: number;
    timeEstimateOptions: TimeEstimate[];
    showTimeEstimateFilters: boolean;
    title: string;
    tokenCounts: Record<string, number>;
    waitingPeople: string[];
    areas: Area[];
    people: readonly string[];
    nextCount: number;
};

export function ListControlsPanel({
    activeGroupBy,
    addInputRef,
    allTokens,
    areaById,
    areaOptions,
    deferredProjects,
    densityMode,
    formatEstimate,
    filterSummaryLabel,
    filterSummarySuffix,
    hasFilters,
    inboxProcessor,
    isBatchDeleting,
    bulkMoveCurrentStatus,
    showGroupBy,
    isNextView,
    isProcessing,
    isWaitingView,
    onAddContext,
    onAddTag,
    onAssignArea,
    onBulkOrganize,
    groupByOptions,
    sortByOptions,
    onChangeGroupBy,
    onChangeQuickAdd,
    onChangeSearch,
    onChangeSelectedWaitingPerson,
    onChangeSortBy,
    onClearFilters,
    onClearSelection,
    onClearSelectedWaitingPerson,
    onCreateProject,
    onDeleteSelection,
    onMoveToStatus,
    onOpenAudioQuickAdd,
    onOpenContentQuickAdd,
    onOpenProject,
    onReactivateProject,
    onRemoveContext,
    onRemoveTag,
    disableRemoveTag,
    onResetCopilot,
    onSubmitQuickAdd,
    onSelectAllVisible,
    onToggleDetails,
    onToggleEstimate,
    onToggleFiltersOpen,
    onTogglePriority,
    onToggleSelection,
    onToggleToken,
    onToggleDensity,
    showPriorityFilters,
    priorityOptions,
    projects,
    quickAddFooter,
    quickAddValue,
    searchQuery,
    selectedCount,
    allVisibleTasksSelected,
    selectedPriorities,
    selectedTimeEstimates,
    selectedTokens,
    selectedWaitingPerson,
    selectionMode,
    showDeferredProjectSection,
    showFilters,
    showFiltersPanel,
    showListDetails,
    showQuickAdd,
    showViewFilterInput,
    sortBy,
    t,
    taskCount,
    timeEstimateOptions,
    showTimeEstimateFilters,
    title,
    tokenCounts,
    waitingPeople,
    areas,
    people,
    nextCount,
}: ListControlsPanelProps) {
    return (
        <div className="space-y-6">
            <ListHeader
                title={title}
                showNextCount={isNextView}
                nextCount={nextCount}
                taskCount={taskCount}
                hasFilters={hasFilters}
                filterSummaryLabel={filterSummaryLabel}
                filterSummarySuffix={filterSummarySuffix}
                sortBy={sortBy}
                onChangeSortBy={onChangeSortBy}
                showGroupBy={showGroupBy}
                groupBy={activeGroupBy}
                groupByOptions={groupByOptions}
                sortByOptions={sortByOptions}
                onChangeGroupBy={onChangeGroupBy}
                showFiltersButton={showFilters}
                filtersOpen={showFiltersPanel}
                onToggleFilters={onToggleFiltersOpen}
                selectionMode={selectionMode}
                onToggleSelection={onToggleSelection}
                showListDetails={showListDetails}
                onToggleDetails={onToggleDetails}
                densityMode={densityMode}
                onToggleDensity={onToggleDensity}
                t={t}
            />

            {isBatchDeleting && (
                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    {t('bulk.deleting') || 'Deleting selected tasks...'}
                </div>
            )}

            {selectionMode && (
                <div className="space-y-3">
                    <BulkSelectionToolbar
                        selectionCount={selectedCount}
                        totalCount={taskCount}
                        allSelected={allVisibleTasksSelected}
                        onSelectAll={onSelectAllVisible}
                        onClearSelection={onClearSelection}
                        t={t}
                    />
                    {selectedCount > 0 && (
                        <ListBulkActions
                            selectionCount={selectedCount}
                            currentStatus={bulkMoveCurrentStatus}
                            onMoveToStatus={onMoveToStatus}
                            onAssignArea={onAssignArea}
                            areaOptions={areaOptions}
                            onBulkOrganize={onBulkOrganize}
                            onAddTag={onAddTag}
                            onRemoveTag={onRemoveTag}
                            disableRemoveTag={disableRemoveTag}
                            onAddContext={onAddContext}
                            onRemoveContext={onRemoveContext}
                            onDelete={onDeleteSelection}
                            isDeleting={isBatchDeleting}
                            t={t}
                        />
                    )}
                </div>
            )}

            {isNextView && nextCount > NEXT_WARNING_THRESHOLD && (
                <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
                    <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
                    <div>
                        <p className="font-medium text-warning">
                            {nextCount} {t('next.warningCount')}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {t('next.warningHint')}
                        </p>
                    </div>
                </div>
            )}

            {showDeferredProjectSection && (
                <div className="rounded-lg border border-border bg-card/50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('projects.title') || 'Projects'}
                    </div>
                    <div className="mt-3 space-y-2">
                        {deferredProjects.map((project) => {
                            const projectArea = project.areaId ? areaById.get(project.areaId) : undefined;
                            return (
                                <div
                                    key={project.id}
                                    className="flex w-full items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
                                >
                                    <button
                                        type="button"
                                        onClick={() => onOpenProject(project.id)}
                                        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-primary"
                                        aria-label={`${t('projects.title') || 'Project'}: ${project.title}`}
                                    >
                                        <Folder className="h-4 w-4 shrink-0" style={{ color: project.color }} />
                                        <span className="truncate text-sm font-medium text-foreground">{project.title}</span>
                                        {projectArea && (
                                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <span
                                                    className="h-2 w-2 rounded-full"
                                                    style={{ backgroundColor: projectArea.color || DEFAULT_AREA_COLOR }}
                                                />
                                                {projectArea.name}
                                            </span>
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onReactivateProject(project.id)}
                                        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                    >
                                        {t('projects.reactivate')}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {inboxProcessor}

            {showViewFilterInput && !isProcessing && (
                <input
                    type="text"
                    data-view-filter-input
                    placeholder={t('common.search')}
                    aria-label={t('common.search')}
                    value={searchQuery}
                    onChange={(event) => onChangeSearch(event.target.value)}
                    className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
            )}

            {isWaitingView && !isProcessing && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">{t('process.delegateWhoLabel')}</span>
                    <select
                        aria-label={t('process.delegateWhoLabel')}
                        value={selectedWaitingPerson}
                        onChange={(event) => onChangeSelectedWaitingPerson(event.target.value)}
                        className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                        <option value="">{t('common.all')}</option>
                        {waitingPeople.map((person) => (
                            <option key={person} value={person}>
                                {person}
                            </option>
                        ))}
                    </select>
                    {selectedWaitingPerson && (
                        <button
                            type="button"
                            onClick={onClearSelectedWaitingPerson}
                            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        >
                            {t('common.clear')}
                        </button>
                    )}
                </div>
            )}

            {showFilters && showFiltersPanel && !isProcessing && (
                <ListFiltersPanel
                    t={t}
                    hasFilters={hasFilters}
                    onClearFilters={onClearFilters}
                    allTokens={allTokens}
                    selectedTokens={selectedTokens}
                    tokenCounts={tokenCounts}
                    onToggleToken={onToggleToken}
                    showPriorityFilters={showPriorityFilters}
                    priorityOptions={priorityOptions}
                    selectedPriorities={selectedPriorities}
                    onTogglePriority={onTogglePriority}
                    showTimeEstimateFilters={showTimeEstimateFilters}
                    timeEstimateOptions={timeEstimateOptions}
                    selectedTimeEstimates={selectedTimeEstimates}
                    onToggleEstimate={onToggleEstimate}
                    formatEstimate={formatEstimate}
                />
            )}

            {showQuickAdd && (
                <>
                    <ListQuickAdd
                        value={quickAddValue}
                        inputRef={addInputRef}
                        projects={projects}
                        areas={areas}
                        contexts={allTokens}
                        people={people}
                        t={t}
                        dense={densityMode !== 'comfortable'}
                        onCreateProject={onCreateProject}
                        onChange={onChangeQuickAdd}
                        onSubmit={onSubmitQuickAdd}
                        onOpenAudio={onOpenAudioQuickAdd}
                        onResetCopilot={onResetCopilot}
                    />
                    <button type="button" onClick={onOpenContentQuickAdd}
                        className="min-h-11 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-primary">
                        {tFallback(t, 'quickAdd.contentAndSteps', 'Content and steps')}
                    </button>
                    {quickAddFooter}
                </>
            )}
        </div>
    );
}
