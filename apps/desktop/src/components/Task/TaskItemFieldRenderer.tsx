import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
    applyMarkdownKeyboardShortcut,
    applyMarkdownPairInsertion,
    applyMarkdownToolbarAction,
    applyMarkdownUrlPaste,
    addCalendarMonths,
    buildRRuleString,
    continueMarkdownOnEnter,
    computeRelativeStartTime,
    formatCalendarInputDate,
    getCalendarDayOfMonth,
    getCalendarMonthIndex,
    getProjectedRecurringTaskCalendarDate,
    getQuickDate,
    getRecurrenceCompletedOccurrencesValue,
    getShortWeekdayLabels,
    getTaskDateCoherenceIssues,
    hasTimeComponent,
    isJalaliCalendarLocale,
    isMarkdownEditorAssistEnabled,
    isQuickDatePresetSelected,
    QUICK_DATE_PRESETS_EXTENDED,
    normalizeClockTimeInput,
    normalizeDateFormatSetting,
    parseCalendarInputDate,
    parseRRuleString,
    REPEAT_REMINDER_INTERVAL_OPTIONS,
    resolveAutoTextDirection,
    safeFormatDate,
    safeParseDate,
    startOfCalendarMonth,
    tFallback,
    useTaskStore,
    type Attachment,
    type MarkdownSelection,
    type MarkdownToolbarActionId,
    type MarkdownToolbarResult,
    type QuickDatePreset,
    type RecurrenceByDay,
    type Recurrence,
    type RecurrenceRule,
    type RecurrenceStrategy,
    type Task,
    type TaskDraft,
    type TaskDraftSetter,
    type TaskEditorFieldId,
    type TaskEnergyLevel,
    type TaskPriority,
    type TaskStatus,
    type TimeEstimate,
} from '@mindwtr/core';
import { joinDateTime, splitDateTime } from '@mindwtr/core/date-draft';
import { readFile, remove } from '@tauri-apps/plugin-fs';

import { usePointerPress } from '../../hooks/usePointerPress';
import { useMarkdownReferenceAutocomplete } from '../MarkdownReferenceAutocomplete';
import { AttachmentsField } from './TaskForm/AttachmentsField';
import { ChecklistField } from './TaskForm/ChecklistField';
import { normalizeDateInputValue } from './task-item-helpers';
import { QUICK_ADD_FIELD_TOKENS, QuickAddTokenBadge, taskEditorLabelClassName } from './task-editor-label';
import { DescriptionField } from './fields/DescriptionField';
import { RecurrenceField } from './fields/RecurrenceField';
import {
    AssignedToField,
    ContextsField,
    EnergyLevelField,
    PriorityField,
    StatusField,
    TagsField,
    TimeEstimateField,
    TimeSpentField,
} from './fields/TaskMetadataFields';
import { QUICK_DATE_LABELS } from '../QuickDateChips';
import {
    captureScrollSnapshot,
    focusElementWithoutScroll,
    keepTextareaSelectionVisible,
    restoreScrollSnapshotSoon,
} from '../../lib/scroll-preservation';
import { logWarn } from '../../lib/app-log';
import { isTauriRuntime } from '../../lib/runtime';
import { processAudioCapture, resolveSpeechCapture } from '../../lib/speech-to-text';

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_POPOVER_WIDTH = 418;
const DATE_POPOVER_APPROX_HEIGHT = 340;
const DATE_POPOVER_MARGIN = 8;

// A native time input only opens its picker from the small clock glyph. Widen
// that to the whole field so it matches the date input beside it (#896).
// showPicker needs a user gesture and is missing on some engines, so a refusal
// is ignored on purpose: the field still accepts typing and the glyph still
// works, which is exactly the behaviour we had before.
const openNativePickerOnClick = (event: ReactMouseEvent<HTMLInputElement>) => {
    try {
        event.currentTarget.showPicker?.();
    } catch {
        // Engine declined (unsupported, or not treated as user-activated).
    }
};

type DescriptionAudioState = 'idle' | 'recording' | 'transcribing';

type NativeAudioCaptureResult = {
    path: string;
    sampleRate: number;
    channels: number;
    size: number;
};

const isRangeSelection = (selection: MarkdownSelection | null | undefined): selection is MarkdownSelection => (
    selection != null && selection.start !== selection.end
);

const getPairInsertionSelection = (
    currentValue: string,
    eventSelection: MarkdownSelection,
    pairSnapshot: { value: string; selection: MarkdownSelection } | null | undefined,
    fallbackSelection: MarkdownSelection | null | undefined,
): MarkdownSelection => {
    if (eventSelection.start !== eventSelection.end) {
        return eventSelection;
    }
    if (pairSnapshot?.value === currentValue && isRangeSelection(pairSnapshot.selection)) {
        return pairSnapshot.selection;
    }
    if (isRangeSelection(fallbackSelection)) {
        return fallbackSelection;
    }
    return eventSelection;
};

type DateInputOrder = 'dmy' | 'mdy' | 'ymd';

function parseDateInputDate(value: string): Date | null {
    if (!DATE_INPUT_PATTERN.test(value)) return safeParseDate(value);
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    const parsed = new Date(year, month - 1, day);
    if (
        parsed.getFullYear() !== year
        || parsed.getMonth() !== month - 1
        || parsed.getDate() !== day
    ) {
        return null;
    }
    return parsed;
}

function getCalendarLocale(locale: string): string | undefined {
    const normalized = locale.trim();
    if (!normalized) return undefined;
    return normalized.split('-u-')[0] || normalized;
}

function getWeekStartIndex(locale: string): number {
    const normalized = locale.toLowerCase();
    if (normalized.includes('fw-mon')) return 1;
    if (normalized.includes('fw-sat')) return 6;
    return 0;
}

function getCalendarGridDays(monthDate: Date, weekStartIndex: number, calendarSystem: string): Date[] {
    const firstOfMonth = startOfCalendarMonth(monthDate, calendarSystem);
    const offset = (firstOfMonth.getDay() - weekStartIndex + 7) % 7;
    const start = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, index) =>
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    );
}

function getWeekdayLabels(locale: string, weekStartIndex: number): string[] {
    const labels = getShortWeekdayLabels(getCalendarLocale(locale));
    return Array.from({ length: 7 }, (_, index) => labels[(weekStartIndex + index) % 7]);
}

function getDateInputOrder(dateFormatSetting: string | null | undefined, locale: string): DateInputOrder {
    const dateFormat = normalizeDateFormatSetting(dateFormatSetting);
    if (dateFormat === 'dmy') return 'dmy';
    if (dateFormat === 'mdy') return 'mdy';
    if (dateFormat === 'ymd') return 'ymd';

    const formatter = new Intl.DateTimeFormat(getCalendarLocale(locale), {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const order = formatter
        .formatToParts(new Date(2026, 10, 22))
        .filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day')
        .map((part) => part.type[0])
        .join('');
    if (order === 'dmy' || order === 'mdy' || order === 'ymd') return order;
    return 'mdy';
}

function getDateInputPlaceholder(order: DateInputOrder): string {
    if (order === 'dmy') return 'DD/MM/YYYY';
    if (order === 'mdy') return 'MM/DD/YYYY';
    return 'YYYY-MM-DD';
}

function formatDateInputDisplay(value: string, order: DateInputOrder, calendarSystem: string): string {
    if (!value) return '';
    if (calendarSystem === 'jalali') {
        return formatCalendarInputDate(value, calendarSystem);
    }
    const parsed = parseDateInputDate(value);
    if (!parsed) return value;

    const year = String(parsed.getFullYear()).padStart(4, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    if (order === 'dmy') return `${day}/${month}/${year}`;
    if (order === 'mdy') return `${month}/${day}/${year}`;
    return `${year}-${month}-${day}`;
}

function parseDateInputDisplay(value: string, order: DateInputOrder, calendarSystem: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return '';

    if (calendarSystem === 'jalali') {
        if (DATE_INPUT_PATTERN.test(trimmed)) {
            return parseCalendarInputDate(trimmed, calendarSystem);
        }
        const parts = trimmed.match(/\d{1,4}/g);
        if (!parts || parts.length !== 3 || parts[0].length !== 4) return null;
        const [year, month, day] = parts;
        return parseCalendarInputDate(
            `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
            calendarSystem
        );
    }

    if (DATE_INPUT_PATTERN.test(trimmed)) {
        const normalized = normalizeDateInputValue(trimmed);
        return parseDateInputDate(normalized) ? normalized : null;
    }

    const parts = trimmed.match(/\d{1,4}/g);
    if (!parts || parts.length !== 3) return null;

    let year: string;
    let month: string;
    let day: string;
    if (parts[0].length === 4) {
        [year, month, day] = parts;
    } else if (order === 'dmy') {
        [day, month, year] = parts;
    } else if (order === 'mdy') {
        [month, day, year] = parts;
    } else {
        [year, month, day] = parts;
    }

    if (year.length !== 4) return null;
    const normalized = normalizeDateInputValue(
        `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    );
    return parseDateInputDate(normalized) ? normalized : null;
}

type DateFieldProps = {
    t: (key: string) => string;
    label: string;
    labelToken?: string;
    dateAriaLabel: string;
    dateValue: string;
    selectedDate: Date | null;
    dateFormatSetting?: string | null;
    nativeDateInputLocale: string;
    dateInputClassName: string;
    timeInput: ReactNode;
    onDateChange: (value: string) => void;
    onClear: () => void;
    onDateOnly?: () => void;
    hasValue: boolean;
    /** Focus the date input on mount, for hosts that open with this field ready. */
    autoFocus?: boolean;
};

export function DateField({
    t,
    label,
    labelToken,
    dateAriaLabel,
    dateValue,
    selectedDate,
    dateFormatSetting,
    nativeDateInputLocale,
    dateInputClassName,
    timeInput,
    onDateChange,
    onClear,
    onDateOnly,
    hasValue,
    autoFocus,
}: DateFieldProps) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const calendarRef = useRef<HTMLDivElement | null>(null);
    const { runAfterPointerRelease } = usePointerPress();
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [calendarPosition, setCalendarPosition] = useState({ top: 0, left: 0 });
    const calendarSystem = isJalaliCalendarLocale(nativeDateInputLocale) ? 'jalali' : 'gregorian';
    const [calendarMonth, setCalendarMonth] = useState(() =>
        startOfCalendarMonth(selectedDate ?? parseDateInputDate(dateValue) ?? new Date(), calendarSystem)
    );
    const clearText = tFallback(t, 'common.clear', 'Clear');
    const dateOnlyText = t('taskEdit.dateOnly');
    const calendarText = t('nav.calendar');
    const previousMonthText = t('calendar.prevMonth');
    const nextMonthText = t('calendar.nextMonth');
    const calendarAriaLabel = `${label} ${calendarText}`;
    const previousMonthAriaLabel = `${calendarText}: ${previousMonthText}`;
    const nextMonthAriaLabel = `${calendarText}: ${nextMonthText}`;
    const dateInputOrder = calendarSystem === 'jalali'
        ? 'ymd'
        : getDateInputOrder(dateFormatSetting, nativeDateInputLocale);
    const [draftDateValue, setDraftDateValue] = useState(() => (
        formatDateInputDisplay(dateValue, dateInputOrder, calendarSystem)
    ));
    const weekStartIndex = getWeekStartIndex(nativeDateInputLocale);
    const calendarLocale = getCalendarLocale(nativeDateInputLocale);
    const monthLabel = new Intl.DateTimeFormat(calendarLocale, { month: 'long', year: 'numeric' }).format(calendarMonth);
    const fullDateFormatter = new Intl.DateTimeFormat(calendarLocale, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const weekdayLabels = getWeekdayLabels(nativeDateInputLocale, weekStartIndex);
    const days = getCalendarGridDays(calendarMonth, weekStartIndex, calendarSystem);
    const now = new Date();
    const todayValue = safeFormatDate(now, 'yyyy-MM-dd');

    const updateCalendarPosition = useCallback(() => {
        const anchor = inputRef.current?.parentElement ?? inputRef.current;
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        const maxLeft = Math.max(DATE_POPOVER_MARGIN, window.innerWidth - DATE_POPOVER_WIDTH - DATE_POPOVER_MARGIN);
        const left = Math.min(Math.max(rect.left, DATE_POPOVER_MARGIN), maxLeft);
        const wouldOverflowBottom = rect.bottom + DATE_POPOVER_APPROX_HEIGHT + DATE_POPOVER_MARGIN > window.innerHeight;
        const top = wouldOverflowBottom
            ? Math.max(DATE_POPOVER_MARGIN, rect.top - DATE_POPOVER_APPROX_HEIGHT - 4)
            : rect.bottom + 4;
        setCalendarPosition({ top, left });
    }, []);
    const openCalendar = useCallback(() => {
        updateCalendarPosition();
        setIsCalendarOpen(true);
    }, [updateCalendarPosition]);

    const resetFieldState = useCallback(() => {
        setIsCalendarOpen(false);
        setDraftDateValue(formatDateInputDisplay(dateValue, dateInputOrder, calendarSystem));
    }, [calendarSystem, dateInputOrder, dateValue]);

    useEffect(() => {
        setDraftDateValue(formatDateInputDisplay(dateValue, dateInputOrder, calendarSystem));
    }, [calendarSystem, dateInputOrder, dateValue]);

    useEffect(() => {
        if (!isCalendarOpen) return;
        const nextDate = selectedDate ?? parseDateInputDate(dateValue) ?? new Date();
        setCalendarMonth(startOfCalendarMonth(nextDate, calendarSystem));
    }, [calendarSystem, dateValue, isCalendarOpen, selectedDate]);

    useEffect(() => {
        if (!isCalendarOpen) return;
        updateCalendarPosition();

        const handlePointerDown = (event: MouseEvent | PointerEvent | TouchEvent) => {
            const target = event.target;
            if (target instanceof Node && rootRef.current?.contains(target)) return;
            resetFieldState();
        };
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsCalendarOpen(false);
            }
        };
        const handleViewportChange = () => updateCalendarPosition();

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('mousedown', handlePointerDown, true);
        document.addEventListener('touchstart', handlePointerDown, true);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('mousedown', handlePointerDown, true);
            document.removeEventListener('touchstart', handlePointerDown, true);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
        };
    }, [isCalendarOpen, resetFieldState, updateCalendarPosition]);

    const handleDateInputChange = (value: string) => {
        setDraftDateValue(value);
        const parsed = parseDateInputDisplay(value, dateInputOrder, calendarSystem);
        if (parsed === null) return;
        if (!parsed) {
            onClear();
            return;
        }
        onDateChange(parsed);
    };
    const applyCalendarDate = (date: Date) => {
        const nextDateValue = safeFormatDate(date, 'yyyy-MM-dd');
        setDraftDateValue(formatDateInputDisplay(nextDateValue, dateInputOrder, calendarSystem));
        onDateChange(nextDateValue);
        setIsCalendarOpen(false);
    };
    const applyQuickDatePreset = (preset: QuickDatePreset) => {
        const date = getQuickDate(preset, new Date());
        if (!date) {
            setDraftDateValue('');
            onClear();
            setIsCalendarOpen(false);
            return;
        }
        applyCalendarDate(date);
    };

    return (
        <div
            className="relative flex flex-col gap-1"
            ref={rootRef}
            onBlurCapture={() => {
                runAfterPointerRelease(() => {
                    const activeElement = document.activeElement;
                    if (activeElement instanceof Node && rootRef.current?.contains(activeElement)) return;
                    resetFieldState();
                });
            }}
        >
            <label className={`${taskEditorLabelClassName} inline-flex items-center gap-1.5`}>
                {label}
                {labelToken && <QuickAddTokenBadge t={t} token={labelToken} />}
            </label>
            <div className="flex w-full max-w-[min(22rem,100%)] items-center gap-2">
                <div className="relative min-w-0 flex-1">
                    <input
                        ref={inputRef}
                        autoFocus={autoFocus}
                        type="text"
                        inputMode="numeric"
                        placeholder={getDateInputPlaceholder(dateInputOrder)}
                        lang={nativeDateInputLocale}
                        aria-label={dateAriaLabel}
                        aria-haspopup="dialog"
                        aria-expanded={isCalendarOpen}
                        value={draftDateValue}
                        onChange={(event) => handleDateInputChange(event.target.value)}
                        // The calendar icon is a small target, so the whole field opens the
                        // popover (#896). openCalendar only positions and shows it — it never
                        // moves focus — so the caret stays where it was clicked and the date
                        // can still be typed straight over it.
                        onClick={openCalendar}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                setIsCalendarOpen(false);
                                event.stopPropagation();
                            } else if (event.key === 'ArrowDown') {
                                openCalendar();
                                event.preventDefault();
                            }
                        }}
                        className={`${dateInputClassName} w-full pr-8`}
                    />
                    <button
                        type="button"
                        aria-label={calendarAriaLabel}
                        aria-haspopup="dialog"
                        aria-expanded={isCalendarOpen}
                        onClick={openCalendar}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                </div>
                {timeInput}
                {onDateOnly ? (
                    <button
                        type="button"
                        onClick={onDateOnly}
                        className="shrink-0 whitespace-nowrap rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={`${dateOnlyText}: ${label}`}
                    >
                        {dateOnlyText}
                    </button>
                ) : null}
                {hasValue ? (
                    <button
                        type="button"
                        onClick={() => {
                            setDraftDateValue('');
                            onClear();
                            setIsCalendarOpen(false);
                        }}
                        className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={`${clearText} ${label}`}
                    >
                        <X className="h-4 w-4" />
                    </button>
                ) : (
                    <span aria-hidden="true" className="h-7 w-7 shrink-0" />
                )}
            </div>
            {isCalendarOpen && (
                <div
                    ref={calendarRef}
                    role="dialog"
                    aria-label={calendarAriaLabel}
                    className="fixed z-50 flex rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
                    style={{ top: calendarPosition.top, left: calendarPosition.left }}
                >
                    <div className="w-72 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <button
                                type="button"
                                aria-label={previousMonthAriaLabel}
                                onClick={() => setCalendarMonth((current) => addCalendarMonths(current, -1, calendarSystem))}
                                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <div className="min-w-0 flex-1 text-center text-sm font-medium text-foreground">
                                {monthLabel}
                            </div>
                            <button
                                type="button"
                                aria-label={nextMonthAriaLabel}
                                onClick={() => setCalendarMonth((current) => addCalendarMonths(current, 1, calendarSystem))}
                                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
                            {weekdayLabels.map((weekday, index) => (
                                <div key={`${weekday}-${index}`} className="py-1">
                                    {weekday}
                                </div>
                            ))}
                        </div>
                        <div className="mt-1 grid grid-cols-7 gap-1">
                            {days.map((day) => {
                                const value = safeFormatDate(day, 'yyyy-MM-dd');
                                const isSelected = value === dateValue;
                                const isToday = value === todayValue;
                                const isOutsideMonth = getCalendarMonthIndex(day, calendarSystem) !== getCalendarMonthIndex(calendarMonth, calendarSystem);
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        aria-label={fullDateFormatter.format(day)}
                                        aria-pressed={isSelected}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => applyCalendarDate(day)}
                                        className={[
                                            'h-8 rounded text-xs transition-colors',
                                            isSelected
                                                ? 'bg-primary text-primary-foreground'
                                                : isToday
                                                    ? 'border border-primary/60 text-primary hover:bg-primary/10'
                                                    : 'text-foreground hover:bg-muted',
                                            isOutsideMonth && !isSelected ? 'text-muted-foreground/50' : '',
                                        ].filter(Boolean).join(' ')}
                                    >
                                        {getCalendarDayOfMonth(day, calendarSystem)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="flex w-32 shrink-0 flex-col gap-0.5 border-l border-border p-2">
                        {QUICK_DATE_PRESETS_EXTENDED.map((preset) => {
                            const labelConfig = QUICK_DATE_LABELS[preset];
                            const suggestionLabel = tFallback(t, labelConfig.key, labelConfig.fallback);
                            const active = isQuickDatePresetSelected(preset, selectedDate, now);
                            return (
                                <button
                                    key={preset}
                                    type="button"
                                    aria-pressed={active}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => applyQuickDatePreset(preset)}
                                    className={[
                                        'rounded px-2 py-1.5 text-left text-xs transition-colors',
                                        active
                                            ? 'bg-primary text-primary-foreground'
                                            : 'text-foreground hover:bg-muted',
                                    ].filter(Boolean).join(' ')}
                                >
                                    {suggestionLabel}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

export type MonthlyRecurrenceInfo = {
    pattern: 'date' | 'custom';
    interval: number;
};

/** Locale- and settings-derived facts the field editors render against. */
export type TaskEditorEnv = {
    t: (key: string) => string;
    language: string;
    dateFormatSetting?: string | null;
    nativeDateInputLocale: string;
    defaultScheduleTime: string;
    timeSpentEnabled: boolean;
    showObsidianNoteAttachment: boolean;
};

/** Token/person option lists (lazily loaded by useTaskItemProjectContext). */
export type TaskEditorOptionLists = {
    allContextOptions: string[];
    allTagOptions: string[];
    popularContextOptions: string[];
    popularTagOptions: string[];
    assignedToOptions: string[];
};

/** The slice of useTaskItemAttachments the attachments field consumes. */
export type TaskEditorAttachments = {
    attachmentError: string | null;
    visibleEditAttachments: Attachment[];
    addFileAttachment: () => void;
    addLinkAttachment: () => void;
    addObsidianNoteAttachment: () => void;
    editLinkAttachment: (attachment: Attachment) => void;
    openAttachment: (attachment: Attachment) => void;
    removeAttachment: (id: string) => void;
};

export type TaskEditorDescriptionPreview = {
    visible: boolean;
    toggle: () => void;
    editSource: () => void;
};

export type TaskEditorActions = {
    openCustomRecurrence: () => void;
    createAssignedToPerson: (name: string) => void | Promise<void>;
    requestBackdatedComplete?: () => void;
    updateTask: (taskId: string, updates: Partial<Task>) => void;
    resetTaskChecklist: (taskId: string) => void;
};

type TaskItemFieldRendererProps = {
    fieldId: TaskEditorFieldId;
    task: Task;
    draft: TaskDraft;
    setField: TaskDraftSetter;
    monthlyRecurrence: MonthlyRecurrenceInfo;
    descriptionPreview: TaskEditorDescriptionPreview;
    env: TaskEditorEnv;
    options: TaskEditorOptionLists;
    attachments: TaskEditorAttachments;
    actions: TaskEditorActions;
};

export function TaskItemFieldRenderer({
    fieldId,
    task,
    draft,
    setField,
    monthlyRecurrence,
    descriptionPreview,
    env,
    options,
    attachments,
    actions,
}: TaskItemFieldRendererProps) {
    const {
        t,
        language,
        dateFormatSetting,
        nativeDateInputLocale,
        defaultScheduleTime,
        timeSpentEnabled,
        showObsidianNoteAttachment,
    } = env;
    const {
        allContextOptions,
        allTagOptions,
        popularContextOptions,
        popularTagOptions,
        assignedToOptions,
    } = options;
    const {
        attachmentError,
        visibleEditAttachments,
        addFileAttachment,
        addLinkAttachment,
        addObsidianNoteAttachment,
        editLinkAttachment,
        openAttachment,
        removeAttachment,
    } = attachments;
    const {
        openCustomRecurrence,
        createAssignedToPerson,
        requestBackdatedComplete,
        updateTask,
        resetTaskChecklist,
    } = actions;
    const taskId = task.id;
    const showDescriptionPreview = descriptionPreview.visible;
    const toggleDescriptionPreview = descriptionPreview.toggle;
    const editDescriptionFromPreview = descriptionPreview.editSource;
    // Draft values and their setField bindings, under the names the field
    // editors below were written against.
    const {
        description: editDescription,
        availableAt: editStartTime,
        relativeStartOffset: editRelativeStartOffset,
        dueDate: editDueDate,
        reviewAt: editReviewAt,
        repeatReminderMinutes: editRepeatReminderMinutes,
        suppressMindwtrReminders: editSuppressMindwtrReminders,
        status: editStatus,
        priority: editPriority,
        energyLevel: editEnergyLevel,
        assignedTo: editAssignedTo,
        recurrence: editRecurrence,
        recurrenceStrategy: editRecurrenceStrategy,
        recurrenceRRule: editRecurrenceRRule,
        showFutureRecurrence: editShowFutureRecurrence,
        timeEstimate: editTimeEstimate,
        timeSpentMinutes: editTimeSpentMinutes,
        contexts: editContexts,
        tags: editTags,
        location: editLocation,
    } = draft;
    const setEditDescription = (value: string) => setField('description', value);
    const setEditStartTime = (value: string) => setField('availableAt', value);
    const setEditRelativeStartOffset = (value: Task['relativeStartOffset']) => setField('relativeStartOffset', value);
    const setEditDueDate = (value: string) => setField('dueDate', value);
    const setEditReviewAt = (value: string) => setField('reviewAt', value);
    const setEditRepeatReminderMinutes = (value: number | undefined) => setField('repeatReminderMinutes', value);
    const setEditSuppressMindwtrReminders = (value: boolean) => setField('suppressMindwtrReminders', value);
    const setEditStatus = (value: TaskStatus) => setField('status', value);
    const setEditPriority = (value: TaskPriority | '') => setField('priority', value);
    const setEditEnergyLevel = (value: NonNullable<TaskEnergyLevel> | '') => setField('energyLevel', value);
    const setEditAssignedTo = (value: string) => setField('assignedTo', value);
    const setEditRecurrence = (value: RecurrenceRule | '') => setField('recurrence', value);
    const setEditRecurrenceStrategy = (value: RecurrenceStrategy) => setField('recurrenceStrategy', value);
    const setEditRecurrenceRRule = (value: string) => setField('recurrenceRRule', value);
    const setEditShowFutureRecurrence = (value: boolean) => setField('showFutureRecurrence', value);
    const setEditTimeEstimate = (value: TimeEstimate | '') => setField('timeEstimate', value);
    const setEditTimeSpentMinutes = (value: number | undefined) => setField('timeSpentMinutes', value);
    const setEditContexts = (value: string) => setField('contexts', value);
    const setEditTags = (value: string) => setField('tags', value);
    const setEditLocation = (value: string) => setField('location', value);

    const markdownEditorAssist = useTaskStore((state) => isMarkdownEditorAssistEnabled(state.settings));

    const [reviewTimeDraft, setReviewTimeDraft] = useState('');
    const [repeatReminderOptionsExpanded, setRepeatReminderOptionsExpanded] = useState(false);
    const [descriptionExpanded, setDescriptionExpanded] = useState(false);
    const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const lastDescriptionPairSelectionRef = useRef<{ value: string; selection: MarkdownSelection } | null>(null);
    const descriptionSelectionRef = useRef<MarkdownSelection>({
        start: editDescription.length,
        end: editDescription.length,
    });
    const descriptionUndoRef = useRef<Array<{ value: string; selection: MarkdownSelection }>>([]);
    const [descriptionUndoDepth, setDescriptionUndoDepth] = useState(0);
    const [descriptionAudioState, setDescriptionAudioState] = useState<DescriptionAudioState>('idle');
    const [descriptionAudioError, setDescriptionAudioError] = useState<string | null>(null);
    const descriptionAudioStateRef = useRef<DescriptionAudioState>('idle');
    useEffect(() => {
        const parsed = editReviewAt ? safeParseDate(editReviewAt) : null;
        const hasTime = hasTimeComponent(editReviewAt);
        const next = hasTime && parsed ? safeFormatDate(parsed, 'HH:mm') : '';
        setReviewTimeDraft(next);
    }, [editReviewAt]);
    useEffect(() => {
        descriptionAudioStateRef.current = descriptionAudioState;
    }, [descriptionAudioState]);
    useEffect(() => () => {
        if (descriptionAudioStateRef.current !== 'recording' || !isTauriRuntime()) return;
        void import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke<NativeAudioCaptureResult>('stop_audio_recording'))
            .then((result) => {
                if (!result.path) return;
                return remove(result.path);
            })
            .catch((error) => {
                void logWarn('Description audio cleanup failed', {
                    scope: 'audio',
                    extra: { error: error instanceof Error ? error.message : String(error) },
                });
            });
    }, []);
    useEffect(() => {
        descriptionSelectionRef.current = {
            start: editDescription.length,
            end: editDescription.length,
        };
        lastDescriptionPairSelectionRef.current = null;
        descriptionUndoRef.current = [];
        setDescriptionUndoDepth(0);
        setDescriptionAudioError(null);
    }, [taskId]);
    const parsedRecurrenceRRule = parseRRuleString(editRecurrenceRRule);
    const recurrenceEndMode: 'never' | 'until' | 'count' = parsedRecurrenceRRule.count
        ? 'count'
        : parsedRecurrenceRRule.until
            ? 'until'
            : 'never';
    const recurrenceDefaultEndDate = parsedRecurrenceRRule.until
        || safeFormatDate(
            safeParseDate(editDueDate || editStartTime || task.dueDate || task.startTime) ?? new Date(),
            'yyyy-MM-dd'
        );
    const buildRecurrenceRRule = (
        rule: RecurrenceRule,
        overrides: {
            byDay?: RecurrenceByDay[];
            interval?: number;
            byMonthDay?: number[];
            count?: number;
            until?: string;
        } = {}
    ) => {
        const hasOverride = <TKey extends keyof typeof overrides>(key: TKey) =>
            Object.prototype.hasOwnProperty.call(overrides, key);
        return buildRRuleString(
            rule,
            hasOverride('byDay') ? overrides.byDay : parsedRecurrenceRRule.byDay,
            hasOverride('interval') ? overrides.interval : parsedRecurrenceRRule.interval,
            {
                byMonthDay: hasOverride('byMonthDay') ? overrides.byMonthDay : parsedRecurrenceRRule.byMonthDay,
                count: hasOverride('count') ? overrides.count : parsedRecurrenceRRule.count,
                until: hasOverride('until') ? overrides.until : parsedRecurrenceRRule.until,
            }
        );
    };
    const recurrencePreviewValue: Recurrence | undefined = editRecurrence
        ? { rule: editRecurrence, strategy: editRecurrenceStrategy }
        : undefined;
    if (recurrencePreviewValue && editRecurrenceRRule) {
        if (parsedRecurrenceRRule.byDay && parsedRecurrenceRRule.byDay.length > 0) {
            recurrencePreviewValue.byDay = parsedRecurrenceRRule.byDay;
        }
        if (parsedRecurrenceRRule.byMonthDay && parsedRecurrenceRRule.byMonthDay.length > 0) {
            recurrencePreviewValue.byMonthDay = parsedRecurrenceRRule.byMonthDay;
        }
        if (parsedRecurrenceRRule.count) {
            recurrencePreviewValue.count = parsedRecurrenceRRule.count;
        }
        if (parsedRecurrenceRRule.until) {
            recurrencePreviewValue.until = parsedRecurrenceRRule.until;
        }
        const completedOccurrences = getRecurrenceCompletedOccurrencesValue(task.recurrence);
        if (typeof completedOccurrences === 'number') {
            recurrencePreviewValue.completedOccurrences = completedOccurrences;
        }
        recurrencePreviewValue.rrule = editRecurrenceRRule;
    }
    const projectedRecurrenceDateLabel = recurrencePreviewValue
        ? safeFormatDate(getProjectedRecurringTaskCalendarDate({
            ...task,
            startTime: editStartTime || undefined,
            dueDate: editDueDate || undefined,
            recurrence: recurrencePreviewValue,
            showFutureRecurrence: true,
        }), 'PP')
        : '';

    const resolvedDirection = resolveAutoTextDirection([task.title, editDescription].filter(Boolean).join(' '), language);
    const isRtl = resolvedDirection === 'rtl';
    const pushDescriptionUndoEntry = (value: string, selection: MarkdownSelection) => {
        const previousEntry = descriptionUndoRef.current[descriptionUndoRef.current.length - 1];
        if (
            previousEntry
            && previousEntry.value === value
            && previousEntry.selection.start === selection.start
            && previousEntry.selection.end === selection.end
        ) {
            return;
        }
        const nextUndoEntries = [...descriptionUndoRef.current, { value, selection }];
        descriptionUndoRef.current = nextUndoEntries.length > 100
            ? nextUndoEntries.slice(nextUndoEntries.length - 100)
            : nextUndoEntries;
        setDescriptionUndoDepth(descriptionUndoRef.current.length);
    };
    const applyDescriptionValue = (
        value: string,
        options?: {
            nextSelection?: MarkdownSelection;
            recordUndo?: boolean;
            baseSelection?: MarkdownSelection;
        },
    ) => {
        if ((options?.recordUndo ?? true) && value !== editDescription) {
            pushDescriptionUndoEntry(editDescription, options?.baseSelection ?? descriptionSelectionRef.current);
        }
        setEditDescription(value);
        if (options?.nextSelection) {
            descriptionSelectionRef.current = options.nextSelection;
        } else {
            lastDescriptionPairSelectionRef.current = null;
        }
    };
    const restoreDescriptionTextareaSelection = (
        textarea: HTMLTextAreaElement,
        selection: MarkdownSelection,
    ) => {
        requestAnimationFrame(() => {
            const target = textarea.isConnected ? textarea : descriptionTextareaRef.current;
            if (!target) return;
            const scrollSnapshot = captureScrollSnapshot(target);
            const surroundingScrollSnapshot = scrollSnapshot.filter(
                (snapshot) => snapshot.kind === 'window' || snapshot.target !== target,
            );
            focusElementWithoutScroll(target, scrollSnapshot);
            target.setSelectionRange(selection.start, selection.end);
            keepTextareaSelectionVisible(target);
            restoreScrollSnapshotSoon(surroundingScrollSnapshot);
        });
    };
    const handleDescriptionUndo = () => {
        const previousEntry = descriptionUndoRef.current[descriptionUndoRef.current.length - 1];
        if (!previousEntry) return undefined;
        descriptionUndoRef.current = descriptionUndoRef.current.slice(0, -1);
        setDescriptionUndoDepth(descriptionUndoRef.current.length);
        applyDescriptionValue(previousEntry.value, {
            nextSelection: previousEntry.selection,
            recordUndo: false,
        });
        return previousEntry.selection;
    };
    const handleDescriptionApplyAction = (actionId: MarkdownToolbarActionId, selection: MarkdownSelection): MarkdownToolbarResult => {
        const next = applyMarkdownToolbarAction(editDescription, selection, actionId);
        applyDescriptionValue(next.value, {
            baseSelection: selection,
            nextSelection: next.selection,
        });
        return next;
    };
    const descriptionAutocomplete = useMarkdownReferenceAutocomplete({
        currentTaskId: taskId,
        value: editDescription,
        selection: descriptionSelectionRef.current,
        textareaRef: descriptionTextareaRef,
        onApplyResult: (next) => {
            lastDescriptionPairSelectionRef.current = null;
            applyDescriptionValue(next.value, {
                baseSelection: descriptionSelectionRef.current,
                nextSelection: next.selection,
            });
            descriptionSelectionRef.current = next.selection;
        },
    });
    const handleDescriptionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (descriptionAutocomplete.handleKeyDown(event)) {
            return;
        }
        const eventTextarea = event.currentTarget;
        const currentValue = event.currentTarget.value;
        const selection = {
            start: event.currentTarget.selectionStart ?? currentValue.length,
            end: event.currentTarget.selectionEnd ?? currentValue.length,
        };
        const applyDescriptionKeyboardResult = (
            next: MarkdownToolbarResult,
            baseSelection = selection,
            rememberPairRange = false,
        ) => {
            applyDescriptionValue(next.value, {
                baseSelection,
                nextSelection: next.selection,
            });
            descriptionSelectionRef.current = next.selection;
            lastDescriptionPairSelectionRef.current = rememberPairRange && isRangeSelection(next.selection)
                ? { value: next.value, selection: next.selection }
                : null;
            restoreDescriptionTextareaSelection(eventTextarea, next.selection);
        };
        const lowerKey = event.key.toLowerCase();
        if ((event.metaKey || event.ctrlKey) && !event.altKey) {
            if (lowerKey === 'b' || lowerKey === 'i') {
                const next = applyMarkdownKeyboardShortcut(currentValue, selection, {
                    key: event.key,
                    ctrlKey: event.ctrlKey,
                    metaKey: event.metaKey,
                });
                if (!next) return;
                event.preventDefault();
                applyDescriptionKeyboardResult(next);
                return;
            }
            if (lowerKey !== 'z') return;
            if (descriptionUndoRef.current.length === 0) return;
            event.preventDefault();
            const restoredSelection = handleDescriptionUndo();
            if (restoredSelection) {
                restoreDescriptionTextareaSelection(eventTextarea, restoredSelection);
            }
            return;
        }

        const isPairInsertionKey = !event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1;
        if (!isPairInsertionKey && event.key !== 'Tab') {
            lastDescriptionPairSelectionRef.current = null;
        }
        if (event.key === 'Tab' || isPairInsertionKey) {
            const pairSelection = isPairInsertionKey
                ? getPairInsertionSelection(currentValue, selection, lastDescriptionPairSelectionRef.current, descriptionSelectionRef.current)
                : selection;
            const next = event.key === 'Tab'
                ? applyMarkdownKeyboardShortcut(currentValue, selection, {
                    key: event.key,
                    shiftKey: event.shiftKey,
                })
                : applyMarkdownPairInsertion(
                    currentValue,
                    `${currentValue.slice(0, pairSelection.start)}${event.key}${currentValue.slice(pairSelection.end)}`,
                    pairSelection,
                    { assist: markdownEditorAssist },
                );
            if (!next) return;
            event.preventDefault();
            applyDescriptionKeyboardResult(next, pairSelection, isPairInsertionKey);
            return;
        }

        if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;
        const next = continueMarkdownOnEnter(currentValue, selection, { assist: markdownEditorAssist });
        if (!next) return;

        event.preventDefault();
        lastDescriptionPairSelectionRef.current = null;
        applyDescriptionKeyboardResult(next);
    };
    const handleDescriptionPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const pastedText = event.clipboardData.getData('text/plain');
        if (!pastedText) return;
        const eventTextarea = event.currentTarget;
        const currentValue = event.currentTarget.value;
        const selection = {
            start: event.currentTarget.selectionStart ?? currentValue.length,
            end: event.currentTarget.selectionEnd ?? currentValue.length,
        };
        const next = applyMarkdownUrlPaste(
            currentValue,
            `${currentValue.slice(0, selection.start)}${pastedText}${currentValue.slice(selection.end)}`,
            selection,
            { assist: markdownEditorAssist },
        );
        if (!next) return;
        event.preventDefault();
        lastDescriptionPairSelectionRef.current = null;
        applyDescriptionValue(next.value, {
            baseSelection: selection,
            nextSelection: next.selection,
        });
        descriptionSelectionRef.current = next.selection;
        restoreDescriptionTextareaSelection(eventTextarea, next.selection);
    };
    const handleDescriptionInput = (
        value: string,
        selection: MarkdownSelection,
        source: HTMLTextAreaElement,
    ) => {
        const previousSelection = descriptionSelectionRef.current;
        const pairedInsertion = applyMarkdownPairInsertion(editDescription, value, previousSelection, { assist: markdownEditorAssist });
        if (pairedInsertion) {
            applyDescriptionValue(pairedInsertion.value, {
                baseSelection: previousSelection,
                nextSelection: pairedInsertion.selection,
            });
            descriptionSelectionRef.current = pairedInsertion.selection;
            lastDescriptionPairSelectionRef.current = isRangeSelection(pairedInsertion.selection)
                ? { value: pairedInsertion.value, selection: pairedInsertion.selection }
                : null;
            restoreDescriptionTextareaSelection(source, pairedInsertion.selection);
            return;
        }

        lastDescriptionPairSelectionRef.current = null;
        applyDescriptionValue(value);
        descriptionSelectionRef.current = selection;
    };
    const insertDescriptionTranscript = useCallback((transcript: string) => {
        const trimmedTranscript = transcript.trim();
        if (!trimmedTranscript) return;

        const currentValue = editDescription;
        const rawSelection = descriptionSelectionRef.current;
        const start = Math.max(0, Math.min(rawSelection.start, currentValue.length));
        const end = Math.max(start, Math.min(rawSelection.end, currentValue.length));
        const before = currentValue.slice(0, start);
        const after = currentValue.slice(end);
        const prefix = before.length > 0 && !/\s$/.test(before) ? '\n' : '';
        const suffix = after.length > 0 && !/^\s/.test(after) ? '\n' : '';
        const insertion = `${prefix}${trimmedTranscript}${suffix}`;
        const nextValue = `${before}${insertion}${after}`;
        const nextCursor = before.length + insertion.length;
        const nextSelection = { start: nextCursor, end: nextCursor };

        lastDescriptionPairSelectionRef.current = null;
        applyDescriptionValue(nextValue, {
            baseSelection: rawSelection,
            nextSelection,
        });
        descriptionSelectionRef.current = nextSelection;

        const textarea = descriptionTextareaRef.current;
        if (textarea) restoreDescriptionTextareaSelection(textarea, nextSelection);
    }, [editDescription]);
    const handleDescriptionAudioInput = useCallback(async () => {
        if (descriptionAudioState === 'transcribing') return;
        if (!isTauriRuntime()) {
            setDescriptionAudioError(tFallback(t, 'attachments.fileNotSupported', 'File not supported.'));
            return;
        }

        const { invoke } = await import('@tauri-apps/api/core');

        if (descriptionAudioState !== 'recording') {
            setDescriptionAudioError(null);
            try {
                await invoke('start_audio_recording');
                setDescriptionAudioState('recording');
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setDescriptionAudioError(message || tFallback(t, 'quickAdd.audioErrorBody', 'Could not start audio recording.'));
            }
            return;
        }

        let capture: NativeAudioCaptureResult | null = null;
        setDescriptionAudioError(null);
        try {
            capture = await invoke<NativeAudioCaptureResult>('stop_audio_recording');
            setDescriptionAudioState('transcribing');

            const currentSettings = useTaskStore.getState().settings;
            const { ready: speechReady, config: speechConfig } = await resolveSpeechCapture(currentSettings.ai);
            if (!speechReady) {
                throw new Error(tFallback(t, 'attachments.transcriptionUnavailable', 'Speech-to-text is not ready. Check your AI settings and try again.'));
            }

            const bytes = await readFile(capture.path);
            const audioBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            const timeZone = typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function'
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : undefined;
            const result = await processAudioCapture(
                {
                    bytes: audioBytes,
                    mimeType: 'audio/wav',
                    name: 'description-audio.wav',
                    path: capture.path,
                },
                {
                    ...speechConfig,
                    mode: 'transcribe_only',
                    fieldStrategy: 'description_only',
                    now: new Date(),
                    timeZone,
                },
            );
            const transcript = (result.description || result.transcript || '').trim();
            if (!transcript) {
                throw new Error(tFallback(t, 'attachments.transcriptionFailed', 'Transcription failed. Please try again.'));
            }
            insertDescriptionTranscript(transcript);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setDescriptionAudioError(message || tFallback(t, 'attachments.transcriptionFailed', 'Transcription failed. Please try again.'));
        } finally {
            if (capture?.path) {
                remove(capture.path).catch((error) => {
                    void logWarn('Description audio cleanup failed', {
                        scope: 'audio',
                        extra: { error: error instanceof Error ? error.message : String(error) },
                    });
                });
            }
            setDescriptionAudioState('idle');
        }
    }, [descriptionAudioState, insertDescriptionTranscript, t]);
    const handleEditDescriptionFromPreview = (source?: HTMLElement) => {
        const scrollSnapshot = captureScrollSnapshot(source);
        editDescriptionFromPreview();
        restoreScrollSnapshotSoon(scrollSnapshot);
        requestAnimationFrame(() => {
            const textarea = descriptionTextareaRef.current;
            if (!textarea) return;
            focusElementWithoutScroll(textarea, scrollSnapshot);
            restoreScrollSnapshotSoon(scrollSnapshot);
        });
    };
    const dateInputClassName = 'min-w-0 flex-1 text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground';
    const timeInputClassName = 'w-24 shrink-0 text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground';
    const dateIssueLabel = getTaskDateCoherenceIssues({
        startTime: editStartTime || undefined,
        dueDate: editDueDate || undefined,
    }).some((issue) => issue.code === 'start_after_due')
        ? tFallback(t, 'task.dateIssue.startAfterDue', 'Starts after due date')
        : '';
    const renderDateField = ({
        label,
        labelToken,
        dateAriaLabel,
        dateValue,
        selectedDate,
        onDateChange,
        timeInput,
        onClear,
        onDateOnly,
        hasValue,
        warning,
    }: {
        label: string;
        labelToken?: string;
        dateAriaLabel: string;
        dateValue: string;
        selectedDate: Date | null;
        onDateChange: (value: string) => void;
        timeInput: ReactNode;
        onClear: () => void;
        onDateOnly?: () => void;
        hasValue: boolean;
        warning?: string;
    }) => (
        <div className="space-y-1">
            <DateField
                t={t}
                label={label}
                labelToken={labelToken}
                dateAriaLabel={dateAriaLabel}
                dateValue={dateValue}
                selectedDate={selectedDate}
                dateFormatSetting={dateFormatSetting}
                nativeDateInputLocale={nativeDateInputLocale}
                dateInputClassName={dateInputClassName}
                timeInput={timeInput}
                onDateChange={onDateChange}
                onClear={onClear}
                onDateOnly={onDateOnly}
                hasValue={hasValue}
            />
            {warning && (
                <p className="text-xs text-warning" role="note">
                    {warning}
                </p>
            )}
        </div>
    );

    switch (fieldId) {
        case 'description':
            return (
                <DescriptionField
                    t={t}
                    taskTitle={task.title}
                    taskId={taskId}
                    showDescriptionPreview={showDescriptionPreview}
                    editDescription={editDescription}
                    isRtl={isRtl}
                    resolvedDirection={resolvedDirection}
                    descriptionExpanded={descriptionExpanded}
                    descriptionUndoDepth={descriptionUndoDepth}
                    descriptionTextareaRef={descriptionTextareaRef}
                    descriptionSelection={descriptionSelectionRef.current}
                    descriptionAutocomplete={descriptionAutocomplete}
                    descriptionAudioState={descriptionAudioState}
                    descriptionAudioError={descriptionAudioError}
                    onTogglePreview={toggleDescriptionPreview}
                    onEditFromPreview={handleEditDescriptionFromPreview}
                    onExpand={() => setDescriptionExpanded(true)}
                    onCloseExpanded={() => setDescriptionExpanded(false)}
                    onDescriptionInput={handleDescriptionInput}
                    onDescriptionChange={applyDescriptionValue}
                    onSelectionChange={(selection) => {
                        descriptionSelectionRef.current = selection;
                        if (isRangeSelection(selection)) {
                            lastDescriptionPairSelectionRef.current = null;
                        }
                    }}
                    onUndo={handleDescriptionUndo}
                    onApplyAction={handleDescriptionApplyAction}
                    onKeyDown={handleDescriptionKeyDown}
                    onPaste={handleDescriptionPaste}
                    onDescriptionAudioInput={handleDescriptionAudioInput}
                />
            );
        case 'attachments':
            return (
                <AttachmentsField
                    t={t}
                    attachmentError={attachmentError}
                    visibleEditAttachments={visibleEditAttachments}
                    addFileAttachment={addFileAttachment}
                    addLinkAttachment={addLinkAttachment}
                    addObsidianNoteAttachment={addObsidianNoteAttachment}
                    showObsidianNoteAttachment={showObsidianNoteAttachment}
                    editLinkAttachment={editLinkAttachment}
                    openAttachment={openAttachment}
                    removeAttachment={removeAttachment}
                />
            );
        case 'startTime':
            return (
                <div className="space-y-4">
                    {renderDateField({
                        label: tFallback(t, 'planning.available', 'Available from'),
                        dateAriaLabel: tFallback(t, 'planning.available', 'Available from'),
                        dateValue: splitDateTime(editStartTime).date,
                        selectedDate: safeParseDate(editStartTime),
                        onDateChange: (value) => setEditStartTime(joinDateTime(normalizeDateInputValue(value), splitDateTime(editStartTime).time)),
                        timeInput: (
                            <input type="time" aria-label={tFallback(t, 'planning.availableTime', 'Available time')}
                                value={splitDateTime(editStartTime).time}
                                onChange={(event) => setEditStartTime(joinDateTime(splitDateTime(editStartTime).date || safeFormatDate(new Date(), 'yyyy-MM-dd'), event.target.value))}
                                className={timeInputClassName} />
                        ),
                        onClear: () => setEditStartTime(''),
                        onDateOnly: splitDateTime(editStartTime).time ? () => setEditStartTime(splitDateTime(editStartTime).date) : undefined,
                        hasValue: Boolean(editStartTime),
                        warning: dateIssueLabel,
                    })}
                    <label className="block space-y-1 text-sm text-muted-foreground">
                        <span>{tFallback(t, 'planning.timeBlock', 'Time block')}</span>
                        <input type="datetime-local"
                            aria-label={tFallback(t, 'planning.timeBlock', 'Time block')}
                            value={draft.scheduledAt}
                            onChange={(event) => setField('scheduledAt', event.target.value)}
                            className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-foreground" />
                    </label>
                    {draft.scheduledAt && (
                        <button type="button" onClick={() => setField('scheduledAt', '')}
                            className="min-h-11 text-sm text-muted-foreground hover:text-foreground">
                            {t('calendar.unschedule')}
                        </button>
                    )}
                </div>
            );
        case 'dueDate':
            {
                const { date: dateValue, time: timeValue } = splitDateTime(editDueDate);
                const hasTime = Boolean(timeValue);
                const parsed = editDueDate ? safeParseDate(editDueDate) : null;
                const updateDueDate = (nextDueDate: string) => {
                    setEditDueDate(nextDueDate);
                    if (!editRelativeStartOffset) return;
                    if (!nextDueDate) {
                        setEditRelativeStartOffset(undefined);
                        return;
                    }
                    const computedStart = computeRelativeStartTime(nextDueDate, editRelativeStartOffset);
                    if (computedStart) {
                        setEditStartTime(computedStart);
                    } else {
                        setEditRelativeStartOffset(undefined);
                    }
                };
                const handleDateChange = (value: string) => {
                    const normalizedDate = normalizeDateInputValue(value);
                    updateDueDate(joinDateTime(normalizedDate, timeValue, { defaultTime: defaultScheduleTime }));
                };
                const handleTimeChange = (value: string) => {
                    const datePart = dateValue || (value ? safeFormatDate(new Date(), 'yyyy-MM-dd') : '');
                    updateDueDate(joinDateTime(datePart, value));
                };
                return (
                    <>
                        {renderDateField({
                            label: t('taskEdit.dueDateLabel'),
                            labelToken: QUICK_ADD_FIELD_TOKENS.dueDate,
                            dateAriaLabel: t('task.aria.dueDate'),
                            dateValue,
                            selectedDate: parsed,
                            onDateChange: handleDateChange,
                            timeInput: (
                                <input
                                    type="time"
                                    onClick={openNativePickerOnClick}
                                    lang={nativeDateInputLocale}
                                    aria-label={t('task.aria.dueTime')}
                                    value={timeValue}
                                    onChange={(event) => handleTimeChange(event.target.value)}
                                    className={timeInputClassName}
                                />
                            ),
                            onClear: () => updateDueDate(''),
                            onDateOnly: hasTime ? () => handleTimeChange('') : undefined,
                            hasValue: Boolean(editDueDate),
                            warning: dateIssueLabel,
                        })}
                        {hasTime && (
                            <label className="mt-1 flex items-start gap-2 rounded border border-border/70 bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                                <input
                                    type="checkbox"
                                    checked={editSuppressMindwtrReminders}
                                    onChange={(event) => setEditSuppressMindwtrReminders(event.target.checked)}
                                    className="mt-0.5 shrink-0 accent-primary"
                                />
                                <span className="min-w-0">
                                    <span className="block font-medium text-foreground">
                                        {tFallback(t, 'taskEdit.suppressMindwtrReminders', 'Skip reminders')}
                                    </span>
                                    <span className="block leading-snug">
                                        {tFallback(t, 'taskEdit.suppressMindwtrRemindersHint', 'Skip start and due reminders for this task. It still appears in Focus and your lists.')}
                                    </span>
                                </span>
                            </label>
                        )}
                        {hasTime && !editSuppressMindwtrReminders && (() => {
                            const label = tFallback(t, 'taskEdit.repeatReminderLabel', 'Repeat reminder');
                            const current = editRepeatReminderMinutes ?? 0;
                            const formatValue = (minutes: number) => (
                                minutes === 0
                                    ? tFallback(t, 'taskEdit.repeatReminderOff', 'Off')
                                    : tFallback(t, 'taskEdit.repeatReminderEveryMinutes', 'Every {count} min').replace('{count}', String(minutes))
                            );
                            const formatOption = (minutes: number) => (
                                minutes === 0
                                    ? tFallback(t, 'taskEdit.repeatReminderOff', 'Off')
                                    : tFallback(t, 'taskEdit.repeatReminderMinutesShort', '{count} min').replace('{count}', String(minutes))
                            );
                            return (
                                <div className="mt-1 space-y-1.5">
                                    <button
                                        type="button"
                                        aria-label={`${label}: ${formatValue(current)}`}
                                        aria-expanded={repeatReminderOptionsExpanded}
                                        className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs transition-colors ${repeatReminderOptionsExpanded || current > 0
                                            ? 'border-primary/60 bg-primary/10'
                                            : 'border-border bg-muted/30 hover:bg-muted/50'
                                            }`}
                                        onClick={() => setRepeatReminderOptionsExpanded((expanded) => !expanded)}
                                    >
                                        <span className="min-w-0 truncate font-medium text-foreground">{label}</span>
                                        <span className={current > 0 ? 'shrink-0 text-primary' : 'shrink-0 text-muted-foreground'}>
                                            {formatValue(current)}
                                        </span>
                                    </button>
                                    {repeatReminderOptionsExpanded && (
                                        <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
                                            {[0, ...REPEAT_REMINDER_INTERVAL_OPTIONS].map((minutes) => {
                                                const active = current === minutes;
                                                return (
                                                    <button
                                                        key={minutes}
                                                        type="button"
                                                        aria-pressed={active}
                                                        className={`rounded border px-2 py-1 text-xs transition-colors ${active
                                                            ? 'border-primary bg-primary text-primary-foreground'
                                                            : 'border-border bg-muted/40 text-foreground hover:bg-muted'
                                                            }`}
                                                        onClick={() => {
                                                            setEditRepeatReminderMinutes(minutes > 0 ? minutes : undefined);
                                                            setRepeatReminderOptionsExpanded(false);
                                                        }}
                                                    >
                                                        {formatOption(minutes)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </>
                );
            }
        case 'reviewAt':
            {
                const { date: dateValue, time: timeValue } = splitDateTime(editReviewAt);
                const hasTime = Boolean(timeValue);
                const parsed = editReviewAt ? safeParseDate(editReviewAt) : null;
                const handleDateChange = (value: string) => {
                    const normalizedDate = normalizeDateInputValue(value);
                    setEditReviewAt(joinDateTime(normalizedDate, timeValue, { defaultTime: defaultScheduleTime }));
                };
                const handleTimeChange = (value: string) => {
                    const datePart = dateValue || (value ? safeFormatDate(new Date(), 'yyyy-MM-dd') : '');
                    setEditReviewAt(joinDateTime(datePart, value));
                };
                return renderDateField({
                    label: t('taskEdit.reviewDateLabel'),
                    labelToken: QUICK_ADD_FIELD_TOKENS.reviewAt,
                    dateAriaLabel: t('task.aria.reviewDate'),
                    dateValue,
                    selectedDate: parsed,
                    onDateChange: handleDateChange,
                    timeInput: (
                        <input
                            type="text"
                            aria-label={t('task.aria.reviewTime')}
                            value={reviewTimeDraft}
                            inputMode="numeric"
                            placeholder="HH:MM"
                            onChange={(event) => setReviewTimeDraft(event.target.value)}
                            onBlur={() => {
                                const normalized = normalizeClockTimeInput(reviewTimeDraft);
                                if (normalized === null) {
                                    setReviewTimeDraft(timeValue);
                                    return;
                                }
                                setReviewTimeDraft(normalized);
                                handleTimeChange(normalized);
                            }}
                            className={timeInputClassName}
                        />
                    ),
                    onClear: () => setEditReviewAt(''),
                    onDateOnly: hasTime
                        ? () => {
                            setReviewTimeDraft('');
                            handleTimeChange('');
                        }
                        : undefined,
                    hasValue: Boolean(editReviewAt),
                });
            }
        case 'status':
            return (
                <StatusField
                    t={t}
                    value={editStatus}
                    onChange={setEditStatus}
                    onRequestBackdatedComplete={requestBackdatedComplete}
                />
            );
        case 'priority':
            return <PriorityField t={t} value={editPriority} onChange={setEditPriority} />;
        case 'energyLevel':
            return <EnergyLevelField t={t} value={editEnergyLevel} onChange={setEditEnergyLevel} />;
        case 'assignedTo':
            return <AssignedToField t={t} value={editAssignedTo} options={assignedToOptions} onChange={setEditAssignedTo} onCreatePerson={createAssignedToPerson} />;
        case 'recurrence':
            return (
                <RecurrenceField
                    t={t}
                    editRecurrence={editRecurrence}
                    editRecurrenceStrategy={editRecurrenceStrategy}
                    editRecurrenceRRule={editRecurrenceRRule}
                    editShowFutureRecurrence={editShowFutureRecurrence}
                    monthlyRecurrence={monthlyRecurrence}
                    parsedRecurrenceRRule={parsedRecurrenceRRule}
                    recurrenceEndMode={recurrenceEndMode}
                    recurrenceDefaultEndDate={recurrenceDefaultEndDate}
                    projectedRecurrenceDateLabel={projectedRecurrenceDateLabel}
                    onRecurrenceChange={setEditRecurrence}
                    onRecurrenceStrategyChange={setEditRecurrenceStrategy}
                    onRecurrenceRRuleChange={setEditRecurrenceRRule}
                    onShowFutureRecurrenceChange={setEditShowFutureRecurrence}
                    openCustomRecurrence={openCustomRecurrence}
                    buildRecurrenceRRule={buildRecurrenceRRule}
                />
            );
        case 'timeEstimate':
            // Time spent is opt-in: it only appears while the Pomodoro timer's
            // task linking is engaged, so the default editor stays estimate-only.
            if (!timeSpentEnabled) {
                return <TimeEstimateField t={t} value={editTimeEstimate} onChange={setEditTimeEstimate} />;
            }
            return (
                <div className="flex gap-2 w-full">
                    <TimeEstimateField t={t} value={editTimeEstimate} onChange={setEditTimeEstimate} />
                    <TimeSpentField t={t} value={editTimeSpentMinutes} onChange={setEditTimeSpentMinutes} />
                </div>
            );
        case 'contexts':
            return (
                <ContextsField
                    t={t}
                    value={editContexts}
                    options={popularContextOptions}
                    suggestions={allContextOptions}
                    onChange={setEditContexts}
                />
            );
        case 'tags':
            return (
                <TagsField
                    t={t}
                    value={editTags}
                    options={popularTagOptions}
                    suggestions={allTagOptions}
                    onChange={setEditTags}
                />
            );
        case 'location':
            return (
                <div className="flex flex-col gap-1">
                    <label className={taskEditorLabelClassName}>{t('taskEdit.locationLabel')}</label>
                    <input
                        type="text"
                        aria-label={t('task.aria.location')}
                        value={editLocation}
                        onChange={(event) => setEditLocation(event.target.value)}
                        placeholder={t('taskEdit.locationPlaceholder')}
                        className="text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground placeholder:text-muted-foreground"
                    />
                </div>
            );
        case 'checklist':
            return (
                <ChecklistField
                    t={t}
                    taskId={taskId}
                    checklist={task.checklist}
                    updateTask={updateTask}
                    resetTaskChecklist={resetTaskChecklist}
                />
            );
        default:
            return null;
    }
}
