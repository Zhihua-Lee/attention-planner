import { useCallback, useEffect, useMemo } from 'react';
import {
    advanceProcessInboxSession,
    addBreadcrumb,
    commitProcessInboxWorkflowEvent,
    DEFAULT_PROJECT_COLOR,
    enterProcessInboxStep,
    getPersonOptionNames,
    goBackProcessInboxStep,
    parseQuickAddDateCommands,
    skipCurrentProcessInboxTask,
    startProcessInboxSession,
    tFallback,
    useTaskStore,
    type AppData,
    type Area,
    type Project,
    type ProcessInboxWorkflowEvent,
    type ProcessInboxWorkflowFields,
    type StoreActionResult,
    type Task,
} from '@mindwtr/core';

import type { InboxProcessingQuickPanelProps } from '../../InboxProcessingQuickPanel';
import type { InboxProcessingWizardProps, ProcessingStep } from '../../InboxProcessingWizard';
import { reportError } from '../../../lib/report-error';
import { useUiStore } from '../../../store/ui-store';
import {
    buildDateTimeUpdate,
    parseTokenListInput,
} from './inbox-processing-utils';
import { useInboxProcessingState } from './useInboxProcessingState';

const formatTokenListInput = (tokens: string[]): string => tokens.join(', ');

type UseInboxProcessingControllerParams = {
    t: (key: string) => string;
    tasks: Task[];
    projects: Project[];
    areas: Area[];
    settings?: AppData['settings'];
    addProject: (title: string, color: string, initialProps?: Partial<Project>) => Promise<Project | null>;
    addTask: (title: string, initialProps?: Partial<Task>) => Promise<StoreActionResult>;
    updateTask: (id: string, updates: Partial<Task>) => Promise<StoreActionResult>;
    deleteTask: (id: string) => Promise<StoreActionResult>;
    allContexts: string[];
    allTags: string[];
    isProcessing: boolean;
    setIsProcessing: (value: boolean) => void;
};

type UseInboxProcessingControllerResult = {
    inboxCount: number;
    quickPanelProps: InboxProcessingQuickPanelProps | null;
    showStartButton: boolean;
    startProcessing: () => void;
    wizardProps: InboxProcessingWizardProps;
};

export function useInboxProcessingController({
    t,
    tasks,
    projects,
    areas,
    settings,
    addProject,
    addTask,
    updateTask,
    deleteTask,
    allContexts,
    allTags,
    isProcessing,
    setIsProcessing,
}: UseInboxProcessingControllerParams): UseInboxProcessingControllerResult {
    const showToast = useUiStore((state) => state.showToast);
    const people = useTaskStore((state) => state.people);
    const personOptions = useMemo(() => getPersonOptionNames(people, tasks), [people, tasks]);
    const {
        processingMode,
        setProcessingMode,
        processingSession,
        setProcessingSession,
        processingTask,
        processingStep,
        stepHistory,
        quickActionability,
        setQuickActionability,
        quickTwoMinuteChoice,
        setQuickTwoMinuteChoice,
        quickExecutionChoice,
        setQuickExecutionChoice,
        selectedContexts,
        setSelectedContexts,
        contextsDraft,
        setContextsDraft,
        selectedTags,
        setSelectedTags,
        tagsDraft,
        setTagsDraft,
        selectedEnergyLevel,
        setSelectedEnergyLevel,
        selectedAssignedTo,
        setSelectedAssignedTo,
        selectedPriority,
        setSelectedPriority,
        selectedTimeEstimate,
        setSelectedTimeEstimate,
        delegateWho,
        setDelegateWho,
        delegateFollowUp,
        setDelegateFollowUp,
        projectSearch,
        setProjectSearch,
        processingTitle,
        setProcessingTitle,
        processingDescription,
        setProcessingDescription,
        convertToProject,
        setConvertToProject,
        projectTitleDraft,
        setProjectTitleDraft,
        nextActionDraft,
        setNextActionDraft,
        extraActionDrafts,
        setExtraActionDrafts,
        customContext,
        setCustomContext,
        customTag,
        setCustomTag,
        selectedProjectId,
        setSelectedProjectId,
        selectedAreaId,
        setSelectedAreaId,
        twoMinuteEnabled,
        twoMinuteFirst,
        projectFirst,
        scheduleEnabled,
        referenceEnabled,
        prioritiesEnabled,
        showProjectField,
        showAreaField,
        showContextsField,
        showTagsField,
        showPriorityField,
        showEnergyLevelField,
        showAssignedToField,
        showTimeEstimateField,
        showProjectStep,
        visibleScheduleFieldKeys,
        showScheduleFields,
        showOrganizationStep,
        areaById,
        filteredProjects,
        hasExactProjectMatch,
        activeAreas,
        inboxCount,
        eligibleInboxTasks,
        remainingInboxCount,
        resetProcessingSession,
        hydrateProcessingTask,
        suggestedContexts,
        suggestedTags,
        scheduleDate,
        scheduleTime,
        scheduleTimeDraft,
        dueDate,
        dueTime,
        dueTimeDraft,
        reviewDate,
        reviewTime,
        reviewTimeDraft,
        handleScheduleTimeCommit,
        handleDueTimeCommit,
        handleReviewTimeCommit,
        scheduleFields,
        timeEstimateOptions,
    } = useInboxProcessingState({
        tasks,
        projects,
        areas,
        settings,
    });
    const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

    const handleSetSelectedAreaId = useCallback((areaId: string | null) => {
        setSelectedAreaId(areaId);
        setSelectedProjectId((currentProjectId) => {
            if (!currentProjectId || !areaId) return currentProjectId;
            const project = projectMap.get(currentProjectId);
            return project?.areaId === areaId ? currentProjectId : null;
        });
    }, [projectMap, setSelectedAreaId, setSelectedProjectId]);

    useEffect(() => {
        if (isProcessing) return;
        resetProcessingSession();
    }, [isProcessing, resetProcessingSession]);

    const startProcessing = useCallback(() => {
        if (eligibleInboxTasks.length === 0) return;
        const session = startProcessInboxSession(eligibleInboxTasks, { entryStep: 'refine' });
        hydrateProcessingTask(eligibleInboxTasks[0], session);
        addBreadcrumb('inbox:start');
        setIsProcessing(true);
    }, [eligibleInboxTasks, hydrateProcessingTask, setIsProcessing]);

    const closeProcessing = useCallback(() => {
        setIsProcessing(false);
    }, [setIsProcessing]);

    const applySessionTransition = useCallback((nextSession: typeof processingSession) => {
        const nextTask = nextSession.currentTaskId
            ? eligibleInboxTasks.find((task) => task.id === nextSession.currentTaskId)
            : undefined;
        if (nextTask) {
            hydrateProcessingTask(nextTask, nextSession);
            return;
        }
        addBreadcrumb('inbox:done');
        setProcessingSession(nextSession);
        setIsProcessing(false);
        setSelectedContexts([]);
        setContextsDraft('');
        setSelectedTags([]);
        setTagsDraft('');
        setSelectedEnergyLevel(undefined);
        setSelectedAssignedTo('');
        setSelectedPriority(undefined);
        setSelectedTimeEstimate(undefined);
    }, [
        eligibleInboxTasks,
        hydrateProcessingTask,
        setContextsDraft,
        setIsProcessing,
        setProcessingSession,
        setSelectedAssignedTo,
        setSelectedContexts,
        setSelectedEnergyLevel,
        setSelectedPriority,
        setSelectedTags,
        setSelectedTimeEstimate,
        setTagsDraft,
    ]);

    useEffect(() => {
        if (!isProcessing || processingTask) return;
        applySessionTransition(advanceProcessInboxSession(
            processingSession,
            eligibleInboxTasks,
            { entryStep: 'refine' },
        ));
    }, [applySessionTransition, eligibleInboxTasks, isProcessing, processingSession, processingTask]);

    const processNext = useCallback(() => {
        applySessionTransition(advanceProcessInboxSession(
            processingSession,
            eligibleInboxTasks,
            { entryStep: 'refine' },
        ));
    }, [applySessionTransition, eligibleInboxTasks, processingSession]);

    const handleSkip = useCallback(() => {
        if (!processingTask) return;
        applySessionTransition(skipCurrentProcessInboxTask(
            processingSession,
            eligibleInboxTasks,
            { entryStep: 'refine' },
        ));
    }, [applySessionTransition, eligibleInboxTasks, processingSession, processingTask]);

    const buildScheduleUpdates = useCallback(
        () => (scheduleEnabled
            ? {
                startTime: buildDateTimeUpdate(scheduleDate, scheduleTimeDraft, scheduleTime),
                dueDate: buildDateTimeUpdate(dueDate, dueTimeDraft, dueTime),
                reviewAt: buildDateTimeUpdate(reviewDate, reviewTimeDraft, reviewTime),
            }
            : {}),
        [
            dueDate,
            dueTime,
            dueTimeDraft,
            reviewDate,
            reviewTime,
            reviewTimeDraft,
            scheduleDate,
            scheduleEnabled,
            scheduleTime,
            scheduleTimeDraft,
        ],
    );

    const prepareProcessingEdits = useCallback((
        titleInput: string = processingTitle,
        fallbackTitle?: string,
    ): Partial<Task> | null => {
        if (!processingTask) return null;
        const { title: parsedTitle, props: parsedDateProps, invalidDateCommands } = parseQuickAddDateCommands(
            titleInput,
            new Date(),
            { preserveText: settings?.quickAddAutoClean !== true },
        );
        if (invalidDateCommands && invalidDateCommands.length > 0) {
            showToast(`${t('quickAdd.invalidDateCommand')}: ${invalidDateCommands.join(', ')}`, 'error');
            return null;
        }
        const trimmedTitle = parsedTitle.trim();
        const title = trimmedTitle.length > 0 ? trimmedTitle : (fallbackTitle ?? processingTask.title);
        const description = processingDescription.trim();
        return {
            title,
            description: description.length > 0 ? description : undefined,
            ...parsedDateProps,
        };
    }, [processingDescription, processingTask, processingTitle, settings?.quickAddAutoClean, showToast, t]);

    const applyWorkflowEvent = useCallback(async (
        event: ProcessInboxWorkflowEvent,
        titleInput?: string,
        fallbackTitle?: string,
        options: { advance?: boolean } = {},
    ): Promise<boolean> => {
        if (!processingTask) return false;
        const taskUpdates = event.type === 'discard'
            ? undefined
            : prepareProcessingEdits(titleInput, fallbackTitle);
        if (event.type !== 'discard' && !taskUpdates) return false;
        try {
            const outcome = await commitProcessInboxWorkflowEvent(
                processingSession,
                eligibleInboxTasks,
                event,
                { deleteTask, updateTask },
                {
                    entryStep: 'refine',
                    taskUpdates: taskUpdates ?? undefined,
                    advance: options.advance,
                },
            );
            if (!outcome.writeResult.success) {
                showToast(outcome.writeResult.error || t('task.updateFailed'), 'error');
                return false;
            }
            if (options.advance !== false) applySessionTransition(outcome.session);
            return true;
        } catch (error) {
            reportError('Failed to commit inbox processing decision', error);
            showToast(t('task.updateFailed'), 'error');
            return false;
        }
    }, [
        applySessionTransition,
        deleteTask,
        eligibleInboxTasks,
        prepareProcessingEdits,
        processingSession,
        processingTask,
        showToast,
        t,
        updateTask,
    ]);

    const goToStep = useCallback((nextStep: ProcessingStep) => {
        setProcessingSession((current) => enterProcessInboxStep(current, nextStep));
    }, [setProcessingSession]);

    const goBack = useCallback(() => {
        setProcessingSession((current) => goBackProcessInboxStep(current));
    }, [setProcessingSession]);

    const buildReferenceFields = useCallback((): ProcessInboxWorkflowFields => {
        const fields: ProcessInboxWorkflowFields = {};
        if (showContextsField) fields.contexts = selectedContexts;
        if (showTagsField) fields.tags = selectedTags;
        return fields;
    }, [selectedContexts, selectedTags, showContextsField, showTagsField]);

    const handleNotActionable = useCallback(async (action: 'trash' | 'someday' | 'reference') => {
        if (!processingTask) return;
        if (action === 'trash') {
            await applyWorkflowEvent({ type: 'discard' });
            return;
        }
        if (action === 'reference') {
            if (processingMode === 'guided' && (showContextsField || showTagsField)) {
                goToStep('reference');
                return;
            }
            await applyWorkflowEvent({ type: 'reference', fields: buildReferenceFields() });
            return;
        }
        await applyWorkflowEvent({ type: 'someday' });
    }, [
        applyWorkflowEvent,
        buildReferenceFields,
        goToStep,
        processingMode,
        processingTask,
        showContextsField,
        showTagsField,
    ]);

    const handleConfirmReference = useCallback(async () => {
        if (!processingTask) return;
        await applyWorkflowEvent({ type: 'reference', fields: buildReferenceFields() });
    }, [applyWorkflowEvent, buildReferenceFields, processingTask]);

    const handleLater = useCallback(async () => {
        if (!processingTask) return;
        handleScheduleTimeCommit();
        const startTime = buildDateTimeUpdate(scheduleDate, scheduleTimeDraft, scheduleTime);
        if (!startTime) {
            showToast(tFallback(t, 'process.laterStartRequired', 'Choose a start date for Later.'), 'error');
            return;
        }
        const projectUpdates = projectFirst && showProjectStep
            ? {
                ...(showProjectField ? { projectId: selectedProjectId || undefined } : {}),
                ...(showAreaField ? { areaId: selectedProjectId ? undefined : (selectedAreaId || undefined) } : {}),
            }
            : {};
        await applyWorkflowEvent({
            type: 'later',
            fields: { ...projectUpdates, availableAt: startTime },
        });
    }, [
        applyWorkflowEvent,
        handleScheduleTimeCommit,
        processingTask,
        projectFirst,
        scheduleDate,
        scheduleTime,
        scheduleTimeDraft,
        selectedAreaId,
        selectedProjectId,
        showAreaField,
        showProjectField,
        showProjectStep,
        showToast,
        t,
    ]);

    const getInitialGuidedStep = useCallback<() => ProcessingStep>(() => (
        twoMinuteEnabled && twoMinuteFirst ? 'twomin' : 'actionable'
    ), [twoMinuteEnabled, twoMinuteFirst]);

    const continueFromProjectCheck = useCallback(() => {
        if (!twoMinuteEnabled) {
            goToStep('decide');
            return;
        }
        goToStep(twoMinuteFirst ? 'decide' : 'twomin');
    }, [goToStep, twoMinuteEnabled, twoMinuteFirst]);

    const handleActionable = useCallback(() => {
        goToStep('projectcheck');
    }, [goToStep]);

    const handleProjectCheckNo = useCallback(() => {
        continueFromProjectCheck();
    }, [continueFromProjectCheck]);

    const handleProjectCheckYes = useCallback(() => {
        const { title: parsedTitle } = parseQuickAddDateCommands(processingTitle, new Date(), {
            preserveText: settings?.quickAddAutoClean !== true,
        });
        const baseTitle = parsedTitle.trim() || processingTitle.trim() || processingTask?.title || '';
        setConvertToProject(true);
        setProjectTitleDraft(baseTitle);
        setNextActionDraft(baseTitle);
        setExtraActionDrafts([]);
        goToStep('project');
    }, [goToStep, processingTask?.title, processingTitle, setExtraActionDrafts, settings?.quickAddAutoClean]);

    const handleTwoMinDone = useCallback(async () => {
        if (!processingTask) return;
        await applyWorkflowEvent({ type: 'complete' });
    }, [applyWorkflowEvent, processingTask]);

    const handleTwoMinNo = useCallback(() => {
        goToStep(twoMinuteFirst ? 'actionable' : 'decide');
    }, [goToStep, twoMinuteFirst]);

    const handleDelegate = useCallback(() => {
        setDelegateWho('');
        setDelegateFollowUp('');
        goToStep('delegate');
    }, [goToStep]);

    const handleConfirmWaiting = useCallback(async () => {
        if (!processingTask) return;
        const who = delegateWho.trim();
        const scheduleUpdates = buildScheduleUpdates();
        const applied = await applyWorkflowEvent({
            type: 'waiting',
            fields: {
                energyLevel: selectedEnergyLevel ?? undefined,
                assignedTo: who || undefined,
                timeEstimate: selectedTimeEstimate ?? undefined,
                ...(prioritiesEnabled ? { priority: selectedPriority ?? undefined } : {}),
                ...scheduleUpdates,
                reviewAt: scheduleUpdates.reviewAt,
            },
            followUpAt: delegateFollowUp
                ? new Date(`${delegateFollowUp}T09:00:00`).toISOString()
                : undefined,
        });
        if (applied) {
            setDelegateWho('');
            setDelegateFollowUp('');
        }
    }, [
        applyWorkflowEvent,
        buildScheduleUpdates,
        delegateFollowUp,
        delegateWho,
        prioritiesEnabled,
        processingTask,
        selectedEnergyLevel,
        selectedPriority,
        selectedTimeEstimate,
    ]);

    const handleDelegateBack = useCallback(() => {
        goBack();
    }, [goBack]);

    const handleSendDelegateRequest = useCallback(() => {
        if (!processingTask) return;
        const title = processingTitle.trim() || processingTask.title;
        const baseDescription = processingDescription.trim() || processingTask.description || '';
        const who = delegateWho.trim();
        const greeting = who ? `Hi ${who},` : 'Hi,';
        const bodyParts = [
            greeting,
            '',
            `Could you please handle: ${title}`,
            baseDescription ? `\nDetails:\n${baseDescription}` : '',
            '',
            'Thanks!',
        ];
        const body = bodyParts.join('\n');
        const subject = `Delegation: ${title}`;
        const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(mailto);
    }, [delegateWho, processingDescription, processingTask, processingTitle]);

    const updateSelectedContexts = useCallback((contexts: string[]) => {
        setSelectedContexts(contexts);
        setContextsDraft(formatTokenListInput(contexts));
    }, [setContextsDraft, setSelectedContexts]);

    const updateSelectedTags = useCallback((tags: string[]) => {
        setSelectedTags(tags);
        setTagsDraft(formatTokenListInput(tags));
    }, [setSelectedTags, setTagsDraft]);

    const toggleTag = useCallback((tag: string) => {
        const nextTags = selectedTags.includes(tag)
            ? selectedTags.filter((item) => item !== tag)
            : [...selectedTags, tag];
        updateSelectedTags(nextTags);
    }, [selectedTags, updateSelectedTags]);

    const toggleContext = useCallback((ctx: string) => {
        if (ctx.startsWith('#')) {
            toggleTag(ctx);
            return;
        }
        const nextContexts = selectedContexts.includes(ctx)
            ? selectedContexts.filter((item) => item !== ctx)
            : [...selectedContexts, ctx];
        updateSelectedContexts(nextContexts);
    }, [selectedContexts, toggleTag, updateSelectedContexts]);

    const addCustomContext = useCallback((value?: string) => {
        const contexts = parseTokenListInput(value ?? customContext, '@');
        if (contexts.length > 0) {
            updateSelectedContexts(Array.from(new Set([...selectedContexts, ...contexts])));
        }
        setCustomContext('');
    }, [customContext, selectedContexts, setCustomContext, updateSelectedContexts]);

    const addCustomTag = useCallback((value?: string) => {
        const tags = parseTokenListInput(value ?? customTag, '#');
        if (tags.length > 0) {
            updateSelectedTags(Array.from(new Set([...selectedTags, ...tags])));
        }
        setCustomTag('');
    }, [customTag, selectedTags, setCustomTag, updateSelectedTags]);

    const handleSetProject = useCallback(async (projectId: string | null) => {
        if (!processingTask) return;
        await applyWorkflowEvent({
            type: 'next',
            fields: {
                contexts: showContextsField ? selectedContexts : (processingTask.contexts ?? []),
                tags: showTagsField ? selectedTags : (processingTask.tags ?? []),
                energyLevel: selectedEnergyLevel ?? undefined,
                assignedTo: selectedAssignedTo.trim() || undefined,
                timeEstimate: selectedTimeEstimate ?? undefined,
                ...(prioritiesEnabled ? { priority: selectedPriority ?? undefined } : {}),
                projectId: projectId || undefined,
                areaId: projectId ? undefined : (showAreaField ? (selectedAreaId || undefined) : (processingTask.areaId || undefined)),
                ...buildScheduleUpdates(),
            },
        });
    }, [
        applyWorkflowEvent,
        buildScheduleUpdates,
        prioritiesEnabled,
        processingTask,
        selectedAreaId,
        selectedAssignedTo,
        selectedContexts,
        selectedEnergyLevel,
        selectedPriority,
        selectedTimeEstimate,
        selectedTags,
        showAreaField,
        showContextsField,
        showTagsField,
    ]);

    const handleConfirmContexts = useCallback(() => {
        if (projectFirst) {
            handleSetProject(selectedProjectId);
            return;
        }
        if (!showProjectStep) {
            handleSetProject(selectedProjectId);
            return;
        }
        goToStep('project');
    }, [goToStep, handleSetProject, projectFirst, selectedProjectId, showProjectStep]);

    const handleDefer = useCallback(() => {
        if (showOrganizationStep) {
            const taskContexts = processingTask?.contexts ?? [];
            const taskTags = processingTask?.tags ?? [];
            updateSelectedContexts(taskContexts);
            updateSelectedTags(taskTags);
            goToStep('context');
            return;
        }
        if (projectFirst) {
            handleSetProject(selectedProjectId);
            return;
        }
        if (!showProjectStep) {
            handleSetProject(selectedProjectId);
            return;
        }
        goToStep('project');
    }, [
        goToStep,
        handleSetProject,
        processingTask?.contexts,
        processingTask?.tags,
        projectFirst,
        selectedProjectId,
        showOrganizationStep,
        showProjectStep,
        updateSelectedContexts,
        updateSelectedTags,
    ]);

    const handleConvertToProject = useCallback(async () => {
        if (!processingTask) return;
        const projectTitle = projectTitleDraft.trim() || processingTitle.trim();
        const nextAction = nextActionDraft.trim();
        if (!projectTitle) return;
        if (!nextAction) {
            alert(t('process.nextActionRequired'));
            return;
        }
        try {
            const existing = projects.find((project) => project.title.toLowerCase() === projectTitle.toLowerCase());
            const project = existing ?? await addProject(
                projectTitle,
                DEFAULT_PROJECT_COLOR,
                showAreaField && selectedAreaId ? { areaId: selectedAreaId } : undefined,
            );
            if (!project) return;
            const applied = await applyWorkflowEvent({
                type: 'next',
                fields: {
                    contexts: showContextsField ? selectedContexts : (processingTask.contexts ?? []),
                    tags: showTagsField ? selectedTags : (processingTask.tags ?? []),
                    energyLevel: selectedEnergyLevel ?? undefined,
                    assignedTo: selectedAssignedTo.trim() || undefined,
                    timeEstimate: selectedTimeEstimate ?? undefined,
                    ...(prioritiesEnabled ? { priority: selectedPriority ?? undefined } : {}),
                    projectId: project.id,
                    ...buildScheduleUpdates(),
                },
            }, nextAction, processingTask.title, { advance: false });
            if (applied) {
                // The converted capture becomes the project's clarified next
                // action. Extra actions typed at the split step are raw
                // captures, so they return to the Inbox (project attached)
                // for their own clarify pass — same semantics as a quick-add
                // with a +Project token (#827).
                const extraActions = extraActionDrafts.map((title) => title.trim()).filter(Boolean);
                for (const title of extraActions) {
                    const result = await addTask(title, { status: 'inbox', projectId: project.id });
                    if (!result.success) {
                        showToast(result.error || t('task.addFailed'), 'error');
                        return;
                    }
                }
                setExtraActionDrafts([]);
                processNext();
            }
        } catch (error) {
            reportError('Failed to create project from inbox processing', error);
            showToast(t('projects.createFailed') || 'Failed to create project', 'error');
        }
    }, [
        addProject,
        addTask,
        extraActionDrafts,
        setExtraActionDrafts,
        applyWorkflowEvent,
        buildScheduleUpdates,
        nextActionDraft,
        prioritiesEnabled,
        processingTask,
        processingTitle,
        processNext,
        projectTitleDraft,
        projects,
        selectedAreaId,
        selectedAssignedTo,
        selectedContexts,
        selectedEnergyLevel,
        selectedPriority,
        selectedTimeEstimate,
        selectedTags,
        showAreaField,
        showContextsField,
        showTagsField,
        showToast,
        t,
    ]);

    const handleRefineNext = useCallback(() => {
        goToStep(getInitialGuidedStep());
    }, [getInitialGuidedStep, goToStep]);

    const handleContextsInputChange = useCallback((value: string) => {
        setContextsDraft(value);
        setSelectedContexts(parseTokenListInput(value, '@'));
    }, [setContextsDraft, setSelectedContexts]);

    const handleTagsInputChange = useCallback((value: string) => {
        setTagsDraft(value);
        setSelectedTags(parseTokenListInput(value, '#'));
    }, [setSelectedTags, setTagsDraft]);

    const handleQuickSubmit = useCallback(async () => {
        handleScheduleTimeCommit();
        handleDueTimeCommit();
        handleReviewTimeCommit();
        if (quickActionability === 'later') {
            await handleLater();
            return;
        }
        if (quickActionability !== 'actionable') {
            await handleNotActionable(quickActionability);
            return;
        }
        if (quickTwoMinuteChoice === 'yes') {
            await handleTwoMinDone();
            return;
        }
        if (quickExecutionChoice === 'delegate') {
            await handleConfirmWaiting();
            return;
        }
        if (convertToProject) {
            await handleConvertToProject();
            return;
        }
        await handleSetProject(selectedProjectId);
    }, [
        convertToProject,
        handleConfirmWaiting,
        handleConvertToProject,
        handleDueTimeCommit,
        handleLater,
        handleNotActionable,
        handleReviewTimeCommit,
        handleScheduleTimeCommit,
        handleSetProject,
        handleTwoMinDone,
        quickActionability,
        quickExecutionChoice,
        quickTwoMinuteChoice,
        selectedProjectId,
    ]);

    const showStartButton = inboxCount > 0 && !isProcessing;

    const quickPanelProps = isProcessing && processingTask && processingMode === 'quick'
        ? {
            t,
            processingTask,
            remainingCount: remainingInboxCount,
            processingTitle,
            processingDescription,
            setProcessingTitle,
            setProcessingDescription,
            processingMode,
            onModeChange: setProcessingMode,
            onSkip: handleSkip,
            onClose: closeProcessing,
            showReferenceOption: referenceEnabled,
            actionabilityChoice: quickActionability,
            setActionabilityChoice: setQuickActionability,
            twoMinuteChoice: quickTwoMinuteChoice,
            setTwoMinuteChoice: setQuickTwoMinuteChoice,
            executionChoice: quickExecutionChoice,
            setExecutionChoice: setQuickExecutionChoice,
            showScheduleFields,
            scheduleFields,
            visibleScheduleFieldKeys,
            delegateWho,
            setDelegateWho,
            delegateFollowUp,
            setDelegateFollowUp,
            onSendDelegateRequest: handleSendDelegateRequest,
            selectedContexts,
            contextsDraft,
            selectedTags,
            tagsDraft,
            selectedEnergyLevel,
            setSelectedEnergyLevel,
            selectedAssignedTo,
            setSelectedAssignedTo,
            personOptions,
            selectedTimeEstimate,
            setSelectedTimeEstimate,
            timeEstimateOptions,
            showContextsField,
            showTagsField,
            showEnergyLevelField,
            showAssignedToField,
            showTimeEstimateField,
            showPriorityField,
            selectedPriority,
            setSelectedPriority,
            onContextsInputChange: handleContextsInputChange,
            onTagsInputChange: handleTagsInputChange,
            toggleContext,
            toggleTag,
            suggestedContexts,
            suggestedTags,
            allContexts,
            allTags,
            projects,
            areas: activeAreas,
            selectedProjectId,
            setSelectedProjectId,
            selectedAreaId,
            setSelectedAreaId: handleSetSelectedAreaId,
            showProjectField,
            showAreaField,
            convertToProject,
            setConvertToProject,
            projectTitleDraft,
            setProjectTitleDraft,
            nextActionDraft,
            setNextActionDraft,
            addProject,
            onSubmit: handleQuickSubmit,
        }
        : null;

    const wizardProps: InboxProcessingWizardProps = {
        t,
        isProcessing,
        processingTask,
        processingMode,
        onModeChange: setProcessingMode,
        processingStep,
        processingTitle,
        processingDescription,
        setProcessingTitle,
        setProcessingDescription,
        setIsProcessing,
        canGoBack: stepHistory.length > 0,
        onBack: goBack,
        handleRefineNext,
        handleSkip,
        handleNotActionable,
        handleLater,
        handleActionable,
        showDoneNowShortcut: twoMinuteEnabled && !twoMinuteFirst,
        showReferenceOption: referenceEnabled,
        handleProjectCheckNo,
        handleProjectCheckYes,
        handleTwoMinDone,
        handleTwoMinNo,
        handleDefer,
        handleDelegate,
        delegateWho,
        setDelegateWho,
        delegateFollowUp,
        setDelegateFollowUp,
        handleDelegateBack,
        handleSendDelegateRequest,
        handleConfirmWaiting,
        handleConfirmReference,
        selectedContexts,
        selectedTags,
        selectedEnergyLevel,
        setSelectedEnergyLevel,
        selectedAssignedTo,
        setSelectedAssignedTo,
        personOptions,
        selectedTimeEstimate,
        setSelectedTimeEstimate,
        timeEstimateOptions,
        showContextsField,
        showTagsField,
        showEnergyLevelField,
        showAssignedToField,
        showTimeEstimateField,
        showPriorityField,
        selectedPriority,
        setSelectedPriority,
        allContexts,
        allTags,
        customContext,
        setCustomContext,
        addCustomContext,
        customTag,
        setCustomTag,
        addCustomTag,
        toggleContext,
        toggleTag,
        suggestedContexts,
        suggestedTags,
        handleConfirmContexts,
        convertToProject,
        setConvertToProject,
        setProjectTitleDraft,
        setNextActionDraft,
        projectTitleDraft,
        nextActionDraft,
        extraActionDrafts,
        setExtraActionDrafts,
        handleConvertToProject,
        projectSearch,
        setProjectSearch,
        projects,
        areas: activeAreas,
        filteredProjects,
        addProject,
        handleSetProject,
        hasExactProjectMatch,
        areaById,
        remainingCount: remainingInboxCount,
        showProjectInRefine: projectFirst && showProjectStep,
        selectedProjectId,
        setSelectedProjectId,
        selectedAreaId,
        setSelectedAreaId: handleSetSelectedAreaId,
        showProjectField,
        showAreaField,
        showScheduleFields,
        scheduleFields,
        visibleScheduleFieldKeys,
    };

    return {
        inboxCount,
        quickPanelProps,
        showStartButton,
        startProcessing,
        wizardProps,
    };
}
