import { useState, useMemo, useEffect, useCallback, useRef, useLayoutEffect, type Key, type ReactNode, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
    Attachment,
    Task,
    collectBulkTaskTokens,
    compareTasksByProjectOrder,
    getSequentialProjectTaskCues,
    type BulkOrganizeTaskUpdateInput,
    type Project,
    type ProjectSequenceTaskCue,
    type Section,
    type TaskSortBy,
    generateUUID,
    sortTasksBy,
    splitCompletedTasks,
} from '@mindwtr/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronRight, FileText, Folder, PanelLeftOpen, Pencil, Plus, Trash2, X } from 'lucide-react';

import { PromptModal } from '../../PromptModal';
import { browseForLinkTarget } from '../../../lib/attachment-import';
import { isTauriRuntime } from '../../../lib/runtime';
import { TokenPickerModal } from '../../TokenPickerModal';
import { TaskItem } from '../../TaskItem';
import { useUiStore } from '../../../store/ui-store';
import { BulkSelectionToolbar } from '../list/BulkSelectionToolbar';
import { SortBySelect } from '../list/list-toolbar';
import { sortDoneTasksForListView } from '../list/done-sort';
import { useTaskListScope } from '../list/task-list-scope';
import { useTaskSelection } from '../list/useTaskSelection';
import { ListBulkActions } from '../list/ListBulkActions';
import { TaskBulkOrganizeModal } from '../list/TaskBulkOrganizeModal';
import { normalizeAttachmentInput } from '../../../lib/attachment-utils';
import { cn } from '../../../lib/utils';
import { reportError } from '../../../lib/report-error';
import { useProjectAttachmentActions } from './useProjectAttachmentActions';
import { useProjectSectionActions } from './useProjectSectionActions';
import { useProjectWorkspaceStore } from './useProjectWorkspaceStore';
import { ProjectDetailsHeader } from './ProjectDetailsHeader';
import { ProjectDetailsFields } from './ProjectDetailsFields';
import { ProjectNotesSection } from './ProjectNotesSection';
import { DraggableProjectTaskRow, SortableProjectTaskRow } from './SortableRows';
import { SectionDropZone, getSectionContainerId, getSectionIdFromContainer, NO_SECTION_CONTAINER } from './section-dnd';
import {
    DEFAULT_AREA_COLOR,
    getProjectColor,
    parseTagInput,
    toDateInputValue,
} from './projects-utils';
import { toDateTimeLocalValue } from '../../Task/task-item-helpers';
import type { ConfirmationRequestOptions } from '../../../hooks/useConfirmDialog';

const PROJECT_TASK_VIRTUALIZATION_THRESHOLD = 80;
const PROJECT_TASK_ROW_ESTIMATE = 88;
const PROJECT_TASK_VIRTUAL_OVERSCAN = 8;
const PROJECT_TASK_VIRTUAL_INITIAL_HEIGHT = 720;
const PROJECT_TASK_TOOLBAR_COLLAPSE_SCROLL_Y = 96;
const PROJECT_TASK_TOOLBAR_EXPAND_SCROLL_Y = 8;

type ProjectScrollSnapshot = {
    scrollTop: number;
    scrollLeft: number;
    projectId: string | null;
    anchorKey?: string;
    anchorTop?: number;
};

const PROJECT_SCROLL_ANCHOR_SELECTOR = '[data-task-id],[data-project-completed-toggle]';

const getProjectScrollAnchorKey = (element: HTMLElement): string | null => {
    const taskId = element.getAttribute('data-task-id');
    if (taskId) return `task:${taskId}`;
    if (element.hasAttribute('data-project-completed-toggle')) return 'completed-toggle';
    return null;
};

const findProjectScrollAnchorByKey = (scrollElement: HTMLElement, anchorKey: string): HTMLElement | null => (
    Array.from(scrollElement.querySelectorAll<HTMLElement>(PROJECT_SCROLL_ANCHOR_SELECTOR))
        .find((element) => getProjectScrollAnchorKey(element) === anchorKey) ?? null
);

const createProjectScrollSnapshot = (scrollElement: HTMLElement, projectId: string | null): ProjectScrollSnapshot => {
    const snapshot: ProjectScrollSnapshot = {
        scrollTop: scrollElement.scrollTop,
        scrollLeft: scrollElement.scrollLeft,
        projectId,
    };
    const scrollRect = scrollElement.getBoundingClientRect();
    const visibleAnchor = Array.from(scrollElement.querySelectorAll<HTMLElement>(PROJECT_SCROLL_ANCHOR_SELECTOR))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => (
            Number.isFinite(rect.top)
            && Number.isFinite(rect.bottom)
            && rect.bottom > scrollRect.top
            && rect.top < scrollRect.bottom
        ))
        .sort((a, b) => Math.abs(a.rect.top - scrollRect.top) - Math.abs(b.rect.top - scrollRect.top))[0];
    if (!visibleAnchor) return snapshot;
    const anchorKey = getProjectScrollAnchorKey(visibleAnchor.element);
    if (!anchorKey) return snapshot;
    return {
        ...snapshot,
        anchorKey,
        anchorTop: visibleAnchor.rect.top,
    };
};

const restoreProjectScrollSnapshot = (scrollElement: HTMLElement, snapshot: ProjectScrollSnapshot) => {
    scrollElement.scrollTop = snapshot.scrollTop;
    scrollElement.scrollLeft = snapshot.scrollLeft;

    if (!snapshot.anchorKey || typeof snapshot.anchorTop !== 'number') return;
    const anchor = findProjectScrollAnchorByKey(scrollElement, snapshot.anchorKey);
    if (!anchor) return;
    const nextAnchorTop = anchor.getBoundingClientRect().top;
    const delta = nextAnchorTop - snapshot.anchorTop;
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return;
    scrollElement.scrollTop += delta;
};

type ProjectTaskRowsProps = {
    tasks: readonly Task[];
    renderTask: (task: Task) => ReactNode;
    scrollRef: RefObject<HTMLDivElement | null>;
    pinnedTaskId?: string | null;
};

type ProjectTaskVirtualRow = {
    index: number;
    key: Key;
    start: number;
};

function ProjectTaskRows({ tasks, renderTask, scrollRef, pinnedTaskId }: ProjectTaskRowsProps) {
    const shouldVirtualize = tasks.length > PROJECT_TASK_VIRTUALIZATION_THRESHOLD;
    const listRef = useRef<HTMLDivElement | null>(null);
    const [scrollMargin, setScrollMargin] = useState(0);

    const updateScrollMargin = useCallback(() => {
        const scrollElement = scrollRef.current;
        const listElement = listRef.current;
        if (!scrollElement || !listElement) return;

        const scrollRect = scrollElement.getBoundingClientRect();
        const listRect = listElement.getBoundingClientRect();
        setScrollMargin(listRect.top - scrollRect.top + scrollElement.scrollTop);
    }, [scrollRef]);

    useLayoutEffect(() => {
        if (!shouldVirtualize) return;

        updateScrollMargin();

        if (typeof window === 'undefined') return;

        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(updateScrollMargin)
            : null;

        if (resizeObserver) {
            if (scrollRef.current) resizeObserver.observe(scrollRef.current);
            if (listRef.current) resizeObserver.observe(listRef.current);
        }

        window.addEventListener('resize', updateScrollMargin);
        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener('resize', updateScrollMargin);
        };
    }, [shouldVirtualize, scrollRef, tasks.length, updateScrollMargin]);

    useLayoutEffect(() => {
        if (shouldVirtualize) updateScrollMargin();
    });

    const rowVirtualizer = useVirtualizer({
        count: shouldVirtualize ? tasks.length : 0,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => PROJECT_TASK_ROW_ESTIMATE,
        overscan: PROJECT_TASK_VIRTUAL_OVERSCAN,
        getItemKey: (index) => tasks[index]?.id ?? index,
        initialRect: { width: 0, height: PROJECT_TASK_VIRTUAL_INITIAL_HEIGHT },
        scrollMargin,
    });

    if (!shouldVirtualize) {
        return (
            <div className="divide-y divide-border/30">
                {tasks.map((task) => renderTask(task))}
            </div>
        );
    }

    const virtualRows = rowVirtualizer.getVirtualItems();
    let rowsToRender: ProjectTaskVirtualRow[] = virtualRows.length > 0
        ? virtualRows.map((row) => ({
            index: row.index,
            key: row.key,
            start: row.start,
        }))
        : Array.from({
            length: Math.min(
                tasks.length,
                Math.ceil(PROJECT_TASK_VIRTUAL_INITIAL_HEIGHT / PROJECT_TASK_ROW_ESTIMATE)
                    + PROJECT_TASK_VIRTUAL_OVERSCAN * 2,
            ),
        }, (_, index) => ({
            index,
            key: tasks[index]?.id ?? index,
            start: index * PROJECT_TASK_ROW_ESTIMATE,
        }));
    const pinnedTaskIndex = pinnedTaskId
        ? tasks.findIndex((task) => task.id === pinnedTaskId)
        : -1;
    if (pinnedTaskIndex >= 0 && !rowsToRender.some((row) => row.index === pinnedTaskIndex)) {
        rowsToRender = [
            ...rowsToRender,
            {
                index: pinnedTaskIndex,
                key: tasks[pinnedTaskIndex]?.id ?? pinnedTaskIndex,
                start: pinnedTaskIndex * PROJECT_TASK_ROW_ESTIMATE,
            },
        ].sort((a, b) => a.index - b.index);
    }
    const totalSize = rowVirtualizer.getTotalSize() || tasks.length * PROJECT_TASK_ROW_ESTIMATE;

    return (
        <div
            ref={listRef}
            data-virtualized-task-list="true"
            className="relative"
            style={{ height: totalSize }}
        >
            {rowsToRender.map((virtualRow) => {
                const task = tasks[virtualRow.index];
                if (!task) return null;

                return (
                    <div
                        key={virtualRow.key}
                        ref={virtualRows.length > 0 ? rowVirtualizer.measureElement : undefined}
                        data-index={virtualRow.index}
                        className="absolute left-0 top-0 w-full border-b border-border/30"
                        style={{
                            transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                        }}
                    >
                        {renderTask(task)}
                    </div>
                );
            })}
        </div>
    );
}

type BulkTokenPickerState = {
    field: 'tags' | 'contexts';
    action: 'add' | 'remove';
} | null;

// The workspace reads its store data and actions itself (useProjectWorkspaceStore
// + useUiStore); only genuinely wrapper-owned state stays a prop. Store slices
// re-threaded through ProjectsView were removed (arch review 2026-07-20 #8).
type ProjectWorkspaceProps = {
    // Cross-view navigation highlight — set from other views, cleared here.
    highlightTaskId: string | null;
    // Area-creation-in-progress flag; drives the shared workspace loading banner.
    isAreaCreating: boolean;
    // Project-creation-in-progress flag; drives the shared loading banner.
    isCreatingProject: boolean;
    // App language (React context); threaded so tests keep translation control.
    language: string;
    // Duplicate-then-select action; also wired to the sidebar in ProjectsView.
    onDuplicateProject: (projectId: string) => Promise<void> | void;
    // Opens the AreaManagerModal, whose open/close state lives in ProjectsView.
    onManageAreas: () => void;
    // Opens the quick-area prompt, whose state lives in ProjectsView.
    onRequestQuickArea: (projectId: string) => void;
    // Setter for the persisted showCompletedTasks view state (localStorage).
    onToggleShowCompletedTasks: () => void;
    // The confirm-dialog host is rendered by ProjectsView.
    requestConfirmation: (options: ConfirmationRequestOptions) => Promise<boolean>;
    // Selection identity — owned by ProjectsView (UI store + reset effects).
    selectedProjectId: string | null;
    selectedAreaId?: string;
    // Persisted view state (localStorage) owned by ProjectsView.
    showCompletedTasks: boolean;
    // Translator (React context); threaded so tests keep translation control.
    t: (key: string) => string;
    // Wrapper layout state.
    projectsSidebarCollapsed?: boolean;
    // Toggles wrapper layout state.
    onToggleProjectsSidebar?: () => void;
    // ADR 0023: the Projects view owns the shared DndContext; the workspace
    // registers its in-list drag-end handling here so the view can delegate
    // non-sidebar drops.
    taskDragEndRef: RefObject<((event: DragEndEvent) => void) | null>;
};

export function shouldShowProjectWorkspaceTask(
    task: Task,
    project?: Project,
    showCompletedTasks = false,
): boolean {
    if (!project) return false;
    if (task.deletedAt || task.projectId !== project.id) return false;
    if (task.status === 'reference') return false;
    if (project.status === 'archived') return task.status === 'done' || task.status === 'archived';
    if (task.status === 'done') return showCompletedTasks;
    return task.status !== 'archived';
}

export function ProjectWorkspace({
    highlightTaskId,
    isAreaCreating,
    isCreatingProject,
    language,
    onDuplicateProject,
    onManageAreas,
    onRequestQuickArea,
    onToggleShowCompletedTasks,
    requestConfirmation,
    selectedProjectId,
    selectedAreaId,
    showCompletedTasks,
    t,
    projectsSidebarCollapsed = false,
    onToggleProjectsSidebar,
    taskDragEndRef,
}: ProjectWorkspaceProps) {
    const {
        projects,
        sections,
        areas,
        allTasks,
        undoNotificationsEnabled,
        addSection,
        updateSection,
        deleteSection,
        reorderSections,
        reorderProjectTasks,
        updateProject,
        deleteProject,
        restoreProject,
        updateTask,
        restoreTask,
        batchMoveTasks,
        batchDeleteTasks,
        batchUpdateTasks,
        setHighlightTask,
        allTokens,
        selectedProjectTasks,
        sortedAreas,
        areaById,
        noAreaId,
    } = useProjectWorkspaceStore(selectedProjectId);
    const showToast = useUiStore((state) => state.showToast);
    const setProjectView = useUiStore((state) => state.setProjectView);
    const setSelectedProjectId = useCallback(
        (value: string | null) => setProjectView({ selectedProjectId: value }),
        [setProjectView],
    );
    const selectedProject = useMemo(
        () => projects.find((project) => project.id === selectedProjectId),
        [projects, selectedProjectId],
    );
    const selectedArea = useMemo(
        () => selectedAreaId ? areas.find((area) => area.id === selectedAreaId) : undefined,
        [areas, selectedAreaId],
    );
    const [showNotesPreview, setShowNotesPreview] = useState(true);
    const [showSectionPrompt, setShowSectionPrompt] = useState(false);
    const [sectionDraft, setSectionDraft] = useState('');
    const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
    const [sectionNotesOpen, setSectionNotesOpen] = useState<Record<string, boolean>>({});
    const [tagDraft, setTagDraft] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const directAreaTasks = useMemo(() => allTasks.filter((task) => (
        !task.deletedAt
        && task.areaId === selectedAreaId
        && !task.projectId
        && task.status !== 'done'
        && task.status !== 'archived'
        && task.status !== 'reference'
        && (!searchQuery || task.title.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    )), [allTasks, searchQuery, selectedAreaId]);
    const [editProjectTitle, setEditProjectTitle] = useState('');
    // Effective sort is read straight from the selected project so it persists
    // across restarts and view switches; the change handler writes it back via
    // updateProject. Core normalizes 'default' to an absent field.
    const projectTaskSortBy: TaskSortBy = selectedProject?.taskSortBy ?? 'default';
    const [projectDetailsExpanded, setProjectDetailsExpanded] = useState(false);
    const [isProjectDeleting, setIsProjectDeleting] = useState(false);
    const [bulkTokenPicker, setBulkTokenPicker] = useState<BulkTokenPickerState>(null);
    const [bulkOrganizeOpen, setBulkOrganizeOpen] = useState(false);
    const [completedTasksCollapsed, setCompletedTasksCollapsed] = useState(true);
    const [projectTaskToolbarCompact, setProjectTaskToolbarCompact] = useState(false);
    const editingTaskId = useUiStore((state) => state.editingTaskId);
    const projectScrollRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const lastProjectScrollTopRef = useRef(0);
    const pendingProjectScrollRestoreRef = useRef<ProjectScrollSnapshot | null>(null);
    const selectedProjectIdRef = useRef<string | null>(selectedProjectId);
    const isArchivedProject = selectedProject?.status === 'archived';
    const shouldGroupCompletedTasks = Boolean(
        selectedProject && !selectedProject.isSequential && !isArchivedProject && showCompletedTasks
    );
    const resolveText = useCallback((key: string, fallback: string) => {
        const value = t(key);
        return value && value !== key ? value : fallback;
    }, [t]);

    useLayoutEffect(() => {
        selectedProjectIdRef.current = selectedProjectId;
    }, [selectedProjectId]);

    const captureProjectScrollBeforeLayoutChange = useCallback(() => {
        const scrollElement = projectScrollRef.current;
        if (!scrollElement) return;
        pendingProjectScrollRestoreRef.current = createProjectScrollSnapshot(scrollElement, selectedProjectIdRef.current);
    }, []);

    useLayoutEffect(() => {
        const snapshot = pendingProjectScrollRestoreRef.current;
        if (!snapshot) return;
        pendingProjectScrollRestoreRef.current = null;
        if (selectedProjectIdRef.current !== snapshot.projectId) return;
        const scrollElement = projectScrollRef.current;
        if (!scrollElement) return;
        restoreProjectScrollSnapshot(scrollElement, snapshot);
    });

    const handleProjectScroll = useCallback(() => {
        const scrollElement = projectScrollRef.current;
        if (!scrollElement) return;
        const scrollTop = scrollElement.scrollTop;
        const previousScrollTop = lastProjectScrollTopRef.current;

        setProjectTaskToolbarCompact((current) => {
            if (scrollTop <= PROJECT_TASK_TOOLBAR_EXPAND_SCROLL_Y) return false;
            if (current) return true;
            if (scrollTop > previousScrollTop && scrollTop >= PROJECT_TASK_TOOLBAR_COLLAPSE_SCROLL_Y) return true;
            return current;
        });
        lastProjectScrollTopRef.current = scrollTop;
    }, []);

    useEffect(() => {
        setProjectTaskToolbarCompact(false);
        lastProjectScrollTopRef.current = 0;
    }, [selectedProjectId]);

    const handleClearProjectSearch = useCallback(() => {
        setSearchQuery('');
        searchInputRef.current?.focus();
    }, []);

    const openProjectQuickAdd = useCallback((sectionId?: string | null) => {
        if (!selectedProject) return;
        window.dispatchEvent(new CustomEvent('mindwtr:quick-add', {
            detail: {
                initialProps: {
                    projectId: selectedProject.id,
                    status: 'next',
                    ...(sectionId ? { sectionId } : {}),
                },
            },
        }));
    }, [selectedProject]);

    const {
        handleAddSection,
        handleRenameSection,
        handleDeleteSection,
        handleToggleSection,
        handleToggleSectionNotes,
    } = useProjectSectionActions({
        t,
        selectedProject,
        setEditingSectionId,
        setSectionDraft,
        setShowSectionPrompt,
        deleteSection,
        updateSection,
        setSectionNotesOpen,
        requestConfirmation,
    });

    const normalizedSearchQuery = searchQuery.trim().toLowerCase();

    useEffect(() => {
        setEditProjectTitle(selectedProject?.title ?? '');
    }, [selectedProject?.id, selectedProject?.title]);

    useEffect(() => {
        if (!selectedProject) {
            setTagDraft('');
            return;
        }
        setTagDraft((selectedProject.tagIds || []).join(', '));
    }, [selectedProject?.id, selectedProject?.tagIds]);

    useEffect(() => {
        setProjectDetailsExpanded(false);
    }, [selectedProject?.id]);

    useEffect(() => {
        setCompletedTasksCollapsed(true);
    }, [selectedProject?.id, showCompletedTasks]);

    useEffect(() => {
        setSectionNotesOpen({});
    }, [selectedProjectId]);

    const projectTaskSource = selectedProjectTasks ?? allTasks;
    const projectAllTasks = useMemo(() => {
        if (!selectedProjectId) return [];
        return projectTaskSource.filter((task) => {
            if (task.deletedAt || task.projectId !== selectedProjectId) return false;
            if (normalizedSearchQuery && !task.title.toLowerCase().includes(normalizedSearchQuery)) return false;
            return true;
        });
    }, [projectTaskSource, normalizedSearchQuery, selectedProjectId]);

    const projectTasks = useMemo(
        () => projectAllTasks.filter((task) => shouldShowProjectWorkspaceTask(task, selectedProject, showCompletedTasks)),
        [projectAllTasks, selectedProject, showCompletedTasks],
    );

    const handleProjectTaskSortByChange = useCallback((next: TaskSortBy) => {
        if (!selectedProject) return;
        void Promise.resolve(updateProject(selectedProject.id, { taskSortBy: next })).catch((error) => {
            reportError('Failed to update project task sort', error);
        });
    }, [selectedProject, updateProject]);

    const sortProjectTasks = useCallback((items: Task[]) => {
        if (projectTaskSortBy !== 'default') {
            return sortTasksBy(items, projectTaskSortBy);
        }
        return [...items].sort(compareTasksByProjectOrder);
    }, [projectTaskSortBy]);

    const sortedProjectTasks = useMemo(() => {
        if (!selectedProject) return projectTasks;
        return sortProjectTasks(projectTasks);
    }, [projectTasks, selectedProject, sortProjectTasks]);

    const { activeTasks: orderedProjectTasks, completedTasks: completedProjectTasks } = useMemo(() => {
        if (!shouldGroupCompletedTasks) {
            return { activeTasks: sortedProjectTasks, completedTasks: [] as Task[] };
        }
        const { activeTasks, completedTasks } = splitCompletedTasks(sortedProjectTasks);
        return {
            activeTasks,
            completedTasks: sortDoneTasksForListView(completedTasks),
        };
    }, [shouldGroupCompletedTasks, sortedProjectTasks]);

    const projectSections = useMemo(() => {
        if (!selectedProjectId) return [];
        return sections
            .filter((section) => section.projectId === selectedProjectId && !section.deletedAt)
            .sort((a, b) => {
                const aOrder = Number.isFinite(a.order) ? a.order : 0;
                const bOrder = Number.isFinite(b.order) ? b.order : 0;
                if (aOrder !== bOrder) return aOrder - bOrder;
                return a.title.localeCompare(b.title);
            });
    }, [sections, selectedProjectId]);

    const handleMoveSection = useCallback((sectionId: string, offset: -1 | 1) => {
        if (!selectedProject) return;
        const currentIndex = projectSections.findIndex((section) => section.id === sectionId);
        const nextIndex = currentIndex + offset;
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= projectSections.length) return;
        const nextSections = [...projectSections];
        const [moved] = nextSections.splice(currentIndex, 1);
        if (!moved) return;
        nextSections.splice(nextIndex, 0, moved);
        void Promise.resolve(reorderSections(selectedProject.id, nextSections.map((section) => section.id))).catch((error) => {
            reportError('Failed to reorder sections', error);
            showToast(resolveText('projects.sectionReorderFailed', 'Failed to reorder sections.'), 'error');
        });
    }, [projectSections, reorderSections, resolveText, selectedProject, showToast]);

    const sectionTaskGroups = useMemo(() => {
        if (!selectedProjectId || projectSections.length === 0) {
            return { sections: [] as Array<{ section: Section; tasks: Task[] }>, unsectioned: orderedProjectTasks };
        }

        const sectionIds = new Set(projectSections.map((section) => section.id));
        const tasksBySection = new Map<string, Task[]>();
        const unsectioned: Task[] = [];

        orderedProjectTasks.forEach((task) => {
            const sectionId = task.sectionId && sectionIds.has(task.sectionId) ? task.sectionId : null;
            if (sectionId) {
                const list = tasksBySection.get(sectionId) ?? [];
                list.push(task);
                tasksBySection.set(sectionId, list);
            } else {
                unsectioned.push(task);
            }
        });

        return {
            sections: projectSections.map((section) => ({
                section,
                tasks: sortProjectTasks(tasksBySection.get(section.id) ?? []),
            })),
            unsectioned: sortProjectTasks(unsectioned),
        };
    }, [orderedProjectTasks, projectSections, selectedProjectId, sortProjectTasks]);

    const orderedProjectTaskList = useMemo(() => {
        if (projectSections.length === 0) return [...orderedProjectTasks, ...completedProjectTasks];
        const combined: Task[] = [];
        sectionTaskGroups.sections.forEach((group) => {
            combined.push(...group.tasks);
        });
        if (sectionTaskGroups.unsectioned.length > 0) {
            combined.push(...sectionTaskGroups.unsectioned);
        }
        if (completedProjectTasks.length > 0) {
            combined.push(...completedProjectTasks);
        }
        return combined;
    }, [completedProjectTasks, orderedProjectTasks, projectSections.length, sectionTaskGroups.sections, sectionTaskGroups.unsectioned]);
    const projectTaskSequenceCues = useMemo<Map<string, ProjectSequenceTaskCue>>(() => {
        if (!selectedProject || projectTaskSortBy !== 'default') return new Map();
        return getSequentialProjectTaskCues(selectedProject, orderedProjectTaskList, {
            sectionIds: projectSections.map((section) => section.id),
        });
    }, [orderedProjectTaskList, projectSections, projectTaskSortBy, selectedProject]);
    const availableSequenceLabel = resolveText('projects.availableNextAction', 'Available next action');
    const laterSequenceLabel = resolveText('projects.laterInSequence', 'Later in sequence');
    const visibleProjectTaskList = useMemo(() => {
        if (projectSections.length === 0) {
            return completedTasksCollapsed
                ? orderedProjectTasks
                : [...orderedProjectTasks, ...completedProjectTasks];
        }
        const combined: Task[] = [];
        sectionTaskGroups.sections.forEach((group) => {
            if (!group.section.isCollapsed) {
                combined.push(...group.tasks);
            }
        });
        combined.push(...sectionTaskGroups.unsectioned);
        if (!completedTasksCollapsed) {
            combined.push(...completedProjectTasks);
        }
        return combined;
    }, [completedProjectTasks, completedTasksCollapsed, orderedProjectTasks, projectSections.length, sectionTaskGroups.sections, sectionTaskGroups.unsectioned]);
    const visibleProjectTaskIds = useMemo(
        () => visibleProjectTaskList.map((task) => task.id),
        [visibleProjectTaskList],
    );
    const tasksById = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks]);
    const {
        activeAction,
        allVisibleTasksSelected,
        assignAreaToSelectedTasks,
        clearTaskSelection,
        deleteSelectedTasks,
        exitSelectionMode: exitTaskSelectionMode,
        multiSelectedIds,
        moveSelectedTasks,
        organizeSelectedTasks,
        selectedIdsArray,
        selectionMode,
        selectAllVisibleTasks,
        setSelectionMode,
        toggleMultiSelect,
        updateSelectedTaskTokens,
    } = useTaskSelection(visibleProjectTaskIds, {
        batchDeleteTasks,
        batchMoveTasks,
        batchUpdateTasks,
        restoreTask,
        showToast,
        t,
        tasksById,
        undoNotificationsEnabled,
    });
    const bulkAreaOptions = useMemo(
        () => sortedAreas
            .filter((area) => !area.deletedAt)
            .map((area) => ({ id: area.id, name: area.name })),
        [sortedAreas],
    );
    const addTagOptions = useMemo(
        () => allTokens.filter((token) => token.startsWith('#')),
        [allTokens],
    );
    const addContextOptions = useMemo(
        () => allTokens.filter((token) => token.startsWith('@')),
        [allTokens],
    );
    const removableTagOptions = useMemo(
        () => collectBulkTaskTokens(selectedIdsArray, tasksById, 'tags'),
        [selectedIdsArray, tasksById],
    );
    const removableContextOptions = useMemo(
        () => collectBulkTaskTokens(selectedIdsArray, tasksById, 'contexts'),
        [selectedIdsArray, tasksById],
    );

    const exitSelectionMode = useCallback(() => {
        exitTaskSelectionMode();
        setBulkTokenPicker(null);
        setBulkOrganizeOpen(false);
    }, [exitTaskSelectionMode]);

    useEffect(() => {
        exitSelectionMode();
    }, [exitSelectionMode, selectedProjectId]);

    const handleBatchMove = moveSelectedTasks;

    const handleBatchAssignArea = assignAreaToSelectedTasks;

    const handleApplyTaskBulkOrganize = useCallback(async (input: BulkOrganizeTaskUpdateInput) => {
        await organizeSelectedTasks(input, {
            afterSuccess: () => setBulkOrganizeOpen(false),
        });
    }, [organizeSelectedTasks]);

    const handleBatchDelete = useCallback(async () => {
        await deleteSelectedTasks({
            confirm: () => requestConfirmation({
                title: t('common.delete') || 'Delete',
                description: t('list.confirmBatchDelete') || 'Delete selected tasks?',
                confirmLabel: t('common.delete') || 'Delete',
                cancelLabel: t('common.cancel') || 'Cancel',
            }),
        });
    }, [deleteSelectedTasks, requestConfirmation, t]);

    const handleBatchTokenPick = useCallback((field: 'tags' | 'contexts', action: 'add' | 'remove') => {
        if (selectedIdsArray.length === 0) return;
        setBulkTokenPicker({ field, action });
    }, [selectedIdsArray.length]);

    const handleBulkTokenConfirm = useCallback(async (values: string[]) => {
        if (!bulkTokenPicker || selectedIdsArray.length === 0) return;
        await updateSelectedTaskTokens(
            bulkTokenPicker.field,
            values,
            bulkTokenPicker.action,
            {
                afterNoop: () => setBulkTokenPicker(null),
                afterSuccess: () => setBulkTokenPicker(null),
            },
        );
    }, [bulkTokenPicker, selectedIdsArray.length, updateSelectedTaskTokens]);

    const projectReferenceTasks = useMemo(() => {
        if (!selectedProject) return [] as Task[];

        const projectTagSet = new Set((selectedProject.tagIds || []).map((tag) => String(tag).toLowerCase()));
        const isProjectTagMatch = (task: Task) => {
            if (projectTagSet.size === 0) return false;
            return (task.tags || []).some((tag) => projectTagSet.has(String(tag).toLowerCase()));
        };

        const references = allTasks.filter((task) => {
            if (task.deletedAt) return false;
            if (task.status !== 'reference') return false;
            if (normalizedSearchQuery && !task.title.toLowerCase().includes(normalizedSearchQuery)) return false;
            if (task.projectId === selectedProject.id) return true;
            return isProjectTagMatch(task);
        });

        return sortProjectTasks(references);
    }, [allTasks, normalizedSearchQuery, selectedProject, sortProjectTasks]);

    // Reference tasks render as their own section below the task list, so the
    // keyboard walks them last rather than skipping them.
    const keyboardVisibleTasks = useMemo(
        () => [...visibleProjectTaskList, ...projectReferenceTasks],
        [projectReferenceTasks, visibleProjectTaskList],
    );
    const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);
    useTaskListScope({
        getTasks: () => keyboardVisibleTasks,
        getSelectedIndex: () => selectedTaskIndex,
        setSelectedIndex: setSelectedTaskIndex,
        t,
        toggleSelect: (task) => toggleMultiSelect(task.id),
    });

    useEffect(() => {
        if (!highlightTaskId) return;
        const exists = [...orderedProjectTaskList, ...projectReferenceTasks].some((task) => task.id === highlightTaskId);
        if (!exists) return;
        let retryTimer: number | null = null;
        let cancelled = false;
        let attempts = 0;
        const scrollHighlightedTask = () => {
            if (cancelled) return;
            const el = document.querySelector(`[data-task-id="${highlightTaskId}"]`) as HTMLElement | null;
            if (el) {
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                return;
            }
            if (attempts >= 8) return;
            attempts += 1;
            retryTimer = window.setTimeout(scrollHighlightedTask, 50);
        };
        scrollHighlightedTask();
        const timer = window.setTimeout(() => setHighlightTask(null), 4000);
        return () => {
            cancelled = true;
            if (retryTimer !== null) window.clearTimeout(retryTimer);
            window.clearTimeout(timer);
        };
    }, [highlightTaskId, orderedProjectTaskList, projectReferenceTasks, setHighlightTask]);

    const { taskIdsByContainer, taskIdToContainer } = useMemo(() => {
        const idsByContainer = new Map<string, string[]>();
        const idToContainer = new Map<string, string>();

        sectionTaskGroups.sections.forEach((group) => {
            const containerId = getSectionContainerId(group.section.id);
            const ids = group.tasks.map((task) => task.id);
            idsByContainer.set(containerId, ids);
            ids.forEach((id) => idToContainer.set(id, containerId));
        });

        const unsectionedIds = sectionTaskGroups.unsectioned.map((task) => task.id);
        idsByContainer.set(NO_SECTION_CONTAINER, unsectionedIds);
        unsectionedIds.forEach((id) => idToContainer.set(id, NO_SECTION_CONTAINER));

        return { taskIdsByContainer: idsByContainer, taskIdToContainer: idToContainer };
    }, [sectionTaskGroups]);

    const canReorderProjectTasks = projectTaskSortBy === 'default';

    const handleTaskDragEnd = useCallback((event: DragEndEvent) => {
        if (!selectedProject) return;
        // In non-default sort modes the list is not a drop target; tasks can only
        // be dragged out to the sidebar (handled by the Projects view).
        if (!canReorderProjectTasks) return;

        const failTaskMove = (error: unknown) => {
            reportError('Failed to reorder project tasks', error);
            showToast('Failed to move task', 'error');
        };

        const { active, over } = event;
        if (!over) return;

        const activeId = String(active.id);
        const overId = String(over.id);
        const sourceContainer = taskIdToContainer.get(activeId);
        const destinationContainer =
            taskIdToContainer.get(overId) ||
            (taskIdsByContainer.has(overId) ? overId : undefined);
        if (!sourceContainer || !destinationContainer) return;

        const sourceItems = taskIdsByContainer.get(sourceContainer) ?? [];
        const destinationItems = taskIdsByContainer.get(destinationContainer) ?? [];

        if (sourceContainer === destinationContainer) {
            const oldIndex = sourceItems.indexOf(activeId);
            if (oldIndex === -1) return;
            const newIndex = taskIdToContainer.has(overId)
                ? sourceItems.indexOf(overId)
                : sourceItems.length - 1;
            if (newIndex === -1 || oldIndex === newIndex) return;
            const reordered = arrayMove(sourceItems, oldIndex, newIndex);
            void Promise.resolve(
                reorderProjectTasks(selectedProject.id, reordered, getSectionIdFromContainer(sourceContainer)),
            ).catch(failTaskMove);
            return;
        }

        const sourceIndex = sourceItems.indexOf(activeId);
        if (sourceIndex === -1) return;
        const nextSourceItems = [...sourceItems];
        nextSourceItems.splice(sourceIndex, 1);

        const nextDestinationItems = [...destinationItems];
        const overIndex = taskIdToContainer.has(overId) ? nextDestinationItems.indexOf(overId) : -1;
        const insertIndex = overIndex === -1 ? nextDestinationItems.length : overIndex;
        nextDestinationItems.splice(insertIndex, 0, activeId);

        const nextSectionId = getSectionIdFromContainer(destinationContainer) ?? undefined;
        void (async () => {
            const updateResult = await Promise.resolve(updateTask(activeId, { sectionId: nextSectionId }));
            if (updateResult && updateResult.success === false) {
                throw new Error(updateResult.error || 'Failed to move task');
            }
            if (nextSourceItems.length > 0) {
                await Promise.resolve(
                    reorderProjectTasks(selectedProject.id, nextSourceItems, getSectionIdFromContainer(sourceContainer)),
                );
            }
            await Promise.resolve(
                reorderProjectTasks(selectedProject.id, nextDestinationItems, getSectionIdFromContainer(destinationContainer)),
            );
        })().catch(failTaskMove);
    }, [canReorderProjectTasks, reorderProjectTasks, selectedProject, showToast, taskIdToContainer, taskIdsByContainer, updateTask]);

    useEffect(() => {
        taskDragEndRef.current = handleTaskDragEnd;
        return () => {
            taskDragEndRef.current = null;
        };
    }, [handleTaskDragEnd, taskDragEndRef]);

    const renderSortableTasks = (list: Task[]) => (
        <SortableContext items={list.map((task) => task.id)} strategy={verticalListSortingStrategy}>
            <ProjectTaskRows
                tasks={list}
                scrollRef={projectScrollRef}
                pinnedTaskId={editingTaskId ?? highlightTaskId}
                renderTask={(task) => (
                    <SortableProjectTaskRow
                        key={task.id}
                        task={task}
                        project={selectedProject!}
                        sequenceCue={projectTaskSequenceCues.get(task.id)}
                        availableSequenceLabel={availableSequenceLabel}
                        laterSequenceLabel={laterSequenceLabel}
                    />
                )}
            />
        </SortableContext>
    );

    const renderDraggableTasks = (list: Task[]) => (
        <ProjectTaskRows
            tasks={list}
            scrollRef={projectScrollRef}
            pinnedTaskId={editingTaskId ?? highlightTaskId}
            renderTask={(task) => (
                <DraggableProjectTaskRow
                    key={task.id}
                    task={task}
                    project={selectedProject!}
                    sequenceCue={projectTaskSequenceCues.get(task.id)}
                    availableSequenceLabel={availableSequenceLabel}
                    laterSequenceLabel={laterSequenceLabel}
                />
            )}
        />
    );

    const renderSelectableTasks = (list: Task[]) => (
        <ProjectTaskRows
            tasks={list}
            scrollRef={projectScrollRef}
            pinnedTaskId={editingTaskId ?? highlightTaskId}
            renderTask={(task) => (
                <TaskItem
                    key={task.id}
                    task={task}
                    project={selectedProject}
                    enableDoubleClickEdit
                    showProjectBadgeInActions={false}
                    showProjectBadgeInMetadata={false}
                    selectionMode={selectionMode}
                    isMultiSelected={multiSelectedIds.has(task.id)}
                    onToggleSelect={(options) => toggleMultiSelect(task.id, options)}
                />
            )}
        />
    );

    const renderStaticTasks = (list: Task[]) => (
        <ProjectTaskRows
            tasks={list}
            scrollRef={projectScrollRef}
            pinnedTaskId={editingTaskId ?? highlightTaskId}
            renderTask={(task) => (
                <TaskItem
                    key={task.id}
                    task={task}
                    project={selectedProject}
                    enableDoubleClickEdit
                    showProjectBadgeInActions={false}
                    showProjectBadgeInMetadata={false}
                />
            )}
        />
    );

    const renderCompletedTaskGroup = () => {
        if (completedProjectTasks.length === 0) return null;
        const completedLabel = resolveText('list.done', resolveText('status.done', 'Completed'));
        const renderCompletedTasks = selectionMode ? renderSelectableTasks : renderStaticTasks;

        return (
            <div className="rounded-lg border border-border/60 bg-muted/10">
                <button
                    type="button"
                    onClick={() => {
                        captureProjectScrollBeforeLayoutChange();
                        setCompletedTasksCollapsed((value) => !value);
                    }}
                    aria-expanded={!completedTasksCollapsed}
                    data-project-completed-toggle
                    className="flex w-full items-center justify-between border-b border-border/50 px-3 py-2 text-left text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                    <span className="flex items-center gap-2">
                        {completedTasksCollapsed ? (
                            <ChevronRight className="h-4 w-4" />
                        ) : (
                            <ChevronDown className="h-4 w-4" />
                        )}
                        <CheckCircle2 className="h-4 w-4" />
                        <span>{completedLabel}</span>
                    </span>
                    <span className="text-xs">{completedProjectTasks.length}</span>
                </button>
                {!completedTasksCollapsed && (
                    <div className="p-3">
                        {renderCompletedTasks(completedProjectTasks)}
                    </div>
                )}
            </div>
        );
    };

    const renderProjectSections = (renderTasks: (list: Task[]) => ReactNode) => {
        if (projectSections.length === 0) {
            return (
                <div className="space-y-3">
                    <SectionDropZone
                        id={NO_SECTION_CONTAINER}
                        className="min-h-[120px] rounded-lg border border-dashed border-border/70 p-4"
                    >
                        {orderedProjectTasks.length > 0 ? (
                            renderTasks(orderedProjectTasks)
                        ) : (
                            <div className="py-12 text-center text-muted-foreground">
                                {t('projects.noActiveTasks')}
                            </div>
                        )}
                    </SectionDropZone>
                    {renderCompletedTaskGroup()}
                </div>
            );
        }

        return (
            <div className="space-y-3">
                {sectionTaskGroups.sections.map((group, index) => {
                    const isCollapsed = group.section.isCollapsed;
                    const taskCount = group.tasks.length;
                    const hasNotes = Boolean(group.section.description?.trim());
                    const notesOpen = sectionNotesOpen[group.section.id] ?? false;
                    const canMoveUp = index > 0;
                    const canMoveDown = index < sectionTaskGroups.sections.length - 1;
                    const moveSectionUpLabel = resolveText('projects.moveSectionUp', 'Move section up');
                    const moveSectionDownLabel = resolveText('projects.moveSectionDown', 'Move section down');

                    return (
                        <SectionDropZone
                            key={group.section.id}
                            id={getSectionContainerId(group.section.id)}
                            className="rounded-lg border border-border/60"
                        >
                            <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
                                <button
                                    type="button"
                                    onClick={() => handleToggleSection(group.section)}
                                    className="flex items-center gap-2 text-sm font-semibold"
                                >
                                    {isCollapsed ? (
                                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    )}
                                    <span>{group.section.title}</span>
                                    <span className="text-xs text-muted-foreground">{taskCount}</span>
                                </button>
                                <div className="flex items-center gap-2">
                                    {sectionTaskGroups.sections.length > 1 && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => handleMoveSection(group.section.id, -1)}
                                                disabled={!canMoveUp}
                                                className={cn(
                                                    "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                                                    !canMoveUp && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground"
                                                )}
                                                aria-label={`${moveSectionUpLabel}: ${group.section.title}`}
                                                title={moveSectionUpLabel}
                                            >
                                                <ArrowUp className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleMoveSection(group.section.id, 1)}
                                                disabled={!canMoveDown}
                                                className={cn(
                                                    "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                                                    !canMoveDown && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground"
                                                )}
                                                aria-label={`${moveSectionDownLabel}: ${group.section.title}`}
                                                title={moveSectionDownLabel}
                                            >
                                                <ArrowDown className="h-3.5 w-3.5" />
                                            </button>
                                        </>
                                    )}
                                    <button
                                        type="button"
                                        data-add-task-trigger
                                        onClick={() => openProjectQuickAdd(group.section.id)}
                                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                                        aria-label={t('projects.addTask')}
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleToggleSectionNotes(group.section.id)}
                                        className={cn(
                                            'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                                            (hasNotes || notesOpen) && 'text-primary',
                                        )}
                                        aria-label={t('projects.sectionNotes')}
                                    >
                                        <FileText className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleRenameSection(group.section)}
                                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                                        aria-label={t('common.edit')}
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteSection(group.section)}
                                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                        aria-label={t('common.delete')}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                            {notesOpen && (
                                <div className="border-b border-border/50 px-3 py-2">
                                    <textarea
                                        className="min-h-[90px] w-full resize-y rounded border border-border bg-background p-2 text-xs focus:bg-accent/5 focus:outline-none"
                                        placeholder={t('projects.sectionNotesPlaceholder')}
                                        defaultValue={group.section.description || ''}
                                        onBlur={(event) => {
                                            const nextValue = event.target.value.trimEnd();
                                            updateSection(group.section.id, { description: nextValue || undefined });
                                        }}
                                    />
                                </div>
                            )}
                            {!isCollapsed && (
                                <div className="p-3">
                                    {taskCount > 0 ? (
                                        renderTasks(group.tasks)
                                    ) : (
                                        <div className="py-2 text-xs text-muted-foreground">
                                            {t('projects.noActiveTasks')}
                                        </div>
                                    )}
                                </div>
                            )}
                        </SectionDropZone>
                    );
                })}
                <SectionDropZone
                    id={NO_SECTION_CONTAINER}
                    className="rounded-lg border border-dashed border-border/70"
                >
                    <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <span>{t('projects.noSection')}</span>
                            <span className="text-xs text-muted-foreground">
                                {sectionTaskGroups.unsectioned.length}
                            </span>
                        </div>
                    </div>
                    <div className="p-3">
                        {sectionTaskGroups.unsectioned.length > 0 ? (
                            renderTasks(sectionTaskGroups.unsectioned)
                        ) : (
                            <div className="py-2 text-xs text-muted-foreground">
                                {t('projects.noActiveTasks')}
                            </div>
                        )}
                    </div>
                </SectionDropZone>
                {sectionTaskGroups.sections.length === 0 && sectionTaskGroups.unsectioned.length === 0 && (
                    <div className="py-12 text-center text-muted-foreground">
                        {t('projects.noActiveTasks')}
                    </div>
                )}
                {renderCompletedTaskGroup()}
            </div>
        );
    };

    const tasksContent = selectionMode ? (
        renderProjectSections(renderSelectableTasks)
    ) : !canReorderProjectTasks ? (
        renderProjectSections(renderDraggableTasks)
    ) : (
        renderProjectSections(renderSortableTasks)
    );

    const visibleAttachments = (selectedProject?.attachments || []).filter((attachment) => !attachment.deletedAt);
    const completedProjectTaskCount = projectAllTasks.filter((task) => task.status === 'done').length;
    const projectProgress = (() => {
        if (!selectedProjectId) return null;
        if (isArchivedProject) {
            const completedCount = projectAllTasks.filter((task) => task.status === 'done' || task.status === 'archived').length;
            return {
                doneCount: completedCount,
                remainingCount: 0,
                total: completedCount,
                isArchived: true,
            };
        }
        const doneCount = projectAllTasks.filter((task) => task.status === 'done').length;
        const remainingCount = projectAllTasks.filter((task) => shouldShowProjectWorkspaceTask(task, selectedProject, false)).length;
        return {
            doneCount,
            remainingCount,
            total: doneCount + remainingCount,
        };
    })();

    const handleCommitProjectTitle = () => {
        if (!selectedProject) return;
        const nextTitle = editProjectTitle.trim();
        if (!nextTitle) {
            setEditProjectTitle(selectedProject.title);
            return;
        }
        if (nextTitle !== selectedProject.title) {
            updateProject(selectedProject.id, { title: nextTitle });
        }
    };

    const handleResetProjectTitle = () => {
        if (!selectedProject) return;
        setEditProjectTitle(selectedProject.title);
    };

    // Archive without a confirmation: the action is fully reversible from the
    // same header slot (the button becomes Reactivate and task statuses are
    // restored), matching the mobile editor. Delete keeps its confirmation.
    const handleArchiveProject = async () => {
        if (!selectedProject) return;
        try {
            await Promise.resolve(updateProject(selectedProject.id, { status: 'archived' }));
        } catch (error) {
            reportError('Failed to archive project', error);
            showToast(t('projects.archiveFailed') || 'Failed to archive project', 'error');
        }
    };

    const handleDeleteProject = async () => {
        if (!selectedProject) return;
        const projectId = selectedProject.id;
        const projectTitle = selectedProject.title;
        try {
            const confirmed = await requestConfirmation({
                title: t('common.delete') || 'Delete',
                description: t('projects.deleteConfirm'),
                confirmLabel: t('common.delete') || 'Delete',
                cancelLabel: t('common.cancel') || 'Cancel',
            });
            if (confirmed) {
                setIsProjectDeleting(true);
                try {
                    await Promise.resolve(deleteProject(projectId));
                    setSelectedProjectId(null);
                    if (undoNotificationsEnabled) {
                        showToast(
                            resolveText('projects.deleted', 'Project moved to Trash'),
                            'info',
                            6000,
                            {
                                label: resolveText('common.undo', 'Undo'),
                                onClick: () => {
                                    void Promise.resolve(restoreProject(projectId))
                                        .then(() => setSelectedProjectId(projectId))
                                        .catch((error) => {
                                            reportError('Failed to restore project', error);
                                            showToast(resolveText('projects.restoreFailed', 'Failed to restore project'), 'error');
                                        });
                                },
                            },
                        );
                    }
                } finally {
                    setIsProjectDeleting(false);
                }
            }
        } catch (error) {
            reportError('Failed to delete project', error);
            showToast(resolveText('projects.deleteFailed', `Failed to delete ${projectTitle || 'project'}`), 'error');
            setIsProjectDeleting(false);
        }
    };

    const {
        attachmentError,
        showLinkPrompt,
        setShowLinkPrompt,
        isProjectAttachmentBusy,
        openAttachment,
        addProjectFileAttachment,
        addProjectLinkAttachment,
        removeProjectAttachment,
    } = useProjectAttachmentActions({
        t,
        selectedProject,
        updateProject,
    });

    const selectedProjectAreaLabel = (() => {
        if (!selectedProject?.areaId) return undefined;
        return areaById.get(selectedProject.areaId)?.name;
    })();
    const expandProjectsSidebarLabel = resolveText('projects.expandSidebar', 'Expand projects panel');
    const showProjectsSidebarToggle = projectsSidebarCollapsed && Boolean(onToggleProjectsSidebar);
    const removeTagLabel = resolveText('bulk.removeTag', 'Remove tag');
    const tokenPickerTitle = (() => {
        if (!bulkTokenPicker) return '';
        if (bulkTokenPicker.field === 'tags') {
            return bulkTokenPicker.action === 'add' ? t('bulk.addTag') : removeTagLabel;
        }
        return bulkTokenPicker.action === 'add' ? t('bulk.addContext') : t('bulk.removeContext');
    })();
    const tokenPickerOptions = (() => {
        if (!bulkTokenPicker) return [] as string[];
        if (bulkTokenPicker.field === 'tags') {
            return bulkTokenPicker.action === 'add' ? addTagOptions : removableTagOptions;
        }
        return bulkTokenPicker.action === 'add' ? addContextOptions : removableContextOptions;
    })();
    const tokenPickerPlaceholder = bulkTokenPicker?.field === 'tags'
        ? t('taskEdit.tagsPlaceholder')
        : t('taskEdit.contextsPlaceholder');

    const clearSearchLabel = resolveText('common.clearSearch', 'Clear search');
    const projectAddTaskButton = !isArchivedProject ? (
        <button
            type="button"
            data-add-task-trigger
            onClick={() => openProjectQuickAdd()}
            className={cn(
                'inline-flex h-8 items-center gap-2 rounded-md bg-primary font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                projectTaskToolbarCompact ? 'px-3 text-xs' : 'mb-3 px-4 text-sm',
            )}
        >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('projects.addTask')}
        </button>
    ) : null;
    const selectProjectTasksButton = selectedProject ? (
        <button
            type="button"
            data-task-selection-toggle
            onClick={() => {
                captureProjectScrollBeforeLayoutChange();
                if (selectionMode) exitSelectionMode();
                else setSelectionMode(true);
            }}
            className={cn(
                'h-8 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40',
                selectionMode
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            )}
        >
            {selectionMode ? t('bulk.exitSelect') : t('bulk.select')}
        </button>
    ) : null;

    return (
        <>
            <div className="flex-1 min-w-0 h-full flex">
                <div className="flex h-full min-h-0 w-full max-w-none flex-col">
                    <div className="mb-4">
                        <div data-project-search-row className="flex flex-col gap-2 sm:flex-row">
                            {showProjectsSidebarToggle && (
                                <button
                                    type="button"
                                    onClick={onToggleProjectsSidebar}
                                    className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                    title={expandProjectsSidebarLabel}
                                    aria-label={expandProjectsSidebarLabel}
                                    aria-expanded={false}
                                >
                                    <PanelLeftOpen className="h-4 w-4" />
                                </button>
                            )}
                            <div className="relative min-w-0 flex-1">
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    data-view-filter-input
                                    placeholder={t('common.search')}
                                    aria-label={t('common.search')}
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    className={cn(
                                        'w-full min-w-0 rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30',
                                        searchQuery && 'pr-9',
                                    )}
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={handleClearProjectSearch}
                                        aria-label={clearSearchLabel}
                                        className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                    >
                                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    {selectedProject ? (
                        <div
                            ref={projectScrollRef}
                            data-project-scroll-container
                            onScroll={handleProjectScroll}
                            className="flex-1 min-h-0 overflow-y-auto pr-2"
                        >
                            {(isCreatingProject || isProjectDeleting || isAreaCreating) && (
                                <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                                    {t('common.loading') || 'Loading...'}
                                </div>
                            )}
                            <ProjectDetailsHeader
                                project={selectedProject}
                                projectColor={getProjectColor(selectedProject, areaById, DEFAULT_AREA_COLOR)}
                                areaLabel={selectedProjectAreaLabel}
                                isSequential={selectedProject.isSequential === true}
                                dueDate={selectedProject.dueDate}
                                reviewAt={selectedProject.reviewAt}
                                editTitle={editProjectTitle}
                                onEditTitleChange={setEditProjectTitle}
                                onCommitTitle={handleCommitProjectTitle}
                                onResetTitle={handleResetProjectTitle}
                                detailsExpanded={projectDetailsExpanded}
                                onToggleDetails={() => setProjectDetailsExpanded((prev) => !prev)}
                                onDuplicate={() => onDuplicateProject(selectedProject.id)}
                                onArchive={handleArchiveProject}
                                onReactivate={() => {
                                    Promise.resolve(updateProject(selectedProject.id, { status: 'active' })).catch((error) => {
                                        reportError('Failed to reactivate project', error);
                                        showToast(t('projects.reactivateFailed') || 'Failed to reactivate project', 'error');
                                    });
                                }}
                                onDelete={handleDeleteProject}
                                isDeleting={isProjectDeleting}
                                projectProgress={projectProgress}
                                t={t}
                            />

                            {projectDetailsExpanded && (
                                <>
                                    <ProjectDetailsFields
                                        project={selectedProject}
                                        selectedAreaId={
                                            selectedProject.areaId && areaById.has(selectedProject.areaId)
                                                ? selectedProject.areaId
                                                : noAreaId
                                        }
                                        sortedAreas={sortedAreas}
                                        noAreaId={noAreaId}
                                        t={t}
                                        tagDraft={tagDraft}
                                        tagSuggestions={addTagOptions}
                                        onTagDraftChange={setTagDraft}
                                        onCommitTags={() => {
                                            updateProject(selectedProject.id, { tagIds: parseTagInput(tagDraft) });
                                        }}
                                        onNewArea={() => onRequestQuickArea(selectedProject.id)}
                                        onManageAreas={onManageAreas}
                                        onAreaChange={(value) => {
                                            updateProject(selectedProject.id, { areaId: value === noAreaId ? undefined : value });
                                        }}
                                        isSequential={selectedProject.isSequential === true}
                                        onToggleSequential={() => updateProject(selectedProject.id, { isSequential: !selectedProject.isSequential })}
                                        sequentialScope={selectedProject.sequentialScope ?? 'project'}
                                        onSequentialScopeChange={(sequentialScope) => updateProject(selectedProject.id, { sequentialScope })}
                                        status={selectedProject.status}
                                        onChangeStatus={(status) => updateProject(selectedProject.id, { status })}
                                        dueDateValue={toDateInputValue(selectedProject.dueDate)}
                                        onDueDateChange={(value) => updateProject(selectedProject.id, { dueDate: value || undefined })}
                                        reviewAtValue={toDateTimeLocalValue(selectedProject.reviewAt)}
                                        onReviewAtChange={(value) => updateProject(selectedProject.id, { reviewAt: value || undefined })}
                                    />

                                    <ProjectNotesSection
                                        project={selectedProject}
                                        showNotesPreview={showNotesPreview}
                                        onTogglePreview={() => setShowNotesPreview((value) => !value)}
                                        onAddFile={addProjectFileAttachment}
                                        onAddLink={addProjectLinkAttachment}
                                        attachmentsBusy={isProjectAttachmentBusy}
                                        visibleAttachments={visibleAttachments}
                                        attachmentError={attachmentError}
                                        onOpenAttachment={openAttachment}
                                        onRemoveAttachment={removeProjectAttachment}
                                        onUpdateNotes={(value) => updateProject(selectedProject.id, { supportNotes: value })}
                                        t={t}
                                        language={language}
                                    />
                                </>
                            )}

                            <section className="border-t border-border/50 py-5">
                                <div
                                    data-project-task-toolbar
                                    data-compact={projectTaskToolbarCompact ? 'true' : 'false'}
                                    className={cn(
                                        'sticky top-0 z-20 -mx-2 mb-4 border-y border-border/60 bg-background/95 px-2 shadow-sm backdrop-blur transition-[padding] duration-150 supports-[backdrop-filter]:bg-background/85',
                                        projectTaskToolbarCompact ? 'py-2' : 'py-3',
                                    )}
                                >
                                    {!projectTaskToolbarCompact && projectAddTaskButton}
                                    <div className={cn(
                                        'flex gap-3',
                                        projectTaskToolbarCompact
                                            ? 'flex-wrap items-center justify-between'
                                            : 'items-center justify-between',
                                    )}>
                                        <div className="text-xs uppercase tracking-wider text-muted-foreground">
                                            {t('projects.sectionsLabel')}
                                        </div>
                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                            {projectTaskToolbarCompact && projectAddTaskButton}
                                            <SortBySelect
                                                value={projectTaskSortBy}
                                                onChange={handleProjectTaskSortByChange}
                                                t={t}
                                            />
                                            {selectProjectTasksButton}
                                            {!isArchivedProject && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={onToggleShowCompletedTasks}
                                                        aria-label={showCompletedTasks
                                                            ? resolveText('common.hideCompleted', 'Hide completed')
                                                            : resolveText('common.showCompleted', 'Show completed')}
                                                        aria-pressed={showCompletedTasks}
                                                        className={cn(
                                                            'inline-flex items-center gap-2 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                                                            showCompletedTasks
                                                                ? 'border-primary/40 bg-primary/10 text-primary'
                                                                : 'border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                                                        )}
                                                    >
                                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                                        {showCompletedTasks
                                                            ? resolveText('common.hideCompleted', 'Hide completed')
                                                            : resolveText('common.showCompleted', 'Show completed')}
                                                        {!showCompletedTasks && completedProjectTaskCount > 0 && (
                                                            <span
                                                                aria-hidden="true"
                                                                className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                                            >
                                                                {completedProjectTaskCount}
                                                            </span>
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleAddSection}
                                                        aria-label={t('projects.addSection')}
                                                        className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/40"
                                                    >
                                                        <Plus className="h-3.5 w-3.5" />
                                                        {t('projects.addSection')}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {selectionMode && (
                                        <div className="mt-3 space-y-3">
                                            <BulkSelectionToolbar
                                                selectionCount={selectedIdsArray.length}
                                                totalCount={visibleProjectTaskList.length}
                                                allSelected={allVisibleTasksSelected}
                                                onSelectAll={selectAllVisibleTasks}
                                                onClearSelection={clearTaskSelection}
                                                t={t}
                                            />
                                            {selectedIdsArray.length > 0 && (
                                                <ListBulkActions
                                                    selectionCount={selectedIdsArray.length}
                                                    onMoveToStatus={handleBatchMove}
                                                    onAssignArea={handleBatchAssignArea}
                                                    areaOptions={bulkAreaOptions}
                                                    onBulkOrganize={() => setBulkOrganizeOpen(true)}
                                                    onAddTag={() => handleBatchTokenPick('tags', 'add')}
                                                    onRemoveTag={() => handleBatchTokenPick('tags', 'remove')}
                                                    disableRemoveTag={removableTagOptions.length === 0}
                                                    onAddContext={() => handleBatchTokenPick('contexts', 'add')}
                                                    onRemoveContext={() => handleBatchTokenPick('contexts', 'remove')}
                                                    disableRemoveContext={removableContextOptions.length === 0}
                                                    onDelete={handleBatchDelete}
                                        isDeleting={activeAction === 'delete'}
                                                    t={t}
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>
                                {tasksContent}
                            </section>

                            {projectReferenceTasks.length > 0 && (
                                <section className="border-t border-border/50 py-5">
                                    <div className="mb-3 flex items-center justify-between">
                                        <div className="text-xs uppercase tracking-wider text-muted-foreground">
                                            {t('status.reference')} ({projectReferenceTasks.length})
                                        </div>
                                    </div>
                                    <div className="border-t border-border/40">
                                        {renderStaticTasks(projectReferenceTasks)}
                                    </div>
                                </section>
                            )}
                        </div>
                    ) : selectedArea ? (
                        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
                            <header className="border-y border-border/60 py-5">
                                <div className="flex items-center gap-3">
                                    <span
                                        className="h-3 w-3 rounded-full border border-border/50"
                                        style={{ backgroundColor: selectedArea.color }}
                                        aria-hidden="true"
                                    />
                                    <div>
                                        <h2 className="text-xl font-semibold tracking-tight">{selectedArea.name}</h2>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {resolveText('projects.areaTasksHint', 'Tasks in this area that do not need a project.')}
                                        </p>
                                    </div>
                                </div>
                            </header>
                            {directAreaTasks.length > 0 ? (
                                <div className="divide-y divide-border/40 border-b border-border/60 py-2">
                                    {directAreaTasks.map((task) => (
                                        <TaskItem
                                            key={task.id}
                                            task={task}
                                            enableDoubleClickEdit
                                            showProjectBadgeInActions={false}
                                            showProjectBadgeInMetadata={false}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <p className="border-b border-dashed border-border/70 py-8 text-sm text-muted-foreground">
                                    {resolveText('projects.areaTasksEmpty', 'No direct tasks in this area.')}
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground">
                            <div className="border border-dashed border-border/70 px-10 py-12 text-center">
                                <Folder className="mx-auto mb-4 h-12 w-12 opacity-25" />
                                <p>{t('projects.selectProject')}</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <PromptModal
                isOpen={showSectionPrompt}
                title={editingSectionId ? t('projects.sectionsLabel') : t('projects.addSection')}
                description={t('projects.sectionPlaceholder')}
                placeholder={t('projects.sectionPlaceholder')}
                defaultValue={sectionDraft}
                confirmLabel={editingSectionId ? t('common.save') : t('projects.create')}
                cancelLabel={t('common.cancel')}
                onCancel={() => {
                    setShowSectionPrompt(false);
                    setEditingSectionId(null);
                    setSectionDraft('');
                }}
                onConfirm={(value) => {
                    if (!selectedProject) return;
                    const trimmed = value.trim();
                    if (!trimmed) return;
                    if (editingSectionId) {
                        updateSection(editingSectionId, { title: trimmed });
                    } else {
                        addSection(selectedProject.id, trimmed);
                    }
                    setShowSectionPrompt(false);
                    setEditingSectionId(null);
                    setSectionDraft('');
                }}
            />

            <PromptModal
                isOpen={showLinkPrompt}
                title={t('attachments.addLink')}
                description={t('attachments.linkInputHint')}
                placeholder={t('attachments.linkPlaceholder')}
                defaultValue=""
                browseLabel={isTauriRuntime() ? t('attachments.linkToFile') : undefined}
                onBrowse={isTauriRuntime() ? () => browseForLinkTarget(t('attachments.linkToFile')) : undefined}
                confirmLabel={t('common.save')}
                cancelLabel={t('common.cancel')}
                onCancel={() => setShowLinkPrompt(false)}
                onConfirm={(value) => {
                    if (!selectedProject) return;
                    const normalized = normalizeAttachmentInput(value);
                    if (!normalized.uri) return;
                    const now = new Date().toISOString();
                    const attachment: Attachment = {
                        id: generateUUID(),
                        kind: normalized.kind,
                        title: normalized.title,
                        uri: normalized.uri,
                        createdAt: now,
                        updatedAt: now,
                    };
                    updateProject(selectedProject.id, {
                        attachments: [...(selectedProject.attachments || []), attachment],
                    });
                    setShowLinkPrompt(false);
                }}
            />
            <TokenPickerModal
                isOpen={bulkTokenPicker !== null}
                title={tokenPickerTitle}
                description={tokenPickerTitle}
                tokens={tokenPickerOptions}
                placeholder={tokenPickerPlaceholder}
                allowCustomValue={bulkTokenPicker?.action === 'add'}
                multiSelect={bulkTokenPicker?.action === 'remove'}
                confirmLabel={t('common.save')}
                cancelLabel={t('common.cancel')}
                onCancel={() => setBulkTokenPicker(null)}
                onConfirm={handleBulkTokenConfirm}
            />
            <TaskBulkOrganizeModal
                isOpen={bulkOrganizeOpen}
                selectedCount={selectedIdsArray.length}
                projects={projects}
                areas={areas}
                isApplying={activeAction === 'organize'}
                t={t}
                onCancel={() => setBulkOrganizeOpen(false)}
                onApply={handleApplyTaskBulkOrganize}
            />
        </>
    );
}
