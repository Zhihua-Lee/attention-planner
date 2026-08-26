import { useCallback, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Plus, Sparkles } from 'lucide-react';
import {
    formatFocusTaskLimitText,
    getFocusStarBlockedText,
    getTaskScheduledAt,
    getTaskUnschedulePatch,
    isTaskInActiveProject,
    isTaskAttentionEligible,
    normalizeFocusTaskLimit,
    safeFormatDate,
    safeParseDate,
    shallow,
    sortTasksByFocusOrder,
    tFallback,
    useTaskStore,
    type Task,
} from '@mindwtr/core';

import { useLanguage } from '../../contexts/language-context';
import { useUiStore } from '../../store/ui-store';
import { PromptModal } from '../PromptModal';
import { StoreTaskItem } from './list/StoreTaskItem';

const READY_PREVIEW_LIMIT = 12;

function isSameLocalDay(value: string | undefined, day: Date): boolean {
    const parsed = safeParseDate(value);
    return Boolean(
        parsed
        && parsed.getFullYear() === day.getFullYear()
        && parsed.getMonth() === day.getMonth()
        && parsed.getDate() === day.getDate(),
    );
}

function defaultScheduleValue(now: Date): string {
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15);
    if (next.getTime() <= now.getTime()) next.setMinutes(next.getMinutes() + 15);
    return formatScheduleValue(next);
}

function formatScheduleValue(value: Date): string {
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function TodayPlanView() {
    const { t } = useLanguage();
    const {
        tasks,
        projects,
        settings,
        updateTask,
    } = useTaskStore((state) => ({
        tasks: state.tasks,
        projects: state.projects,
        settings: state.settings,
        updateTask: state.updateTask,
    }), shallow);
    const showToast = useUiStore((state) => state.showToast);
    const [scheduleTaskId, setScheduleTaskId] = useState<string | null>(null);
    const [showAllReady, setShowAllReady] = useState(false);
    const now = new Date();
    const focusTaskLimit = normalizeFocusTaskLimit(settings?.gtd?.focusTaskLimit);
    const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
    const activeTasks = useMemo(() => tasks.filter((task) => (
        !task.deletedAt
        && task.status !== 'done'
        && task.status !== 'archived'
        && task.status !== 'reference'
        && isTaskInActiveProject(task, projectMap)
    )), [projectMap, tasks]);
    const commitments = useMemo(
        () => sortTasksByFocusOrder(activeTasks.filter((task) => (
            task.isFocusedToday && isTaskAttentionEligible(task, now)
        ))),
        [activeTasks, now],
    );
    const scheduledToday = useMemo(() => activeTasks
        .filter((task) => (
            isTaskAttentionEligible(task, now)
            && isSameLocalDay(getTaskScheduledAt(task), now)
        ))
        .sort((left, right) => (
            (safeParseDate(getTaskScheduledAt(left))?.getTime() ?? Number.MAX_SAFE_INTEGER)
            - (safeParseDate(getTaskScheduledAt(right))?.getTime() ?? Number.MAX_SAFE_INTEGER)
        )), [activeTasks, now]);
    const scheduledTodayIds = useMemo(() => new Set(scheduledToday.map((task) => task.id)), [scheduledToday]);
    const readyTasks = useMemo(() => activeTasks
        .filter((task) => (
            !task.isFocusedToday
            && !scheduledTodayIds.has(task.id)
            && isTaskAttentionEligible(task, now)
        ))
        .sort((left, right) => {
            const leftDue = safeParseDate(left.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const rightDue = safeParseDate(right.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
            return leftDue - rightDue || left.createdAt.localeCompare(right.createdAt);
        }), [activeTasks, now, scheduledTodayIds]);
    const focusedCount = commitments.length;
    const visibleReadyTasks = showAllReady ? readyTasks : readyTasks.slice(0, READY_PREVIEW_LIMIT);

    const toggleCommitment = useCallback((task: Task) => {
        const action = useTaskStore.getState().getFocusStarAction(task);
        if (!action.canToggle) {
            const message = getFocusStarBlockedText(t, action, focusTaskLimit);
            if (message) showToast(message, 'info');
            return;
        }
        void updateTask(task.id, action.patch);
    }, [focusTaskLimit, showToast, t, updateTask]);

    const buildFocusToggle = useCallback((task: Task) => {
        const isFocused = Boolean(task.isFocusedToday);
        const canToggle = isFocused || focusedCount < focusTaskLimit;
        const title = isFocused
            ? t('agenda.removeFromFocus')
            : focusedCount >= focusTaskLimit
                ? formatFocusTaskLimitText(t('agenda.maxFocusItems'), focusTaskLimit)
                : t('agenda.addToFocus');
        return {
            isFocused,
            canToggle,
            onToggle: () => toggleCommitment(task),
            title,
            ariaLabel: title,
            alwaysVisible: true,
        };
    }, [focusTaskLimit, focusedCount, t, toggleCommitment]);

    const scheduleTask = scheduleTaskId ? tasks.find((task) => task.id === scheduleTaskId) ?? null : null;

    return (
        <div className="mx-auto max-w-5xl space-y-8" data-testid="today-plan-view">
            <section aria-labelledby="today-commitments-heading" className="border-t border-border/70 pt-5">
                <div className="mb-3 flex items-end justify-between gap-4">
                    <div>
                        <h2 id="today-commitments-heading" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
                            {t('agenda.todaysFocus')}
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {tFallback(t, 'todayPlan.commitmentsHint', 'Choose a few outcomes you will protect today.')}
                        </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {focusedCount}/{focusTaskLimit}
                    </span>
                </div>
                {commitments.length > 0 ? (
                    <div className="divide-y divide-border/40 border-y border-border/60">
                        {commitments.map((task) => (
                            <StoreTaskItem
                                key={task.id}
                                taskId={task.id}
                                buildFocusToggle={buildFocusToggle}
                                compactMetaEnabled
                                enableDoubleClickEdit
                                showProjectBadgeInActions={false}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="flex items-center gap-3 border-y border-dashed border-border/70 px-1 py-5 text-sm text-muted-foreground">
                        <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        {tFallback(t, 'todayPlan.noCommitments', 'Nothing committed yet. Add one from Ready below.')}
                    </div>
                )}
            </section>

            <section aria-labelledby="today-time-heading" className="border-t border-border/70 pt-5">
                <div className="mb-3">
                    <h2 id="today-time-heading" className="flex items-center gap-2 text-lg font-semibold tracking-[-0.015em] text-foreground">
                        <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        {tFallback(t, 'todayPlan.timeBlocks', 'Time blocks')}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {tFallback(t, 'todayPlan.timeBlocksHint', 'Soft calendar reservations; deadlines remain separate.')}
                    </p>
                </div>
                {scheduledToday.length > 0 ? (
                    <ol className="divide-y divide-border/40 border-y border-border/60">
                        {scheduledToday.map((task) => {
                            const scheduledAt = getTaskScheduledAt(task);
                            return (
                                <li key={task.id} className="flex min-w-0 items-center gap-4 py-3">
                                    <time className="w-20 shrink-0 font-mono text-sm font-medium tabular-nums text-foreground" dateTime={scheduledAt}>
                                        {safeFormatDate(scheduledAt, 'p')}
                                    </time>
                                    <button
                                        type="button"
                                        onClick={() => setScheduleTaskId(task.id)}
                                        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                    >
                                        {task.title}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void updateTask(task.id, getTaskUnschedulePatch(task))}
                                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                    >
                                        {t('calendar.unschedule')}
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                ) : (
                    <p className="border-y border-dashed border-border/70 px-1 py-5 text-sm text-muted-foreground">
                        {tFallback(t, 'todayPlan.noTimeBlocks', 'No task time blocks today. Schedule from Ready only when a clock time matters.')}
                    </p>
                )}
            </section>

            <section aria-labelledby="today-ready-heading" className="border-t border-border/70 pt-5">
                <div className="mb-3">
                    <h2 id="today-ready-heading" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
                        {t('agenda.nextActions')}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {tFallback(t, 'todayPlan.readyHint', 'Pull work into Today or reserve an exact time. No extra classification is required.')}
                    </p>
                </div>
                {readyTasks.length > 0 ? (
                    <div className="divide-y divide-border/40 border-y border-border/60">
                        {visibleReadyTasks.map((task) => (
                            <div key={task.id} className="flex min-w-0 items-center gap-3 py-2">
                                <div className="min-w-0 flex-1">
                                    <StoreTaskItem
                                        taskId={task.id}
                                        compactMetaEnabled
                                        enableDoubleClickEdit
                                        showProjectBadgeInActions={false}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => toggleCommitment(task)}
                                    disabled={focusedCount >= focusTaskLimit}
                                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                >
                                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                    {t('calendar.today')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setScheduleTaskId(task.id)}
                                    className="inline-flex h-9 shrink-0 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                >
                                    {t('calendar.schedule')}
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex items-center gap-3 border-y border-dashed border-border/70 px-1 py-5 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                        {tFallback(t, 'todayPlan.noReady', 'Ready is clear. Capture new work in Inbox when it appears.')}
                    </div>
                )}
                {readyTasks.length > READY_PREVIEW_LIMIT ? (
                    <div className="flex flex-col gap-2 border-b border-border/60 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs tabular-nums text-muted-foreground">
                            {tFallback(t, 'todayPlan.readyCount', '{{shown}} of {{count}} Ready tasks')
                                .replace('{{shown}}', String(visibleReadyTasks.length))
                                .replace('{{count}}', String(readyTasks.length))}
                        </p>
                        <button
                            type="button"
                            onClick={() => setShowAllReady((current) => !current)}
                            className="min-h-11 self-start rounded-md px-2 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-9 sm:self-auto"
                        >
                            {showAllReady
                                ? tFallback(t, 'todayPlan.showFewerReady', 'Show fewer Ready tasks')
                                : tFallback(t, 'todayPlan.viewAllReady', 'View all {{count}} Ready tasks')
                                    .replace('{{count}}', String(readyTasks.length))}
                        </button>
                    </div>
                ) : null}
            </section>

            <PromptModal
                isOpen={Boolean(scheduleTask)}
                title={t('calendar.schedule')}
                description={scheduleTask?.title}
                inputType="datetime-local"
                defaultValue={scheduleTask ? (() => {
                    const existing = safeParseDate(getTaskScheduledAt(scheduleTask));
                    return existing ? formatScheduleValue(existing) : defaultScheduleValue(new Date());
                })() : ''}
                confirmLabel={t('calendar.schedule')}
                cancelLabel={t('common.cancel')}
                onCancel={() => setScheduleTaskId(null)}
                onConfirm={(value) => {
                    if (!scheduleTask || !value) return;
                    const parsed = new Date(value);
                    if (Number.isNaN(parsed.getTime())) return;
                    void updateTask(scheduleTask.id, { scheduledAt: parsed.toISOString() });
                    setScheduleTaskId(null);
                }}
            />
        </div>
    );
}
