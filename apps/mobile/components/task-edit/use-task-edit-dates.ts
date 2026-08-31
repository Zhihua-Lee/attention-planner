import React from 'react';
import { Platform } from 'react-native';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { buildRRuleString, computeRelativeStartTime, hasTimeComponent, parseRRuleString, safeFormatDate, safeParseDate, safeParseDueDate } from '@mindwtr/core';
import type { TaskDraft, TaskDraftSetter } from '@mindwtr/core/task-draft';


type TaskEditDatePickerMode = 'start' | 'start-time' | 'schedule' | 'schedule-time' | 'due' | 'due-time' | 'review' | 'recurrence-end';

type UseTaskEditDatesParams = {
    draft: TaskDraft | null;
    pendingDueDate: Date | null;
    pendingStartDate: Date | null;
    setDraftField: TaskDraftSetter;
    setPendingDueDate: React.Dispatch<React.SetStateAction<Date | null>>;
    setPendingStartDate: React.Dispatch<React.SetStateAction<Date | null>>;
    setShowDatePicker: React.Dispatch<React.SetStateAction<TaskEditDatePickerMode | null>>;
    showDatePicker: TaskEditDatePickerMode | null;
    defaultScheduleTime?: string;
    t: (key: string) => string;
};

const buildDateWithTimeValue = (date: Date, time: string): string => {
    const dateOnly = safeFormatDate(date, 'yyyy-MM-dd');
    return time ? `${dateOnly}T${time}` : dateOnly;
};

const applyClockTime = (date: Date, time: string): Date => {
    const combined = new Date(date);
    const [hour, minute] = time.split(':').map((part) => Number.parseInt(part, 10));
    combined.setHours(
        Number.isFinite(hour) ? hour : 0,
        Number.isFinite(minute) ? minute : 0,
        0,
        0
    );
    return combined;
};


const applyAvailableAtUpdate = (setDraftField: TaskDraftSetter, availableAt: string) => {
    setDraftField('availableAt', availableAt);
    setDraftField('relativeStartOffset', undefined);
};

const applyScheduledAtUpdate = (setDraftField: TaskDraftSetter, scheduledAt: string) => {
    setDraftField('scheduledAt', scheduledAt);
};

const applyDueDateUpdate = (draft: TaskDraft | null, setDraftField: TaskDraftSetter, dueDate: string) => {
    setDraftField('dueDate', dueDate);
    if (!dueDate) {
        setDraftField('relativeStartOffset', undefined);
        return;
    }
    const computedStart = computeRelativeStartTime(dueDate, draft?.relativeStartOffset);
    if (computedStart) setDraftField('availableAt', computedStart);
};

export function useTaskEditDates({
    draft,
    pendingDueDate,
    pendingStartDate,
    setDraftField,
    setPendingDueDate,
    setPendingStartDate,
    setShowDatePicker,
    showDatePicker,
    defaultScheduleTime = '',
    t,
}: UseTaskEditDatesParams) {
    const updateRecurrenceEndDate = React.useCallback((until: string) => {
        if (!draft?.recurrence) return;
        const parsed = parseRRuleString(draft.recurrenceRRule);
        setDraftField('recurrenceRRule', buildRRuleString(
            draft.recurrence,
            parsed.byDay,
            parsed.interval,
            { byMonthDay: parsed.byMonthDay, until },
        ));
    }, [draft?.recurrence, draft?.recurrenceRRule, setDraftField]);

    const applySelectedDate = React.useCallback((
        currentMode: TaskEditDatePickerMode,
        selectedDate: Date,
        closePicker: boolean
    ) => {
        if (currentMode === 'start') {
            const dateOnly = safeFormatDate(selectedDate, 'yyyy-MM-dd');
            const existing = draft?.availableAt && hasTimeComponent(draft.availableAt)
                ? safeParseDate(draft.availableAt)
                : null;
            if (existing) {
                const combined = new Date(selectedDate);
                combined.setHours(existing.getHours(), existing.getMinutes(), 0, 0);
                setPendingStartDate(combined);
                applyAvailableAtUpdate(setDraftField, combined.toISOString());
            } else {
                setPendingStartDate(new Date(selectedDate));
                applyAvailableAtUpdate(setDraftField, dateOnly);
            }
            if (closePicker) setShowDatePicker(null);
            return;
        }

        if (currentMode === 'start-time') {
            const base = pendingStartDate ?? safeParseDate(draft?.availableAt) ?? new Date();
            const combined = new Date(base);
            combined.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
            applyAvailableAtUpdate(setDraftField, combined.toISOString());
            setPendingStartDate(null);
            if (closePicker) setShowDatePicker(null);
            return;
        }

        if (currentMode === 'schedule') {
            const existing = draft?.scheduledAt && hasTimeComponent(draft.scheduledAt)
                ? safeParseDate(draft.scheduledAt)
                : null;
            if (existing) {
                const combined = new Date(selectedDate);
                combined.setHours(existing.getHours(), existing.getMinutes(), 0, 0);
                setPendingStartDate(combined);
                applyScheduledAtUpdate(setDraftField, combined.toISOString());
            } else {
                const time = defaultScheduleTime || '09:00';
                const combined = applyClockTime(selectedDate, time);
                setPendingStartDate(combined);
                applyScheduledAtUpdate(setDraftField, buildDateWithTimeValue(selectedDate, time));
            }
            if (closePicker) setShowDatePicker(null);
            return;
        }

        if (currentMode === 'schedule-time') {
            const base = pendingStartDate ?? safeParseDate(draft?.scheduledAt) ?? new Date();
            const combined = new Date(base);
            combined.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
            applyScheduledAtUpdate(setDraftField, combined.toISOString());
            setPendingStartDate(null);
            if (closePicker) setShowDatePicker(null);
            return;
        }

        if (currentMode === 'review') {
            const dateOnly = safeFormatDate(selectedDate, 'yyyy-MM-dd');
            const existing = draft?.reviewAt && hasTimeComponent(draft.reviewAt)
                ? safeParseDate(draft.reviewAt)
                : null;
            if (existing) {
                const existingTime = safeFormatDate(existing, 'HH:mm');
                setDraftField('reviewAt', buildDateWithTimeValue(selectedDate, existingTime));
            } else if (defaultScheduleTime) {
                setDraftField('reviewAt', buildDateWithTimeValue(selectedDate, defaultScheduleTime));
            } else {
                setDraftField('reviewAt', dateOnly);
            }
            if (closePicker) setShowDatePicker(null);
            return;
        }

        if (currentMode === 'recurrence-end') {
            updateRecurrenceEndDate(safeFormatDate(selectedDate, 'yyyy-MM-dd'));
            if (closePicker) setShowDatePicker(null);
            return;
        }

        if (currentMode === 'due') {
            const dateOnly = safeFormatDate(selectedDate, 'yyyy-MM-dd');
            const existing = draft?.dueDate && hasTimeComponent(draft.dueDate)
                ? safeParseDate(draft.dueDate)
                : null;
            if (existing) {
                const combined = new Date(selectedDate);
                combined.setHours(existing.getHours(), existing.getMinutes(), 0, 0);
                setPendingDueDate(combined);
                applyDueDateUpdate(draft, setDraftField, combined.toISOString());
            } else if (defaultScheduleTime) {
                const combined = applyClockTime(selectedDate, defaultScheduleTime);
                setPendingDueDate(combined);
                applyDueDateUpdate(draft, setDraftField, buildDateWithTimeValue(selectedDate, defaultScheduleTime));
            } else {
                setPendingDueDate(new Date(selectedDate));
                applyDueDateUpdate(draft, setDraftField, dateOnly);
            }
            if (closePicker) setShowDatePicker(null);
            return;
        }

        const base = pendingDueDate ?? safeParseDate(draft?.dueDate) ?? new Date();
        const combined = new Date(base);
        combined.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
        applyDueDateUpdate(draft, setDraftField, combined.toISOString());
        setPendingDueDate(null);
        if (closePicker) setShowDatePicker(null);
    }, [
        draft,
        defaultScheduleTime,
        pendingDueDate,
        pendingStartDate,
        setDraftField,
        setPendingDueDate,
        setPendingStartDate,
        setShowDatePicker,
        updateRecurrenceEndDate,
    ]);

    const applyQuickDate = React.useCallback((
        mode: Extract<TaskEditDatePickerMode, 'start' | 'due' | 'review'>,
        selectedDate: Date | null
    ) => {
        if (!selectedDate) {
            if (mode === 'start') {
                setPendingStartDate(null);
                applyAvailableAtUpdate(setDraftField, '');
            } else if (mode === 'due') {
                setPendingDueDate(null);
                applyDueDateUpdate(draft, setDraftField, '');
            } else {
                setDraftField('reviewAt', '');
            }
            setShowDatePicker(null);
            return;
        }

        applySelectedDate(mode, selectedDate, true);
    }, [
        applySelectedDate,
        draft,
        setDraftField,
        setPendingDueDate,
        setPendingStartDate,
        setShowDatePicker,
    ]);

    const onDateChange = React.useCallback((event: DateTimePickerEvent, selectedDate?: Date) => {
        const currentMode = showDatePicker;
        if (!currentMode) return;

        if (event.type === 'dismissed') {
            if (currentMode === 'start-time' || currentMode === 'schedule-time') setPendingStartDate(null);
            if (currentMode === 'due-time') setPendingDueDate(null);
            setShowDatePicker(null);
            return;
        }

        if (!selectedDate) return;
        applySelectedDate(currentMode, selectedDate, Platform.OS === 'android');
    }, [
        applySelectedDate,
        setPendingDueDate,
        setPendingStartDate,
        setShowDatePicker,
        showDatePicker,
    ]);

    const formatDate = React.useCallback((dateStr?: string) => {
        if (!dateStr) return t('common.notSet');
        const parsed = safeParseDate(dateStr);
        if (!parsed) return t('common.notSet');
        const hasTime = hasTimeComponent(dateStr);
        return safeFormatDate(parsed, hasTime ? 'P p' : 'P', t('common.notSet')) || t('common.notSet');
    }, [t]);

    const formatDueDate = React.useCallback((dateStr?: string) => {
        if (!dateStr) return t('common.notSet');
        const parsed = safeParseDueDate(dateStr);
        if (!parsed) return t('common.notSet');
        const hasTime = hasTimeComponent(dateStr);
        return safeFormatDate(parsed, hasTime ? 'P p' : 'P', t('common.notSet')) || t('common.notSet');
    }, [t]);

    const getSafePickerDateValue = React.useCallback((dateStr?: string) => {
        if (!dateStr) return new Date();
        const parsed = safeParseDate(dateStr);
        if (!parsed) return new Date();
        return parsed;
    }, []);

    return {
        applyQuickDate,
        formatDate,
        formatDueDate,
        getSafePickerDateValue,
        onDateChange,
    };
}
