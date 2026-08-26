/**
 * Composition root for the desktop calendar.
 *
 * The four things the calendar actually does live in their own hooks — where
 * the date is ({@link useCalendarMonthNavigation}), what the subscribed
 * calendars say ({@link useCalendarExternalEvents}), composing a task
 * ({@link useCalendarComposer}) and the selected-day panel
 * ({@link useCalendarSelectedDay}). This file reads the store once, derives the
 * task buckets both the grid and the panels share, wires the four together and
 * hands the view a single object.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    buildCalendarEventTaskDraft,
    expandCalendarRecurringTasks,
    getCalendarPlanningCandidates,
    getTaskScheduledAt,
    getWeekStartsOnIndex,
    findFreeSlotForDay as findCalendarFreeSlotForDay,
    isSlotFreeForDay as isCalendarSlotFreeForDay,
    isTaskInActiveProject,
    isProjectedRecurringTask,
    hasTimeComponent,
    resolveAreaFilter,
    resolveCalendarSystemSetting,
    safeParseDate,
    safeParseDueDate,
    shallow,
    taskMatchesAreaFilter,
    timeEstimateToMinutes as resolveTimeEstimateToMinutes,
    translateWithFallback,
    type ExternalCalendarEvent,
    type Task,
    useTaskStore,
} from '@mindwtr/core';
import {
    buildCalendarDayItems,
    buildTimedCalendarLayouts,
} from '@mindwtr/core/calendar-day-items';

import { checkBudget } from '../../../config/performanceBudgets';
import { useLanguage } from '../../../contexts/language-context';
import { usePerformanceMonitor } from '../../../hooks/usePerformanceMonitor';
import { reportError } from '../../../lib/report-error';
import { resolveCalendarLocale } from '../calendar-locale';
import {
    DESKTOP_DAY_END_HOUR,
    DESKTOP_DAY_START_HOUR,
    DESKTOP_HOUR_HEIGHT,
    DESKTOP_MIN_TIMED_ITEM_HEIGHT,
    dayKey,
    formatDateInputValue,
    type CalendarCellItem,
    type CalendarTimedItem,
} from './calendar-primitives';
import { useCalendarComposer } from './use-calendar-composer';
import { useCalendarExternalEvents } from './use-calendar-external-events';
import { useCalendarMonthNavigation } from './use-calendar-month-navigation';
import { useCalendarScheduleFeedback, useCalendarSelectedDay } from './use-calendar-selected-day';

export function useDesktopCalendarController() {
    const perf = usePerformanceMonitor('CalendarView');
    const { tasks, projects, areas, addTask, addProject, updateTask, settings, getDerivedState } = useTaskStore(
        (state) => ({
            addProject: state.addProject,
            addTask: state.addTask,
            tasks: state.tasks,
            projects: state.projects,
            areas: state.areas,
            updateTask: state.updateTask,
            settings: state.settings,
            getDerivedState: state.getDerivedState,
        }),
        shallow
    );
    const {
        allContexts = [],
        allTags = [],
        projectMap,
        sequentialProjectIds = new Set<string>(),
        sequentialWithinSectionProjectIds = new Set<string>(),
    } = getDerivedState();
    const { t, language } = useLanguage();
    const resolveText = useCallback(
        (key: string, fallback: string) => {
            return translateWithFallback(t, key, fallback);
        },
        [t]
    );
    const timeEstimatesEnabled = settings?.features?.timeEstimates !== false;
    const prioritiesEnabled = settings?.features?.priorities !== false;
    const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);
    const resolvedAreaFilter = useMemo(
        () => resolveAreaFilter(settings?.filters?.areaId, areas),
        [settings?.filters?.areaId, areas],
    );
    const weekStartsOn = getWeekStartsOnIndex(settings?.weekStart);
    const systemLocale = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : undefined;
    const calendarSystem = resolveCalendarSystemSetting(settings?.calendarSystem, {
        language,
        systemLocale,
    });
    const calendarLocale = useMemo(
        () => resolveCalendarLocale({
            language,
            dateFormat: settings?.dateFormat,
            calendarSystem: settings?.calendarSystem,
            systemLocale,
        }),
        [language, settings?.calendarSystem, settings?.dateFormat, systemLocale]
    );
    const [viewFilterQuery, setViewFilterQuery] = useState('');
    const updateViewFilterQuery = useCallback((query: string) => setViewFilterQuery(query), []);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    const calendarBodyRef = useRef<HTMLDivElement | null>(null);
    const normalizedViewFilterQuery = viewFilterQuery.trim().toLowerCase();
    const quickAddSuggestionTokens = useMemo(
        () => Array.from(new Set([...allContexts, ...allTags])).sort(),
        [allContexts, allTags]
    );

    useEffect(() => {
        if (!perf.enabled) return;
        const timer = window.setTimeout(() => {
            checkBudget('CalendarView', perf.metrics, 'complex');
        }, 0);
        return () => window.clearTimeout(timer);
    }, [perf.enabled]);

    // The selected-day panel's transient state is created before navigation
    // because every navigation clears it, and navigation's selected date is in
    // turn what the selected-day hook reads.
    const feedback = useCalendarScheduleFeedback();
    const nav = useCalendarMonthNavigation({
        calendarLocale,
        calendarSystem,
        onNavigate: feedback.resetSelectedDayState,
        weekStartsOn,
    });
    const { currentMonth, selectedDate, viewMode, visibleRange } = nav;
    const external = useCalendarExternalEvents({
        filterQuery: normalizedViewFilterQuery,
        visibleRange,
    });
    const { getExternalEventsForDay } = external;

    const isSchedulableTask = useCallback((task: Task) => {
        if (task.deletedAt) return false;
        if (task.status === 'done' || task.status === 'archived' || task.status === 'reference') return false;
        if (!isTaskInActiveProject(task, projectMap)) return false;
        if (!taskMatchesAreaFilter(task, resolvedAreaFilter, projectMap, areaById)) return false;
        return true;
    }, [projectMap, resolvedAreaFilter, areaById]);

    const isCalendarTaskVisible = useCallback((task: Task) => {
        if (!isSchedulableTask(task)) return false;
        if (normalizedViewFilterQuery && !task.title.toLowerCase().includes(normalizedViewFilterQuery)) return false;
        return true;
    }, [isSchedulableTask, normalizedViewFilterQuery]);

    const calendarTaskData = useMemo(() => {
        const visibleTasks: Task[] = [];
        const deadlinesByDay = new Map<string, Task[]>();
        const scheduledByDay = new Map<string, Task[]>();
        for (const task of tasks) {
            for (const calendarTask of expandCalendarRecurringTasks(task)) {
                if (!isCalendarTaskVisible(calendarTask)) continue;
                visibleTasks.push(calendarTask);
                if (calendarTask.dueDate) {
                    const dueDate = safeParseDueDate(calendarTask.dueDate);
                    if (dueDate) {
                        const dueKey = dayKey(dueDate);
                        const existingDue = deadlinesByDay.get(dueKey);
                        if (existingDue) existingDue.push(calendarTask);
                        else deadlinesByDay.set(dueKey, [calendarTask]);
                    }
                }
                const scheduledAt = getTaskScheduledAt(calendarTask);
                if (scheduledAt) {
                    const startTime = safeParseDate(scheduledAt);
                    if (startTime) {
                        const startKey = dayKey(startTime);
                        const existingStart = scheduledByDay.get(startKey);
                        if (existingStart) existingStart.push(calendarTask);
                        else scheduledByDay.set(startKey, [calendarTask]);
                    }
                }
            }
        }
        return { visibleTasks, deadlinesByDay, scheduledByDay };
    }, [tasks, isCalendarTaskVisible]);

    const schedulableTasks = useMemo(
        () => tasks
            .filter(isSchedulableTask)
            .sort((a, b) => a.title.localeCompare(b.title)),
        [tasks, isSchedulableTask]
    );
    const planningTasks = useMemo(() => getCalendarPlanningCandidates(
        tasks.filter(isSchedulableTask),
        {
            limit: 8,
            now: new Date(),
            prioritizeByPriority: prioritiesEnabled,
            projects,
            sectionScopedProjectIds: sequentialWithinSectionProjectIds,
            sequentialProjectIds,
        },
    ), [
        isSchedulableTask,
        prioritiesEnabled,
        projects,
        sequentialProjectIds,
        sequentialWithinSectionProjectIds,
        tasks,
    ]);

    const getDeadlinesForDay = (date: Date) => calendarTaskData.deadlinesByDay.get(dayKey(date)) ?? [];
    const getScheduledForDay = (date: Date) => calendarTaskData.scheduledByDay.get(dayKey(date)) ?? [];
    const openTask = openTaskId ? tasks.find((task) => task.id === openTaskId) ?? null : null;
    const openProject = openTask?.projectId ? projectMap.get(openTask.projectId) : undefined;
    const openTaskFromCalendar = useCallback((task: Task) => {
        if (isProjectedRecurringTask(task)) return;
        setOpenTaskId(task.id);
    }, []);
    const closeOpenTask = useCallback(() => setOpenTaskId(null), []);
    const markTaskDone = useCallback((taskId: string) => {
        const task = calendarTaskData.visibleTasks.find((candidate) => candidate.id === taskId);
        if (isProjectedRecurringTask(task)) return;
        updateTask(taskId, { status: 'done', isFocusedToday: false })
            .catch((error) => reportError('Failed to mark task done', error));
    }, [calendarTaskData.visibleTasks, updateTask]);

    const createTaskFromExternalEvent = useCallback(async (event: ExternalCalendarEvent) => {
        try {
            const { initialProps, title } = buildCalendarEventTaskDraft(event, {
                calendarName: external.calendarNameById.get(event.sourceId),
                fallbackTitle: resolveText('calendar.eventFallbackTitle', 'Calendar event'),
            });
            const result = await addTask(title, initialProps);
            if (!result.success) {
                feedback.showScheduleError(result.error ?? resolveText('calendar.saveTaskFailed', 'Could not save the task.'));
                return;
            }

            const nextDate = safeParseDate(initialProps.scheduledAt ?? initialProps.dueDate ?? event.start);
            if (nextDate) {
                nav.revealDate(nextDate);
            }
            feedback.showScheduleError(null);
            if (result.id) {
                setOpenTaskId(result.id);
            }
        } catch (error) {
            reportError('Failed to create task from calendar event', error);
            feedback.showScheduleError(resolveText('calendar.saveTaskFailed', 'Could not save the task.'));
        }
    }, [addTask, external.calendarNameById, feedback.showScheduleError, nav.revealDate, resolveText]);

    const visibleSearchMatchCount = useMemo(() => {
        if (!normalizedViewFilterQuery) return null;
        const rangeStart = new Date(visibleRange.start);
        rangeStart.setHours(0, 0, 0, 0);
        const rangeEnd = new Date(visibleRange.end);
        rangeEnd.setHours(23, 59, 59, 999);
        const startMs = rangeStart.getTime();
        const endMs = rangeEnd.getTime();

        const taskIds = new Set<string>();
        for (const task of calendarTaskData.visibleTasks) {
            const dueDate = task.dueDate ? safeParseDueDate(task.dueDate) : null;
            const scheduledAt = getTaskScheduledAt(task);
            const startTime = scheduledAt ? safeParseDate(scheduledAt) : null;
            if (dueDate && dueDate.getTime() >= startMs && dueDate.getTime() <= endMs) taskIds.add(task.id);
            if (
                hasTimeComponent(scheduledAt)
                && startTime
                && startTime.getTime() >= startMs
                && startTime.getTime() <= endMs
            ) {
                taskIds.add(task.id);
            }
        }

        const eventCount = external.visibleExternalEvents.filter((event) => {
            const start = safeParseDate(event.start);
            const end = safeParseDate(event.end);
            if (!start || !end) return false;
            return start.getTime() <= endMs && end.getTime() >= startMs;
        }).length;

        return taskIds.size + eventCount;
    }, [calendarTaskData.visibleTasks, normalizedViewFilterQuery, external.visibleExternalEvents, visibleRange]);

    const timeEstimateToMinutes = (estimate: Task['timeEstimate']): number => (
        resolveTimeEstimateToMinutes(estimate, { enabled: timeEstimatesEnabled })
    );

    const findFreeSlotForDay = (day: Date, durationMinutes: number, excludeTaskId?: string): Date | null => (
        findCalendarFreeSlotForDay({
            day,
            durationMinutes,
            events: getExternalEventsForDay(day),
            excludeTaskId,
            tasks: schedulableTasks,
            timeEstimatesEnabled,
        })
    );

    const isSlotFreeForDay = (day: Date, startTime: Date, durationMinutes: number, excludeTaskId?: string): boolean => (
        isCalendarSlotFreeForDay({
            day,
            durationMinutes,
            events: getExternalEventsForDay(day),
            excludeTaskId,
            startTime,
            tasks: schedulableTasks,
            timeEstimatesEnabled,
        })
    );

    const composer = useCalendarComposer({
        addProject,
        addTask,
        areas,
        findFreeSlot: findFreeSlotForDay,
        isSlotFree: (start, durationMinutes, excludeTaskId) => (
            isSlotFreeForDay(start, start, durationMinutes, excludeTaskId)
        ),
        onSaved: (start) => {
            feedback.clearScheduleFeedback();
            if (start) nav.revealDate(start);
        },
        projects,
        resolveText,
        schedulableTasks,
        t,
        tasks,
        timeEstimateToMinutes,
        updateTask,
    });

    const selectedDay = useCalendarSelectedDay({
        feedback,
        findFreeSlotForDay,
        getDeadlinesForDay,
        getExternalEventsForDay,
        getScheduledForDay,
        isSlotFreeForDay,
        openTaskComposerAt: composer.openTaskComposerAt,
        resolveText,
        schedulableTasks,
        selectedDate,
        t,
        tasks,
        timeEstimateToMinutes,
        updateTask,
    });

    // Clicking anywhere outside the calendar closes the selected day — unless
    // the composer is open, which lives in a portal outside this subtree.
    useEffect(() => {
        if (!selectedDate) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (composer.taskComposer) return;
            const target = event.target as Node;
            if (!calendarBodyRef.current || calendarBodyRef.current.contains(target)) return;
            nav.closeSelectedDay();
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [selectedDate, composer.taskComposer]);

    const updateTaskDateFromDrop = useCallback(async (taskId: string, date: Date, itemKind?: 'scheduled' | 'deadline' | null) => {
        const task = tasks.find((candidate) => candidate.id === taskId);
        if (!task) return;

        try {
            if (itemKind === 'deadline') {
                await updateTask(task.id, { dueDate: formatDateInputValue(date) });
            } else {
                const scheduledAt = getTaskScheduledAt(task);
                const existingStart = scheduledAt ? safeParseDate(scheduledAt) : null;
                if (existingStart) {
                    const nextStart = new Date(date);
                    nextStart.setHours(
                        existingStart.getHours(),
                        existingStart.getMinutes(),
                        existingStart.getSeconds(),
                        existingStart.getMilliseconds(),
                    );
                    await updateTask(task.id, { scheduledAt: nextStart.toISOString() });
                } else {
                    await updateTask(task.id, { dueDate: formatDateInputValue(date) });
                }
            }
            nav.revealDate(date);
            feedback.showScheduleError(null);
        } catch (error) {
            reportError('Failed to reschedule task from calendar drop', error);
        }
    }, [feedback.showScheduleError, nav.revealDate, tasks, updateTask]);

    const updateTaskStartTimeFromDrop = useCallback(async (taskId: string, start: Date) => {
        const task = tasks.find((candidate) => candidate.id === taskId);
        if (!task) return;

        try {
            await updateTask(task.id, { scheduledAt: start.toISOString() });
            nav.revealDate(start);
            feedback.showScheduleError(null);
        } catch (error) {
            reportError('Failed to schedule task from calendar drop', error);
        }
    }, [feedback.showScheduleError, nav.revealDate, tasks, updateTask]);

    const getCalendarItemsForDate = (date: Date): CalendarCellItem[] => buildCalendarDayItems({
        deadlines: getDeadlinesForDay(date),
        events: getExternalEventsForDay(date),
        scheduled: getScheduledForDay(date),
    });
    const getAllDayItemsForDay = (date: Date) => {
        const scheduled = getScheduledForDay(date);
        const scheduledIds = new Set(scheduled.map((task) => task.id));
        return [
            ...scheduled
                .filter((task) => !hasTimeComponent(getTaskScheduledAt(task)))
                .map((task) => ({ id: `scheduled-${task.id}`, kind: 'scheduled' as const, task, title: task.title })),
            ...getDeadlinesForDay(date)
                .filter((task) => !scheduledIds.has(task.id))
                .map((task) => ({ id: `deadline-${task.id}`, kind: 'deadline' as const, task, title: task.title })),
            ...getExternalEventsForDay(date)
                .filter((event) => event.allDay)
                .map((event) => ({ id: `event-${event.id}`, kind: 'event' as const, event, title: event.title })),
        ];
    };
    const getTimedItemsForDay = (date: Date): CalendarTimedItem[] => {
        const dayStart = new Date(date);
        dayStart.setHours(DESKTOP_DAY_START_HOUR, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(DESKTOP_DAY_END_HOUR, 0, 0, 0);
        const items: CalendarTimedItem[] = [];

        for (const task of getScheduledForDay(date)) {
            const scheduledAt = getTaskScheduledAt(task);
            if (!hasTimeComponent(scheduledAt)) continue;
            const start = scheduledAt ? safeParseDate(scheduledAt) : null;
            if (!start) continue;
            const durationMinutes = timeEstimateToMinutes(task.timeEstimate);
            items.push({
                durationMinutes,
                end: new Date(start.getTime() + durationMinutes * 60_000),
                id: `task-${task.id}`,
                kind: 'task',
                start,
                task,
                title: task.title,
            });
        }

        for (const event of getExternalEventsForDay(date)) {
            if (event.allDay) continue;
            const rawStart = safeParseDate(event.start);
            const rawEnd = safeParseDate(event.end);
            if (!rawStart || !rawEnd) continue;
            const start = new Date(Math.max(rawStart.getTime(), dayStart.getTime()));
            const end = new Date(Math.min(rawEnd.getTime(), dayEnd.getTime()));
            if (end <= start) continue;
            items.push({
                durationMinutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000)),
                end,
                event,
                id: `event-${event.id}`,
                kind: 'event',
                start,
                title: event.title,
            });
        }

        return items.sort((a, b) => {
            const startDelta = a.start.getTime() - b.start.getTime();
            if (startDelta !== 0) return startDelta;
            return b.durationMinutes - a.durationMinutes;
        });
    };
    const layoutTimedItems = (date: Date) => {
        const items = getTimedItemsForDay(date);
        const dayStart = new Date(date);
        dayStart.setHours(DESKTOP_DAY_START_HOUR, 0, 0, 0);
        const dayStartMs = dayStart.getTime();
        const minimumDisplayMinutes = DESKTOP_MIN_TIMED_ITEM_HEIGHT / DESKTOP_HOUR_HEIGHT * 60;
        const layouts = buildTimedCalendarLayouts(items.map((item) => ({
            id: item.id,
            startMinutes: (item.start.getTime() - dayStartMs) / 60_000,
            // Very short appointments still need a readable hit target. Their
            // visual height participates in lane layout so adjacent five-minute
            // events never paint over one another.
            endMinutes: Math.max(
                (item.end.getTime() - dayStartMs) / 60_000,
                (item.start.getTime() - dayStartMs) / 60_000 + minimumDisplayMinutes,
            ),
        })));
        return items.map((item) => ({
            ...item,
            ...(layouts.get(item.id) ?? { columnCount: 1, columnIndex: 0, leftPercent: 0, widthPercent: 100 }),
            height: Math.max(DESKTOP_MIN_TIMED_ITEM_HEIGHT, item.durationMinutes / 60 * DESKTOP_HOUR_HEIGHT),
            top: Math.max(0, ((item.start.getHours() - DESKTOP_DAY_START_HOUR) * 60 + item.start.getMinutes()) / 60 * DESKTOP_HOUR_HEIGHT),
        }));
    };

    useEffect(() => {
        const handleCalendarShortcut = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const target = event.target;
            if (target instanceof HTMLElement) {
                const tag = target.tagName.toLowerCase();
                if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
            }

            const consume = () => {
                event.preventDefault();
                event.stopPropagation();
            };

            switch (event.key) {
                case 't':
                    consume();
                    nav.handleToday();
                    break;
                case 'd':
                    consume();
                    nav.handleViewModeChange('day');
                    break;
                case 'w':
                    consume();
                    nav.handleViewModeChange('week');
                    break;
                case 'm':
                    consume();
                    nav.handleViewModeChange('month');
                    break;
                case 'a':
                    consume();
                    nav.handleViewModeChange('schedule');
                    break;
                case 'ArrowLeft':
                    consume();
                    nav.handlePrevMonth();
                    break;
                case 'ArrowRight':
                    consume();
                    nav.handleNextMonth();
                    break;
                case 'n':
                    consume();
                    composer.openQuickAddForDate(selectedDate ?? currentMonth);
                    break;
                default:
                    break;
            }
        };

        window.addEventListener('keydown', handleCalendarShortcut, true);
        return () => window.removeEventListener('keydown', handleCalendarShortcut, true);
    }, [currentMonth, selectedDate, viewMode]);

    // Listed rather than spread: the sub-hooks expose a few members purely so
    // this file can wire them together (`revealDate`, `visibleRange`,
    // `openTaskComposerAt`, the per-day task lookups), and those have no
    // business in the view's surface.
    return {
        areas,
        beginEditScheduledTime: selectedDay.beginEditScheduledTime,
        calendarBodyRef,
        calendarNameById: external.calendarNameById,
        calendarSystem,
        cancelEditScheduledTime: selectedDay.cancelEditScheduledTime,
        closeOpenTask,
        closeSelectedDay: nav.closeSelectedDay,
        closeTaskComposer: composer.closeTaskComposer,
        commitEditScheduledTime: selectedDay.commitEditScheduledTime,
        createTaskFromExternalEvent,
        currentMonth,
        currentMonthLabel: nav.currentMonthLabel,
        currentYear: nav.currentYear,
        days: nav.days,
        editingTimeTaskId: selectedDay.editingTimeTaskId,
        editingTimeValue: selectedDay.editingTimeValue,
        externalCalendars: external.externalCalendars,
        externalError: external.externalError,
        getAllDayItemsForDay,
        getCalendarItemsForDate,
        getExternalCalendarColor: external.getExternalCalendarColor,
        handleMonthChange: nav.handleMonthChange,
        handleNextMonth: nav.handleNextMonth,
        handlePrevMonth: nav.handlePrevMonth,
        handleToday: nav.handleToday,
        handleViewModeChange: nav.handleViewModeChange,
        handleYearChange: nav.handleYearChange,
        hiddenExternalCalendarIds: external.hiddenExternalCalendarIds,
        isExternalLoading: external.isExternalLoading,
        isMonthPickerOpen: nav.isMonthPickerOpen,
        layoutTimedItems,
        locale: calendarLocale,
        markTaskDone,
        monthNames: nav.monthNames,
        openDayViewForDate: nav.openDayViewForDate,
        openProject,
        openQuickAddForDate: composer.openQuickAddForDate,
        openQuickAddForStart: composer.openQuickAddForStart,
        openTask,
        openTaskFromCalendar,
        planningTasks,
        projects,
        quickAddSuggestionTokens,
        resolveText,
        saveTaskComposer: composer.saveTaskComposer,
        scheduleCandidates: selectedDay.scheduleCandidates,
        scheduleDays: nav.scheduleDays,
        scheduleError: selectedDay.scheduleError,
        schedulePlanningTask: selectedDay.schedulePlanningTask,
        scheduleQuery: selectedDay.scheduleQuery,
        scheduleTaskOnSelectedDate: selectedDay.scheduleTaskOnSelectedDate,
        selectCalendarDate: nav.selectCalendarDate,
        selectTaskComposerTask: composer.selectTaskComposerTask,
        selectedAllDayEvents: selectedDay.selectedAllDayEvents,
        selectedComposerTask: composer.selectedComposerTask,
        selectedDate,
        selectedExternalEvents: selectedDay.selectedExternalEvents,
        selectedTaskRows: selectedDay.selectedTaskRows,
        selectedTimedEvents: selectedDay.selectedTimedEvents,
        t,
        taskComposer: composer.taskComposer,
        taskComposerCandidates: composer.taskComposerCandidates,
        taskComposerError: composer.taskComposerError,
        timeEstimateToMinutes,
        timelineDays: nav.timelineDays,
        toggleExternalCalendar: external.toggleExternalCalendar,
        toggleMonthPicker: nav.toggleMonthPicker,
        updateEditingTimeValue: selectedDay.updateEditingTimeValue,
        updateScheduleQuery: selectedDay.updateScheduleQuery,
        updateTask,
        updateTaskComposerDuration: composer.updateTaskComposerDuration,
        updateTaskComposerEndTime: composer.updateTaskComposerEndTime,
        updateTaskComposerMode: composer.updateTaskComposerMode,
        updateTaskComposerQuery: composer.updateTaskComposerQuery,
        updateTaskComposerStart: composer.updateTaskComposerStart,
        updateTaskComposerTitle: composer.updateTaskComposerTitle,
        updateTaskDateFromDrop,
        updateTaskStartTimeFromDrop,
        updateViewFilterQuery,
        viewFilterQuery,
        viewMode,
        visibleSearchMatchCount,
        weekdayHeaders: nav.weekdayHeaders,
        yearOptions: nav.yearOptions,
    };
}

export type DesktopCalendarController = ReturnType<typeof useDesktopCalendarController>;
