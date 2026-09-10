import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent } from 'react';
import {
    executeCaptureTransaction,
    prepareCaptureTask,
    canStarNewCapture,
    shallow,
    useTaskStore,
    buildTaskUpdatesFromSpeechResult,
    flushPendingSave,
    findSelectableProjectByTitleAndArea,
    getQuickAddProjectInitialProps,
    getPersonOptionNames,
    isNaturalLanguageDatesEnabled,
    parseQuickAdd,
    normalizeClockTimeInput,
    normalizeFocusTaskLimit,
    getDefaultTaskAreaMode,
    resolveDefaultNewTaskAreaId,
    AREA_FILTER_ALL,
    AREA_FILTER_NONE,
    resolveAreaFilter,
    safeFormatDate,
    generateUUID,
    splitQuickAddBulkLines,
    DEFAULT_PROJECT_COLOR,
    formatFocusTaskLimitText,
    tFallback,
    type Area,
    type Attachment,
    type Project,
    type QuickAddResult,
    type Task,
} from '@mindwtr/core';
import { mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { getManagedPath } from '../lib/managed-paths';
import { useLanguage } from '../contexts/language-context';
import { cn } from '../lib/utils';
import { isFlatpakRuntime, isTauriRuntime } from '../lib/runtime';
import { reportError } from '../lib/report-error';
import { logWarn } from '../lib/app-log';
import { createDesktopRecoverySnapshot } from '../lib/data-transfer';
import { encodeWav, resampleAudio } from '../lib/audio-utils';
import { appendAudioChunkWithLimit, getMaxAudioSamples, MAX_AUDIO_RECORDING_SECONDS } from '../lib/audio-capture-buffer';
import { getPreferredDesktopAudioCaptureBackend } from '../lib/audio-capture-backend';
import { processAudioCapture, resolveSpeechCapture, type SpeechToTextResult } from '../lib/speech-to-text';
import { dispatchNavigateEvent } from '../lib/navigation-events';
import { ModalPortal } from './ModalPortal';
import { useUiStore } from '../store/ui-store';
import {
    QUICK_ADD_NATIVE_TARGET_MAIN,
    QUICK_ADD_NATIVE_TARGET_WINDOW,
    shouldHandleQuickAddNativeEvent,
} from '../lib/quick-add-native-event';
import { QUICK_ADD_MAIN_WINDOW_LABEL, QUICK_ADD_SAVED_EVENT } from '../lib/quick-add-saved-event';
import { TaskInput } from './Task/TaskInput';
import { CaptureContentFields } from './Task/CaptureContentFields';
import { AreaSelector } from './ui/AreaSelector';
import { QuickAddSyntaxHint } from './ui/QuickAddSyntaxHint';
import { FocusStarIcon } from './FocusStarIcon';

// Relative to the managed data dir (portable-aware, #855).
const AUDIO_CAPTURE_DIR = 'audio-captures';
const QUICK_ADD_IMAGE_CAPTURE_DIR = 'quick-add-images';
const TARGET_SAMPLE_RATE = 16_000;

type PastedImageAttachment = {
    attachment: Attachment;
    path: string;
};

type QuickAddModalProps = {
    standaloneWindow?: boolean;
};

type QuickAddOpenDetail = {
    expandContent?: boolean;
    initialProps?: Partial<Task>;
    initialValue?: string;
    captureMode?: 'text' | 'audio';
};

type ParsedQuickAddTask = {
    input: string;
    parsed: QuickAddResult;
};

function getClipboardImageFiles(data: DataTransfer | null): File[] {
    if (!data) return [];
    const files: File[] = [];
    for (const item of Array.from(data.items ?? [])) {
        if (item.kind !== 'file' || !item.type.toLowerCase().startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
    }
    for (const file of Array.from(data.files ?? [])) {
        if (!file.type.toLowerCase().startsWith('image/')) continue;
        if (files.includes(file)) continue;
        files.push(file);
    }
    return files;
}

function getImageExtension(file: File): string {
    const mime = file.type.toLowerCase();
    if (mime === 'image/png') return 'png';
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    if (mime === 'image/bmp') return 'bmp';
    if (mime === 'image/svg+xml') return 'svg';
    if (mime === 'image/heic') return 'heic';
    if (mime === 'image/heif') return 'heif';
    const nameMatch = file.name.match(/\.([a-z0-9]{2,5})$/i);
    if (nameMatch?.[1]) return nameMatch[1].toLowerCase() === 'jpeg' ? 'jpg' : nameMatch[1].toLowerCase();
    return 'png';
}

const IS_MAC_PLATFORM = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
const SAVE_AND_EDIT_SHORTCUT_HINT = IS_MAC_PLATFORM ? '⌘Enter' : 'Ctrl+Enter';
const SAVE_SHORTCUT_HINT = IS_MAC_PLATFORM ? 'Enter · ⇧Enter' : 'Enter · Shift+Enter';

function mergeQuickAddAttachments(...groups: Array<Attachment[] | undefined>): Attachment[] | undefined {
    const attachments = groups.flatMap((group) => group ?? []);
    return attachments.length > 0 ? attachments : undefined;
}

async function readClipboardFileBytes(file: File): Promise<Uint8Array> {
    if (typeof file.arrayBuffer === 'function') {
        return new Uint8Array(await file.arrayBuffer());
    }
    return new Uint8Array(await new Response(file).arrayBuffer());
}

async function readTextFile(file: File): Promise<string> {
    if (typeof file.text === 'function') {
        return file.text();
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
        reader.readAsText(file);
    });
}

export function QuickAddModal({ standaloneWindow = false }: QuickAddModalProps) {
    const getDerivedState = useTaskStore((state) => state.getDerivedState);
    const { addTask, addTasks, addProject, projects, areas, settings, setHighlightTask } = useTaskStore(
        (state) => ({
            addTask: state.addTask,
            addTasks: state.addTasks,
            addProject: state.addProject,
            projects: state.projects,
            areas: state.areas,
            settings: state.settings,
            setHighlightTask: state.setHighlightTask,
        }),
        shallow
    );
    const setProjectView = useUiStore((state) => state.setProjectView);
    const setEditingTaskId = useUiStore((state) => state.setEditingTaskId);
    const showToast = useUiStore((state) => state.showToast);
    const derivedState = getDerivedState();
    const { allContexts, allTags } = derivedState;
    const suggestionTokens = useMemo(
        () => Array.from(new Set([...allContexts, ...allTags])).sort(),
        [allContexts, allTags]
    );
    const { t } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const [value, setValue] = useState('');
    const [contentOpen, setContentOpen] = useState(false);
    const [contentDraft, setContentDraft] = useState<Partial<Pick<Task, 'description' | 'checklist'>>>({});
    const updateContentDraft = useCallback((patch: Partial<Pick<Task, 'description' | 'checklist'>>) => {
        setContentDraft((current) => ({ ...current, ...patch }));
    }, []);
    const [selectedAreaId, setSelectedAreaId] = useState('');
    const [initialProps, setInitialProps] = useState<Partial<Task> | null>(null);
    const [focusNewTask, setFocusNewTask] = useState(false);
    const [forcedCaptureMode, setForcedCaptureMode] = useState<'text' | 'audio' | null>(null);
    const [captureMode, setCaptureMode] = useState<'text' | 'audio'>(
        settings?.gtd?.defaultCaptureMethod === 'audio' ? 'audio' : 'text'
    );
    const [isRecording, setIsRecording] = useState(false);
    const [recordingBusy, setRecordingBusy] = useState(false);
    const [recordingError, setRecordingError] = useState<string | null>(null);
    const [recordingBackend, setRecordingBackend] = useState<'web' | 'native' | null>(null);
    const [pastedImageAttachments, setPastedImageAttachments] = useState<PastedImageAttachment[]>([]);
    const [pastedImageError, setPastedImageError] = useState<string | null>(null);
    const [pastingImageCount, setPastingImageCount] = useState(0);
    const [bulkQuickAddLines, setBulkQuickAddLines] = useState<string[] | null>(null);
    const [bulkQuickAddError, setBulkQuickAddError] = useState<string | null>(null);
    const lastActiveElementRef = useRef<HTMLElement | null>(null);
    const modalRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const audioChunksRef = useRef<Float32Array[]>([]);
    const audioSampleCountRef = useRef(0);
    const audioDurationLimitHitRef = useRef(false);
    const inputSampleRateRef = useRef<number>(16_000);
    const isOpenRef = useRef(false);
    const openRequestInFlightRef = useRef(false);
    const standaloneDataRefreshRef = useRef<Promise<void> | null>(null);
    const pastedImageAttachmentsRef = useRef<PastedImageAttachment[]>([]);
    const sortedAreas = useMemo(() => [...areas].filter((area) => !area.deletedAt).sort((a, b) => a.order - b.order), [areas]);
    const defaultAreaMode = getDefaultTaskAreaMode(settings);
    const resolvedAreaFilter = useMemo(
        () => resolveAreaFilter(settings?.filters?.areaId, sortedAreas),
        [settings?.filters?.areaId, sortedAreas],
    );
    const activeAreaId = resolvedAreaFilter !== AREA_FILTER_ALL && resolvedAreaFilter !== AREA_FILTER_NONE
        ? resolvedAreaFilter
        : undefined;
    const defaultAreaId = defaultAreaMode === 'active'
        ? activeAreaId ?? ''
        : resolveDefaultNewTaskAreaId(settings, sortedAreas) ?? '';
    // Read lazily on each open: the modal does not subscribe to tasks/people.
    const personOptionNames = useMemo(() => {
        if (!isOpen) return [];
        const { people, tasks } = useTaskStore.getState();
        return getPersonOptionNames(people, tasks);
    }, [isOpen]);
    const quickAddParseOptions = useMemo(
        () => ({
            knownContexts: allContexts,
            knownTags: allTags,
            knownPeople: personOptionNames,
            defaultScheduleTime: normalizeClockTimeInput(settings.gtd?.defaultScheduleTime) || undefined,
            preserveText: settings.quickAddAutoClean !== true,
            naturalLanguageDates: isNaturalLanguageDatesEnabled(settings),
        }),
        [allContexts, allTags, personOptionNames, settings.gtd?.defaultScheduleTime, settings.quickAddAutoClean, settings.gtd?.naturalLanguageDates],
    );
    const parsedInput = useMemo(
        () => parseQuickAdd(value, projects, new Date(), areas, quickAddParseOptions),
        [value, projects, areas, quickAddParseOptions],
    );
    const hasProjectOverride = Boolean(initialProps?.projectId || parsedInput.props.projectId || parsedInput.projectTitle);
    const showAreaSelector = !hasProjectOverride;
    const isPastingImage = pastingImageCount > 0;
    const pastedAttachments = useMemo(
        () => pastedImageAttachments.map((item) => item.attachment),
        [pastedImageAttachments],
    );
    const focusTaskLimit = normalizeFocusTaskLimit(settings?.gtd?.focusTaskLimit);
    const canFocusNewTask = focusNewTask || canStarNewCapture({ focusedCount: derivedState.focusedCount, focusTaskLimit });
    const focusDisabled = !focusNewTask && !canFocusNewTask;
    const addFocusLabel = tFallback(t, 'agenda.addToFocus', "Add to today's focus");
    const removeFocusLabel = tFallback(t, 'agenda.removeFromFocus', 'Remove from focus');
    const focusLimitLabel = formatFocusTaskLimitText(
        tFallback(t, 'agenda.maxFocusItems', 'Max {{count}} focus items'),
        focusTaskLimit,
    );
    const focusLabel = focusNewTask
        ? removeFocusLabel
        : (focusDisabled ? focusLimitLabel : addFocusLabel);

    useEffect(() => {
        pastedImageAttachmentsRef.current = pastedImageAttachments;
    }, [pastedImageAttachments]);

    const cleanupPastedImageAttachments = useCallback((attachments: PastedImageAttachment[]) => {
        attachments.forEach(({ path }) => {
            remove(path).catch((error) => {
                void logWarn('Pasted image cleanup failed', {
                    scope: 'attachment',
                    extra: { error: error instanceof Error ? error.message : String(error) },
                });
            });
        });
    }, []);

    const resetPastedImageAttachments = useCallback((cleanup: boolean) => {
        const current = pastedImageAttachmentsRef.current;
        if (cleanup && current.length > 0) {
            cleanupPastedImageAttachments(current);
        }
        pastedImageAttachmentsRef.current = [];
        setPastedImageAttachments([]);
        setPastedImageError(null);
        setPastingImageCount(0);
    }, [cleanupPastedImageAttachments]);

    useEffect(() => () => {
        cleanupPastedImageAttachments(pastedImageAttachmentsRef.current);
        pastedImageAttachmentsRef.current = [];
    }, [cleanupPastedImageAttachments]);

    const refreshStandaloneData = useCallback(async () => {
        if (!standaloneWindow) return;
        if (!standaloneDataRefreshRef.current) {
            standaloneDataRefreshRef.current = useTaskStore.getState()
                .fetchData({ silent: true })
                .finally(() => {
                    standaloneDataRefreshRef.current = null;
                });
        }
        await standaloneDataRefreshRef.current;
    }, [standaloneWindow]);

    useEffect(() => {
        isOpenRef.current = isOpen;
        if (!isOpen) {
            openRequestInFlightRef.current = false;
        }
    }, [isOpen]);

    const openQuickAdd = useCallback(async (detail?: QuickAddOpenDetail) => {
        if (isOpenRef.current || openRequestInFlightRef.current) return false;
        openRequestInFlightRef.current = true;
        try {
            setInitialProps(detail?.initialProps ?? null);
            setFocusNewTask(Boolean(detail?.initialProps?.isFocusedToday));
            setValue(detail?.initialValue ?? '');
            setContentDraft({});
            setContentOpen(Boolean(detail?.expandContent || detail?.initialProps?.description || detail?.initialProps?.checklist?.length));
            setForcedCaptureMode(detail?.captureMode ?? null);
            setBulkQuickAddLines(null);
            setBulkQuickAddError(null);
            resetPastedImageAttachments(true);
            isOpenRef.current = true;
            setIsOpen(true);
            if (standaloneWindow) {
                void refreshStandaloneData().catch((error) => reportError('Failed to refresh quick add data', error));
            }
            return true;
        } catch (error) {
            openRequestInFlightRef.current = false;
            throw error;
        }
    }, [refreshStandaloneData]);

    useEffect(() => {
        if (!isTauriRuntime()) return;

        let unlisten: (() => void) | undefined;
        const nativeTarget = standaloneWindow ? QUICK_ADD_NATIVE_TARGET_WINDOW : QUICK_ADD_NATIVE_TARGET_MAIN;
        const openFromTauri = async () => {
            await openQuickAdd();
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke<boolean>('consume_quick_add_pending', { target: nativeTarget });
            } catch (e) {
                reportError('Failed to open quick add', e);
            }
        };

        const setup = async () => {
            const [{ listen }, { invoke }] = await Promise.all([
                import('@tauri-apps/api/event'),
                import('@tauri-apps/api/core'),
            ]);

            unlisten = await listen('quick-add', (event) => {
                if (!shouldHandleQuickAddNativeEvent(event.payload, nativeTarget)) return;
                openFromTauri().catch((error) => reportError('Failed to open quick add', error));
            });

            const pending = await invoke<boolean>('consume_quick_add_pending', { target: nativeTarget });
            if (pending) {
                await openQuickAdd();
            }
        };

        setup().catch((error) => reportError('Failed to initialize quick add', error));

        return () => {
            if (unlisten) unlisten();
        };
    }, [openQuickAdd, standaloneWindow]);

    useEffect(() => {
        const handler: EventListener = (event) => {
            const detail = (event as CustomEvent<QuickAddOpenDetail>).detail;
            openQuickAdd(detail).catch((error) => reportError('Failed to open quick add', error));
        };
        window.addEventListener('mindwtr:quick-add', handler);
        return () => window.removeEventListener('mindwtr:quick-add', handler);
    }, [openQuickAdd]);

    useEffect(() => {
        if (!isOpen) return;
        lastActiveElementRef.current = document.activeElement as HTMLElement | null;
        if (!value) setValue('');
    }, [isOpen, value]);

    useEffect(() => {
        if (!isOpen) return;
        const nextArea = initialProps?.areaId ?? (initialProps?.projectId ? '' : defaultAreaId);
        setSelectedAreaId(nextArea ?? '');
    }, [defaultAreaId, initialProps?.areaId, initialProps?.projectId, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        if (parsedInput.props.areaId) {
            setSelectedAreaId(parsedInput.props.areaId);
        }
    }, [isOpen, parsedInput.props.areaId]);


    useEffect(() => {
        if (!isOpen) return;
        const nextMode = forcedCaptureMode ?? (settings?.gtd?.defaultCaptureMethod === 'audio' ? 'audio' : 'text');
        setCaptureMode(nextMode);
        setRecordingError(null);
    }, [forcedCaptureMode, isOpen, settings?.gtd?.defaultCaptureMethod]);

    const applySpeechResult = useCallback(async (taskId: string, result: SpeechToTextResult) => {
        const {
            tasks: currentTasks,
            projects: currentProjects,
            addProject: addProjectNow,
            updateTask: updateTaskNow,
            settings: currentSettings,
        } = useTaskStore.getState();
        const existing = currentTasks.find((task) => task.id === taskId);
        if (!existing) return;

        const { updates, suggestedProjectTitle } = buildTaskUpdatesFromSpeechResult(existing, result, currentSettings);
        if (suggestedProjectTitle && !existing.projectId) {
            const targetAreaId = updates.areaId ?? existing.areaId;
            const match = findSelectableProjectByTitleAndArea(currentProjects, suggestedProjectTitle, targetAreaId);
            if (match) {
                updates.projectId = match.id;
            } else {
                const created = await addProjectNow(
                    suggestedProjectTitle,
                    DEFAULT_PROJECT_COLOR,
                    targetAreaId ? { areaId: targetAreaId } : undefined
                );
                if (!created) return;
                updates.projectId = created.id;
            }
        }

        if (Object.keys(updates).length) {
            await updateTaskNow(taskId, updates);
        }
    }, []);

    const hideStandaloneWindow = useCallback(() => {
        if (!standaloneWindow || !isTauriRuntime()) return;
        import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke('hide_quick_add_window'))
            .catch((error) => reportError('Failed to hide quick add window', error));
    }, [standaloneWindow]);

    const notifyStandaloneTaskSaved = useCallback(async () => {
        if (!standaloneWindow || !isTauriRuntime()) return;
        try {
            const { emitTo } = await import('@tauri-apps/api/event');
            await emitTo(QUICK_ADD_MAIN_WINDOW_LABEL, QUICK_ADD_SAVED_EVENT, { savedAt: new Date().toISOString() });
        } catch (error) {
            reportError('Failed to notify main window after quick add save', error);
        }
    }, [standaloneWindow]);

    const close = useCallback((options?: { keepPastedImages?: boolean }) => {
        isOpenRef.current = false;
        openRequestInFlightRef.current = false;
        setIsOpen(false);
        setInitialProps(null);
        setFocusNewTask(false);
        setValue('');
        setContentDraft({});
        setContentOpen(false);
        setSelectedAreaId('');
        setForcedCaptureMode(null);
        setBulkQuickAddLines(null);
        setBulkQuickAddError(null);
        resetPastedImageAttachments(!options?.keepPastedImages);
        lastActiveElementRef.current?.focus();
        hideStandaloneWindow();
    }, [hideStandaloneWindow, resetPastedImageAttachments]);

    const createPastedImageAttachment = useCallback(async (file: File): Promise<PastedImageAttachment> => {
        const now = new Date();
        const nowIso = now.toISOString();
        const displayTitle = `${tFallback(t, 'quickAdd.pastedImageTitle', 'Screenshot')} ${safeFormatDate(now, 'Pp')}`;
        const fileName = `mindwtr-paste-${safeFormatDate(now, 'yyyyMMdd-HHmmss')}-${generateUUID().slice(0, 8)}.${getImageExtension(file)}`;
        const captureDir = await getManagedPath(QUICK_ADD_IMAGE_CAPTURE_DIR);
        await mkdir(captureDir, { recursive: true });
        const bytes = await readClipboardFileBytes(file);
        const absolutePath = await join(captureDir, fileName);
        await writeFile(absolutePath, bytes);
        return {
            path: absolutePath,
            attachment: {
                id: generateUUID(),
                kind: 'file',
                title: displayTitle,
                uri: absolutePath,
                mimeType: file.type || `image/${getImageExtension(file)}`,
                size: file.size,
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        };
    }, [t]);

    const handleQuickAddPaste = useCallback((event: ClipboardEvent<HTMLInputElement>) => {
        const imageFiles = getClipboardImageFiles(event.clipboardData);
        if (imageFiles.length > 0) {
            event.preventDefault();
            setPastedImageError(null);
            imageFiles.forEach((file) => {
                setPastingImageCount((count) => count + 1);
                void createPastedImageAttachment(file)
                    .then((pastedAttachment) => {
                        if (!isOpenRef.current) {
                            cleanupPastedImageAttachments([pastedAttachment]);
                            return;
                        }
                        setPastedImageAttachments((current) => {
                            const next = [...current, pastedAttachment];
                            pastedImageAttachmentsRef.current = next;
                            return next;
                        });
                    })
                    .catch((error) => {
                        reportError('Failed to attach pasted image', error);
                        setPastedImageError(tFallback(t, 'quickAdd.pastedImageError', 'Could not attach pasted image.'));
                    })
                    .finally(() => {
                        setPastingImageCount((count) => Math.max(0, count - 1));
                    });
            });
            return;
        }

        const pastedText = event.clipboardData?.getData('text/plain') ?? '';
        const lines = splitQuickAddBulkLines(pastedText);
        if (lines.length <= 1) {
            if (lines.length === 1 && /[\r\n]/.test(pastedText)) {
                event.preventDefault();
                const input = event.currentTarget;
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? start;
                setValue(`${input.value.slice(0, start)}${lines[0]}${input.value.slice(end)}`);
            }
            return;
        }
        event.preventDefault();
        setBulkQuickAddLines(lines);
        setBulkQuickAddError(null);
    }, [cleanupPastedImageAttachments, createPastedImageAttachment, t]);

    const handleTextFileImport = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
            const text = await readTextFile(file);
            const lines = splitQuickAddBulkLines(text);
            setBulkQuickAddError(null);
            if (lines.length > 1) {
                setBulkQuickAddLines(lines);
            } else if (lines.length === 1) {
                setValue(lines[0]);
            }
        } catch (error) {
            reportError('Failed to import quick add text file', error);
            setBulkQuickAddError(tFallback(t, 'quickAdd.bulkImportError', 'Could not read that text file.'));
        }
    }, [t]);

    const startRecording = useCallback(async () => {
        if (recordingBusy || isRecording) return;
        setRecordingError(null);
        // Voice capture is speech-to-text: if no model/key is configured, transcription
        // can never run, so guard before showing the recording indicator. Keep the dialog
        // open and point the user at Settings instead of silently aborting (#886).
        // This must derive from the same resolveSpeechCapture call the transcribe gate
        // below uses, or the two can silently disagree.
        const { ready: speechConfigured } = await resolveSpeechCapture(settings.ai);
        if (!speechConfigured) {
            showToast(
                tFallback(t, 'quickAdd.speechNotConfigured', 'Enable a speech-to-text model in Settings to use voice input.'),
                'info',
                5000,
            );
            return;
        }
        try {
            const preferredBackend = getPreferredDesktopAudioCaptureBackend({
                isTauriRuntime: isTauriRuntime(),
                isFlatpakRuntime: isFlatpakRuntime(),
            });

            if (preferredBackend === 'native') {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    await invoke('start_audio_recording');
                    setRecordingBackend('native');
                    setIsRecording(true);
                    return;
                } catch (error) {
                    void logWarn('Native audio recording failed, falling back to web capture', {
                        scope: 'audio',
                        extra: {
                            error: error instanceof Error ? error.message : String(error),
                            preferredBackend,
                        },
                    });
                }
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                setRecordingError(t('quickAdd.audioErrorBody'));
                return;
            }
            if (navigator.mediaDevices.enumerateDevices) {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const hasInput = devices.some((device) => device.kind === 'audioinput');
                if (!hasInput) {
                    setRecordingError(`${t('quickAdd.audioErrorBody')} (No microphone detected)`);
                    return;
                }
            }
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const AudioContextConstructor =
                window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AudioContextConstructor) {
                throw new Error('AudioContext unavailable');
            }
            const context = new AudioContextConstructor();
            await context.resume();
            const source = context.createMediaStreamSource(stream);
            const processor = context.createScriptProcessor(4096, 1, 1);
            const zeroGain = context.createGain();
            zeroGain.gain.value = 0;
            audioChunksRef.current = [];
            audioSampleCountRef.current = 0;
            audioDurationLimitHitRef.current = false;
            inputSampleRateRef.current = context.sampleRate;
            processor.onaudioprocess = (event) => {
                if (audioDurationLimitHitRef.current) return;
                const channel = event.inputBuffer.getChannelData(0);
                const result = appendAudioChunkWithLimit({
                    chunks: audioChunksRef.current,
                    chunk: channel,
                    maxSamples: getMaxAudioSamples(inputSampleRateRef.current),
                    sampleCount: audioSampleCountRef.current,
                });
                audioSampleCountRef.current = result.sampleCount;
                audioDurationLimitHitRef.current = result.limitHit;
            };
            source.connect(processor);
            processor.connect(zeroGain);
            zeroGain.connect(context.destination);
            audioContextRef.current = context;
            audioStreamRef.current = stream;
            audioSourceRef.current = source;
            audioProcessorRef.current = processor;
            setRecordingBackend('web');
            setIsRecording(true);
        } catch (error) {
            reportError('Audio recording failed', error);
            const message = error instanceof Error ? error.message : String(error);
            setRecordingError(`${t('quickAdd.audioErrorBody')} (${message})`);
        }
    }, [isRecording, recordingBusy, settings.ai, showToast, t]);

    const stopRecording = useCallback(async ({ saveTask }: { saveTask: boolean }) => {
        if (recordingBusy) return;
        if (!isRecording) return;
        setRecordingBusy(true);
        setIsRecording(false);
        try {
            type NativeResult = {
                path: string;
                sampleRate: number;
                channels: number;
                size: number;
            };

            let wavBytes: Uint8Array | null = null;
            let fileName: string;
            let absolutePath: string;
            let audioByteSize: number | undefined;

            const now = new Date();
            if (recordingBackend === 'native' && isTauriRuntime()) {
                const { invoke } = await import('@tauri-apps/api/core');
                const result = await invoke<NativeResult>('stop_audio_recording');
                absolutePath = result.path;
                const parts = absolutePath.split(/[\\/]/);
                fileName = parts[parts.length - 1] || 'mindwtr-audio.wav';
                audioByteSize = result.size;
            } else {
                const currentAudioContext = audioContextRef.current;
                if (currentAudioContext?.state === 'running') {
                    // Suspending the graph gives ScriptProcessorNode one stable stop point before teardown.
                    await currentAudioContext.suspend();
                }
                audioProcessorRef.current?.disconnect();
                audioSourceRef.current?.disconnect();
                audioProcessorRef.current = null;
                audioSourceRef.current = null;
                audioStreamRef.current?.getTracks().forEach((track) => track.stop());
                audioStreamRef.current = null;
                if (currentAudioContext && currentAudioContext.state !== 'closed') {
                    await currentAudioContext.close();
                }
                audioContextRef.current = null;

                const chunks = audioChunksRef.current;
                audioChunksRef.current = [];
                audioSampleCountRef.current = 0;
                audioDurationLimitHitRef.current = false;
                if (!saveTask) return;
                if (!chunks.length) {
                    throw new Error('No audio data captured');
                }

                const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const buffer = new Float32Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                    buffer.set(chunk, offset);
                    offset += chunk.length;
                }
                const resampled = resampleAudio(buffer, inputSampleRateRef.current, TARGET_SAMPLE_RATE);
                wavBytes = encodeWav(resampled, TARGET_SAMPLE_RATE);
                audioByteSize = wavBytes.length;

                const timestamp = safeFormatDate(now, 'yyyyMMdd-HHmmss');
                fileName = `mindwtr-audio-${timestamp}.wav`;
                const audioCaptureDir = await getManagedPath(AUDIO_CAPTURE_DIR);
                await mkdir(audioCaptureDir, { recursive: true });
                absolutePath = await join(audioCaptureDir, fileName);
                await writeFile(absolutePath, wavBytes);
            }

            if (!saveTask) {
                remove(absolutePath).catch((error) => {
                    void logWarn('Audio cleanup failed', {
                        scope: 'audio',
                        extra: { error: error instanceof Error ? error.message : String(error) },
                    });
                });
                return;
            }

            const nowIso = now.toISOString();
            const displayTitle = `${t('quickAdd.audioNoteTitle')} ${safeFormatDate(now, 'Pp')}`;
            const { ready: speechReady, config: speechConfig } = await resolveSpeechCapture(settings.ai);
            const saveAudioAttachments = settings.gtd?.saveAudioAttachments !== false || !speechReady;

            const attachment: Attachment | null = saveAudioAttachments
                ? {
                    id: generateUUID(),
                    kind: 'file',
                    title: displayTitle,
                    uri: absolutePath,
                    mimeType: 'audio/wav',
                    size: audioByteSize,
                    createdAt: nowIso,
                    updatedAt: nowIso,
                }
                : null;

            const attachments = [...(initialProps?.attachments ?? [])];
            if (attachment) attachments.push(attachment);
            const props: Partial<Task> = {
                status: 'inbox',
                ...initialProps,
                attachments,
            };
            if (!props.status) props.status = 'inbox';

            if (standaloneWindow) {
                await refreshStandaloneData().catch((error) => reportError('Failed to refresh quick add data', error));
            }
            const addTaskResult = await addTask(displayTitle, props);
            if (addTaskResult.success && standaloneWindow) {
                await flushPendingSave().catch((error) => reportError('Failed to save quick add task', error));
                await notifyStandaloneTaskSaved();
            }
            close();

            if (!addTaskResult.success || !addTaskResult.id) return;
            const taskId = addTaskResult.id;

            const runSpeech = async (bytes: Uint8Array) => {
                const timeZone = typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function'
                    ? Intl.DateTimeFormat().resolvedOptions().timeZone
                    : undefined;
                void processAudioCapture(
                    { bytes, mimeType: 'audio/wav', name: fileName, path: absolutePath },
                    {
                        ...speechConfig,
                        now: new Date(),
                        timeZone,
                    }
                )
                    .then((result) => applySpeechResult(taskId, result))
                    .catch((error) => void logWarn('Speech-to-text failed', {
                        scope: 'audio',
                        extra: { error: error instanceof Error ? error.message : String(error) },
                    }))
                    .finally(() => {
                        if (!saveAudioAttachments) {
                            remove(absolutePath).catch((error) => {
                                void logWarn('Audio cleanup failed', {
                                    scope: 'audio',
                                    extra: { error: error instanceof Error ? error.message : String(error) },
                                });
                            });
                        }
                    });
            };

            if (speechReady) {
                if (wavBytes) {
                    void runSpeech(wavBytes);
                } else {
                    void readFile(absolutePath)
                        .then((bytes) => (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)))
                        .then((bytes) => runSpeech(bytes))
                        .catch((error) => {
                            void logWarn('Failed to load audio for transcription', {
                                scope: 'audio',
                                extra: { error: error instanceof Error ? error.message : String(error) },
                            });
                            if (!saveAudioAttachments) {
                                remove(absolutePath).catch((cleanupError) => {
                                    void logWarn('Audio cleanup failed', {
                                        scope: 'audio',
                                        extra: {
                                            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
                                        },
                                    });
                                });
                            }
                        });
                }
            } else if (!saveAudioAttachments) {
                remove(absolutePath).catch((error) => {
                    void logWarn('Audio cleanup failed', {
                        scope: 'audio',
                        extra: { error: error instanceof Error ? error.message : String(error) },
                    });
                });
            }
        } catch (error) {
            reportError('Failed to save recording', error);
            const message = error instanceof Error ? error.message : String(error);
            setRecordingError(`${t('quickAdd.audioErrorBody')} (${message})`);
        } finally {
            setRecordingBusy(false);
            setRecordingBackend(null);
        }
    }, [
        addTask,
        applySpeechResult,
        close,
        initialProps,
        isRecording,
        recordingBusy,
        recordingBackend,
        refreshStandaloneData,
        notifyStandaloneTaskSaved,
        standaloneWindow,
        settings.ai,
        settings.gtd?.saveAudioAttachments,
        t,
    ]);

    useEffect(() => {
        if (!isRecording) return undefined;
        const timeout = window.setTimeout(() => {
            void stopRecording({ saveTask: true });
        }, MAX_AUDIO_RECORDING_SECONDS * 1000);
        return () => window.clearTimeout(timeout);
    }, [isRecording, stopRecording]);

    const handleClose = () => {
        if (isRecording && !recordingBusy) {
            void stopRecording({ saveTask: false });
        }
        close();
    };

    const openCreatedTaskForEditing = useCallback((taskId: string, props: Partial<Task>) => {
        setHighlightTask(taskId);
        setEditingTaskId(taskId);
        if (props.projectId) {
            setProjectView({ selectedProjectId: props.projectId });
            dispatchNavigateEvent('projects');
            return;
        }
        switch (props.status) {
            case 'next':
                dispatchNavigateEvent('next');
                return;
            case 'waiting':
                dispatchNavigateEvent('waiting');
                return;
            case 'someday':
                dispatchNavigateEvent('someday');
                return;
            case 'reference':
                dispatchNavigateEvent('reference');
                return;
            case 'done':
                dispatchNavigateEvent('done');
                return;
            default:
                dispatchNavigateEvent('inbox');
        }
    }, [setEditingTaskId, setHighlightTask, setProjectView]);

    const buildQuickAddCaptureInput = useCallback(({
        currentProjects,
        extraAttachments,
        input,
        parsed,
    }: {
        currentProjects: Project[];
        extraAttachments?: Attachment[];
        input: string;
        parsed: QuickAddResult;
    }) => {
        const mergedAttachments = mergeQuickAddAttachments(
            initialProps?.attachments,
            parsed.props.attachments,
            extraAttachments,
        );
        return {
            parsed,
            rawInput: input,
            fallbackTitle: extraAttachments?.[0]?.title || tFallback(t, 'quickAdd.pastedImageTitle', 'Screenshot'),
            projects: currentProjects,
            initialProps: initialProps ?? undefined,
            extraProps: {
                ...(mergedAttachments ? { attachments: mergedAttachments } : {}),
                ...contentDraft,
                ...(contentDraft.checklist ? { checklist: contentDraft.checklist.filter((item) => item.title.trim()).map((item) => ({ ...item, title: item.title.trim() })) } : {}),
            },
            selectedAreaId,
            starNewTask: focusNewTask && canFocusNewTask,
        };
    }, [canFocusNewTask, contentDraft, focusNewTask, initialProps, selectedAreaId, t]);

    const createTaskFromParsedQuickAdd = useCallback(async ({
        currentAreas,
        currentProjects,
        extraAttachments,
        input,
        parsed,
    }: {
        currentAreas: Area[];
        currentProjects: Project[];
        extraAttachments?: Attachment[];
        input: string;
        parsed: QuickAddResult;
    }) => {
        const transaction = await executeCaptureTransaction(
            buildQuickAddCaptureInput({ currentProjects, extraAttachments, input, parsed }),
            { addProject, addTask },
        );
        const createdProject = 'createdProject' in transaction
            ? transaction.createdProject
            : undefined;
        const nextProjects = createdProject
            ? [...currentProjects, createdProject]
            : currentProjects;
        if (!transaction.success) {
            return { success: false, currentProjects: nextProjects, currentAreas };
        }
        return {
            success: true,
            createdTaskId: transaction.createdTaskId,
            props: transaction.props,
            currentAreas,
            currentProjects: nextProjects,
        };
    }, [addProject, addTask, buildQuickAddCaptureInput]);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            handleClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleClose, isOpen]);

    const saveTask = async ({ openAfterSave = false, addAnother = false }: { openAfterSave?: boolean; addAnother?: boolean } = {}) => {
        if (isPastingImage) return;
        const hasPastedAttachments = pastedAttachments.length > 0;
        if (!value.trim() && !hasPastedAttachments) return;
        let currentProjects = projects;
        let currentAreas = areas;
        if (standaloneWindow) {
            await refreshStandaloneData().catch((error) => reportError('Failed to refresh quick add data', error));
            const currentState = useTaskStore.getState();
            currentProjects = currentState.projects;
            currentAreas = currentState.areas;
        }
        const parsed = parseQuickAdd(value, currentProjects, new Date(), currentAreas, quickAddParseOptions);
        if (parsed.invalidDateCommands && parsed.invalidDateCommands.length > 0) {
            return;
        }
        const result = await createTaskFromParsedQuickAdd({
            currentAreas,
            currentProjects,
            extraAttachments: pastedAttachments,
            input: value,
            parsed,
        });
        if (!result.success) return;
        if (standaloneWindow) {
            await flushPendingSave().catch((error) => reportError('Failed to save quick add task', error));
            await notifyStandaloneTaskSaved();
        }
        if (addAnother) {
            // Shift+Enter batch capture: clear per-task state but keep the
            // dialog (and the picked area) for the next entry.
            setValue('');
            setContentDraft({});
            setFocusNewTask(false);
            setPastedImageError(null);
            resetPastedImageAttachments(false);
            return;
        }
        close({ keepPastedImages: true });
        if (openAfterSave && result.createdTaskId && result.props && !standaloneWindow) {
            openCreatedTaskForEditing(result.createdTaskId, result.props);
        } else if (initialProps?.projectId && result.createdTaskId) {
            // Opened from a project/section preset (ProjectWorkspace's add button):
            // flash + scroll the new row in the project view. Global captures with
            // no project preset intentionally skip this so they never leave a
            // stray highlight on an unrelated view (#916).
            setHighlightTask(result.createdTaskId);
        }
    };

    const confirmBulkQuickAdd = async () => {
        if (contentDraft.description?.trim() || contentDraft.checklist?.some((item) => item.title.trim())) {
            setBulkQuickAddError(tFallback(t, 'quickAdd.bulkWithContent', 'Cancel bulk capture and save this content as one task first.'));
            return;
        }
        if (!bulkQuickAddLines || bulkQuickAddLines.length === 0 || isPastingImage) return;
        try {
            await createDesktopRecoverySnapshot();
        } catch (error) {
            reportError('Failed to create a recovery snapshot before bulk quick add', error);
            setBulkQuickAddError(tFallback(t, 'quickAdd.bulkCreateError', 'Could not create all tasks.'));
            return;
        }
        let currentProjects = projects;
        let currentAreas = areas;
        if (standaloneWindow) {
            await refreshStandaloneData().catch((error) => reportError('Failed to refresh quick add data', error));
            const currentState = useTaskStore.getState();
            currentProjects = currentState.projects;
            currentAreas = currentState.areas;
        }
        const parsedItems: ParsedQuickAddTask[] = bulkQuickAddLines.map((line) => ({
            input: line,
            parsed: parseQuickAdd(line, currentProjects, new Date(), currentAreas, quickAddParseOptions),
        }));
        const invalid = parsedItems.find((item) => item.parsed.invalidDateCommands?.length);
        if (invalid?.parsed.invalidDateCommands?.length) {
            setBulkQuickAddError(
                `${tFallback(t, 'quickAdd.invalidDateCommand', 'Invalid date command')}: ${invalid.parsed.invalidDateCommands.join(', ')}`
            );
            return;
        }

        // One store write for the whole import, not one per line (#942): a
        // per-line loop left a half-imported inbox behind whenever any line
        // failed, and queued one full-data save snapshot per task. Mobile's
        // bulk capture already prepares then batches the same way.
        const bulkFailed = (detail?: string) => {
            const message = tFallback(t, 'quickAdd.bulkCreateError', 'Could not create all tasks.');
            setBulkQuickAddError(detail ? `${message} (${detail})` : message);
        };
        const taskInputs: Array<{ title: string; initialProps: Partial<Task> }> = [];
        for (const item of parsedItems) {
            const prepared = await prepareCaptureTask(
                buildQuickAddCaptureInput({ currentProjects, input: item.input, parsed: item.parsed }),
                { addProject },
            );
            if (!prepared.success) {
                reportError('Failed to prepare a bulk quick add task', prepared.reason);
                bulkFailed(prepared.reason);
                return;
            }
            taskInputs.push({ title: prepared.title, initialProps: prepared.props });
            if (prepared.createdProject) currentProjects = [...currentProjects, prepared.createdProject];
        }
        const bulkResult = await addTasks(taskInputs);
        if (!bulkResult.success) {
            reportError('Failed to create bulk quick add tasks', bulkResult.error);
            bulkFailed(bulkResult.error);
            return;
        }

        if (standaloneWindow) {
            await flushPendingSave().catch((error) => reportError('Failed to save quick add tasks', error));
            await notifyStandaloneTaskSaved();
        }
        setBulkQuickAddLines(null);
        setBulkQuickAddError(null);
        close({ keepPastedImages: true });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await saveTask();
    };

    const scheduledLabel = initialProps?.startTime
        ? safeFormatDate(initialProps.startTime, 'Pp')
        : null;
    const loadingLabel = tFallback(t, 'common.loading', 'Loading...');
    const audioButtonLabel = recordingBusy
        ? loadingLabel
        : isRecording
            ? t('quickAdd.audioStop')
            : t('quickAdd.audioRecord');
    const audioStatusLabel = recordingBusy
        ? tFallback(t, 'quickAdd.audioProcessing', 'Processing audio capture...')
        : isRecording
            ? t('quickAdd.audioRecording')
            : t('quickAdd.audioCaptureLabel');
    const pastedImageLabel = pastedImageAttachments.length === 1
        ? tFallback(t, 'quickAdd.pastedImageAttached', '1 image attached')
        : tFallback(t, 'quickAdd.pastedImagesAttached', `${pastedImageAttachments.length} images attached`);
    const saveDisabled = isPastingImage || (!value.trim() && pastedImageAttachments.length === 0);
    const bulkTaskCount = bulkQuickAddLines?.length ?? 0;
    const bulkConfirmTitle = tFallback(t, 'quickAdd.bulkConfirmTitle', 'Create {{count}} tasks?')
        .replace('{{count}}', String(bulkTaskCount));
    const bulkPreviewLines = bulkQuickAddLines?.slice(0, 8) ?? [];
    const bulkMoreCount = Math.max(0, bulkTaskCount - bulkPreviewLines.length);

    if (!isOpen) return null;

    return (
        <ModalPortal>
        {/* Backdrop stays out of the tab order: Escape closes via the window
            keydown listener, so no focusable wrapper is needed (#869). */}
        <div
            className={cn(
                'fixed inset-0 flex items-start justify-center z-50',
                standaloneWindow ? 'bg-popover' : 'bg-black/50 px-2 pt-[5dvh] sm:pt-[10dvh]',
            )}
            role="presentation"
            onClick={handleClose}
        >
            <div
                ref={modalRef}
                className={cn(
                    'w-full max-h-[90dvh] overflow-y-auto bg-popover text-popover-foreground flex flex-col',
                    standaloneWindow ? 'max-w-none' : 'max-w-lg rounded-xl border shadow-2xl'
                )}
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key !== 'Tab') return;
                    const container = modalRef.current;
                    if (!container) return;
                    const focusable = Array.from(
                        container.querySelectorAll<HTMLElement>(
                            'button, [href], input, select, textarea, summary, [tabindex]'
                        )
                    ).filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled') && !el.closest('[hidden]')
                        && (el.tagName === 'SUMMARY' || !el.closest('details:not([open])')));
                    if (focusable.length === 0) return;
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault();
                        first.focus();
                    } else if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault();
                        last.focus();
                    }
                }}
            >
                <div className="px-4 py-3 border-b flex items-center justify-between">
                    <h3 className="font-semibold">{t('nav.addTask')}</h3>
                    <button
                        onClick={handleClose}
                        tabIndex={-1}
                        aria-label={t('common.close')}
                        className="text-sm text-muted-foreground hover:text-foreground"
                    >
                        Esc
                    </button>
                </div>
                <div className="px-4 pt-4">
                    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
                        <button
                            type="button"
                            onClick={() => setCaptureMode('text')}
                            className={cn(
                                'px-3 py-1 text-xs rounded-md transition-colors',
                                captureMode === 'text' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {t('settings.captureDefaultText')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setCaptureMode('audio')}
                            className={cn(
                                'px-3 py-1 text-xs rounded-md transition-colors',
                                captureMode === 'audio' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {t('settings.captureDefaultAudio')}
                        </button>
                    </div>
                </div>
                {captureMode === 'text' ? (
                    <form onSubmit={handleSubmit} className="p-4 space-y-2">
                        <div className="relative">
                            <TaskInput
                                value={value}
                                autoFocus={captureMode === 'text'}
                                projects={projects}
                                contexts={suggestionTokens}
                                areas={areas}
                                people={personOptionNames}
                                onCreateProject={async (title) => {
                                    const created = await addProject(
                                        title,
                                        DEFAULT_PROJECT_COLOR,
                                        getQuickAddProjectInitialProps({}, selectedAreaId)
                                    );
                                    return created?.id ?? null;
                                }}
                                onChange={(next) => setValue(next)}
                                onPaste={handleQuickAddPaste}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        e.preventDefault();
                                        handleClose();
                                        return;
                                    }
                                    if (e.key !== 'Enter' || e.altKey) return;
                                    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
                                        e.preventDefault();
                                        if (!standaloneWindow) void saveTask({ openAfterSave: true });
                                        return;
                                    }
                                    if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
                                        e.preventDefault();
                                        void saveTask({ addAnother: true });
                                    }
                                }}
                                placeholder={t('nav.addTask')}
                                className={cn(
                                    "w-full rounded-lg border border-border bg-card py-3 pl-4 pr-12 shadow-sm transition-colors focus:border-transparent focus:ring-2 focus:ring-primary",
                                )}
                            />
                            {/* "Add to today's focus" star sits inside the field's right edge —
                                the browser-bookmark idiom, so it reads as "star this capture".
                                Label lives in the tooltip/aria-label; on = filled amber star,
                                matching focused tasks in lists. Tapping past the focus cap
                                explains the block via toast instead of a dead control. */}
                            <button
                                type="button"
                                onClick={() => {
                                    if (focusDisabled) {
                                        showToast(focusLimitLabel, 'info');
                                        return;
                                    }
                                    setFocusNewTask((current) => !current);
                                }}
                                className={cn(
                                    'absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    focusNewTask
                                        ? 'text-warning hover:bg-warning/15'
                                        : 'text-muted-foreground/70 hover:text-warning hover:bg-muted/60',
                                )}
                                aria-label={focusLabel}
                                aria-pressed={focusNewTask}
                                title={focusLabel}
                            >
                                <FocusStarIcon filled={focusNewTask} className="h-[18px] w-[18px]" />
                            </button>
                        </div>
                        <button type="button" aria-expanded={contentOpen} onClick={() => setContentOpen((open) => !open)}
                            className="min-h-11 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-primary">
                            {tFallback(t, 'quickAdd.contentAndSteps', 'Content and steps')}
                        </button>
                        <div hidden={!contentOpen}>
                            <CaptureContentFields t={t}
                                description={contentDraft.description ?? parsedInput.props.description ?? initialProps?.description ?? ''}
                                checklist={contentDraft.checklist ?? parsedInput.props.checklist ?? initialProps?.checklist}
                                onChange={updateContentDraft} />
                        </div>
                        {isPastingImage ? (
                            <p className="text-xs text-muted-foreground">
                                {tFallback(t, 'quickAdd.pastedImageSaving', 'Attaching image...')}
                            </p>
                        ) : null}
                        {pastedImageAttachments.length > 0 ? (
                            <p className="text-xs text-muted-foreground">{pastedImageLabel}</p>
                        ) : null}
                        {pastedImageError ? (
                            <p className="text-xs text-destructive">{pastedImageError}</p>
                        ) : null}
                        {bulkQuickAddError && !bulkQuickAddLines ? (
                            <p className="text-xs text-destructive">{bulkQuickAddError}</p>
                        ) : null}
                        {showAreaSelector && (
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground font-medium">{t('taskEdit.areaLabel')}</label>
                                <AreaSelector
                                    areas={sortedAreas}
                                    value={selectedAreaId}
                                    onChange={setSelectedAreaId}
                                    placeholder={t('taskEdit.noAreaOption')}
                                    noAreaLabel={t('taskEdit.noAreaOption')}
                                    searchPlaceholder={t('areas.search')}
                                    noMatchesLabel={t('common.noMatches')}
                                    createAreaLabel={t('areas.create')}
                                    className="w-full"
                                />
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground">{t('quickAdd.example')}</p>
                        <details className="text-xs text-muted-foreground">
                            <summary className="w-fit cursor-pointer whitespace-nowrap rounded-sm font-medium text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                                {t('quickAdd.syntaxHelp')}
                            </summary>
                            <p className="mt-2 leading-5">
                                <QuickAddSyntaxHint text={t('quickAdd.help')} />
                            </p>
                        </details>
                        {parsedInput.invalidDateCommands && parsedInput.invalidDateCommands.length > 0 ? (
                            <p className="text-xs text-destructive">
                                {t('quickAdd.invalidDateCommand')}: {parsedInput.invalidDateCommands.join(', ')}
                            </p>
                        ) : null}
                        {scheduledLabel && (
                            <p className="text-xs text-muted-foreground">
                                {t('calendar.scheduleAction')}: {scheduledLabel}
                            </p>
                        )}
                        <div className="flex justify-end gap-2 pt-1">
                            <input
                                ref={fileInputRef}
                                aria-label={tFallback(t, 'quickAdd.bulkImportTextFileLabel', 'Import text file')}
                                className="sr-only"
                                tabIndex={-1}
                                type="file"
                                accept=".txt,text/plain"
                                onChange={(event) => {
                                    void handleTextFileImport(event);
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="px-3 py-1.5 rounded-md text-sm border border-border bg-background hover:bg-muted/60"
                            >
                                {tFallback(t, 'quickAdd.bulkImportTextFile', 'Import .txt')}
                            </button>
                            <button
                                type="button"
                                onClick={handleClose}
                                className="px-3 py-1.5 rounded-md text-sm bg-muted hover:bg-muted/80"
                            >
                                {t('common.cancel')}
                            </button>
                            {!standaloneWindow && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void saveTask({ openAfterSave: true });
                                    }}
                                    title={SAVE_AND_EDIT_SHORTCUT_HINT}
                                    disabled={saveDisabled}
                                    className={cn(
                                        'px-3 py-1.5 rounded-md text-sm border border-border bg-background hover:bg-muted/60',
                                        saveDisabled && 'opacity-50 cursor-not-allowed hover:bg-background',
                                    )}
                                >
                                    {t('quickAdd.saveAndEdit')}
                                </button>
                            )}
                            <button
                                type="submit"
                                title={SAVE_SHORTCUT_HINT}
                                disabled={saveDisabled}
                                className={cn(
                                    'px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90',
                                    saveDisabled && 'opacity-50 cursor-not-allowed hover:bg-primary',
                                )}
                            >
                                {t('common.save')}
                            </button>
                        </div>
                    </form>
                ) : (
                    <div className="p-4 space-y-4">
                        <div className="flex flex-col items-center justify-center gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    if (recordingBusy) return;
                                    if (isRecording) {
                                        void stopRecording({ saveTask: true });
                                    } else {
                                        void startRecording();
                                    }
                                }}
                                className={cn(
                                    'h-16 w-16 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                                    isRecording ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground',
                                    recordingBusy ? 'opacity-70 cursor-not-allowed' : 'hover:opacity-90'
                                )}
                                aria-label={audioButtonLabel}
                                disabled={recordingBusy}
                            >
                                {audioButtonLabel}
                            </button>
                            <div className="text-xs text-muted-foreground" aria-live="polite">
                                {audioStatusLabel}
                            </div>
                            {recordingBusy ? (
                                <div className="text-xs text-muted-foreground text-center" aria-live="polite">
                                    {tFallback(t, 'quickAdd.audioSavingSpeechToText', 'Saving the recording and applying speech-to-text.')}
                                </div>
                            ) : null}
                            {recordingError ? (
                                <div className="text-xs text-destructive text-center">{recordingError}</div>
                            ) : null}
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <button
                                type="button"
                                onClick={handleClose}
                                className="px-3 py-1.5 rounded-md text-sm bg-muted hover:bg-muted/80"
                            >
                                {t('common.cancel')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
        {bulkQuickAddLines ? (
            <div
                className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[22vh] z-[60]"
                role="dialog"
                aria-modal="true"
                aria-labelledby="quick-add-bulk-title"
                onClick={() => {
                    setBulkQuickAddLines(null);
                    setBulkQuickAddError(null);
                }}
            >
                <div
                    className="w-full max-w-md rounded-xl border bg-popover p-4 text-popover-foreground shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                >
                    <h4 id="quick-add-bulk-title" className="text-sm font-semibold">
                        {bulkConfirmTitle}
                    </h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {tFallback(t, 'quickAdd.bulkConfirmBody', 'Blank lines will be skipped. Each line uses Quick Add syntax.')}
                    </p>
                    <div className="mt-3 max-h-48 overflow-auto rounded-md border border-border bg-card text-sm">
                        {bulkPreviewLines.map((line, index) => (
                            <div key={`${index}:${line}`} className="border-b border-border px-3 py-2 last:border-b-0">
                                {line}
                            </div>
                        ))}
                        {bulkMoreCount > 0 ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                                {tFallback(t, 'quickAdd.bulkMoreLines', '+{{count}} more')
                                    .replace('{{count}}', String(bulkMoreCount))}
                            </div>
                        ) : null}
                    </div>
                    {bulkQuickAddError ? (
                        <p className="mt-2 text-xs text-destructive">{bulkQuickAddError}</p>
                    ) : null}
                    <div className="mt-4 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setBulkQuickAddLines(null);
                                setBulkQuickAddError(null);
                            }}
                            className="px-3 py-1.5 rounded-md text-sm bg-muted hover:bg-muted/80"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                void confirmBulkQuickAdd();
                            }}
                            className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            {tFallback(t, 'quickAdd.bulkConfirmCreate', 'Create tasks')}
                        </button>
                    </div>
                </div>
            </div>
        ) : null}
        </ModalPortal>
    );
}
