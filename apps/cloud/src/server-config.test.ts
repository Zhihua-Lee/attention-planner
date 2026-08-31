import { describe, expect, it } from 'vitest';
import { TASK_SYNC_FIELD_SCHEMA } from '@mindwtr/core/task-sync-schema';
import { PROJECT_SYNC_FIELD_SCHEMA } from '@mindwtr/core/project-sync-schema';
import { SECTION_SYNC_FIELD_SCHEMA } from '@mindwtr/core/section-sync-schema';
import {
    CLOUD_PROJECT_CREATION_ALLOWED_PROP_KEYS,
    CLOUD_PROJECT_PATCH_ALLOWED_PROP_KEYS,
    CLOUD_SECTION_CREATION_ALLOWED_PROP_KEYS,
    CLOUD_SECTION_PATCH_ALLOWED_PROP_KEYS,
    CLOUD_TASK_CREATION_ALLOWED_PROP_KEYS,
    CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS,
} from './server-config';

const sorted = (values: Iterable<string>): string[] => Array.from(values).sort();

// Reviewed allowlist baseline. The generative schema must stay aligned with
// the former hand-written fields plus intentional, separately reviewed schema
// extensions such as the 2026-08 split task-time patch fields.
const EXPECTED_CLOUD_TASK_CREATION_ALLOWED_PROP_KEYS = [
    'status', 'priority', 'taskMode', 'startTime', 'relativeStartOffset', 'dueDate', 'recurrence',
    'showFutureRecurrence', 'pushCount', 'tags', 'contexts', 'checklist', 'description',
    'textDirection', 'attachments', 'location', 'projectId', 'sectionId', 'areaId',
    'isFocusedToday', 'energyLevel', 'assignedTo', 'timeEstimate', 'timeSpentMinutes', 'reviewAt',
    'suppressMindwtrReminders', 'repeatReminderMinutes',
];

const EXPECTED_CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS = [
    'title', 'order', 'orderNum', 'boardOrder', 'focusOrder',
    'availableAt', 'scheduledAt', 'snoozedUntil',
    ...EXPECTED_CLOUD_TASK_CREATION_ALLOWED_PROP_KEYS,
];

describe('cloud Task schema contract', () => {
    it('keeps creation validation aligned with schema write semantics', () => {
        const expected = TASK_SYNC_FIELD_SCHEMA
            .filter((field) => field.cloudWrite === 'create-patch')
            .map((field) => field.name);

        expect(sorted(CLOUD_TASK_CREATION_ALLOWED_PROP_KEYS)).toEqual(sorted(expected));
    });

    it('keeps patch validation aligned with schema write semantics', () => {
        const expected = TASK_SYNC_FIELD_SCHEMA
            .filter((field) => field.cloudWrite === 'create-patch' || field.cloudWrite === 'patch')
            .map((field) => field.name);

        expect(sorted(CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS)).toEqual(sorted(expected));
    });

    it('derives CLOUD_TASK_CREATION_ALLOWED_PROP_KEYS from the reviewed allowlist', () => {
        expect(sorted(CLOUD_TASK_CREATION_ALLOWED_PROP_KEYS)).toEqual(sorted(EXPECTED_CLOUD_TASK_CREATION_ALLOWED_PROP_KEYS));
    });

    it('derives CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS from the reviewed allowlist', () => {
        expect(sorted(CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS)).toEqual(sorted(EXPECTED_CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS));
    });
});

// Frozen snapshot of the pre-refactor hand-written literals (parity-entities follow-up to the
// 2026-07-20 generative-schema refactor). CLOUD_PROJECT_*/CLOUD_SECTION_* allowlists are now
// derived from PROJECT_SYNC_FIELD_SCHEMA / SECTION_SYNC_FIELD_SCHEMA's cloudWrite flag instead
// of hand-maintained Sets. Do not update these lists to match a schema change — grow the
// schema and leave this alone, the same as EXPECTED_CLOUD_TASK_* above.
const PRE_REFACTOR_CLOUD_PROJECT_CREATION_ALLOWED_PROP_KEYS = [
    'status', 'color', 'order', 'tagIds', 'isSequential', 'taskSortBy', 'isFocused',
    'supportNotes', 'attachments', 'dueDate', 'reviewAt', 'areaId', 'areaTitle',
];

const PRE_REFACTOR_CLOUD_PROJECT_PATCH_ALLOWED_PROP_KEYS = [
    'title', 'deletedAt', 'purgedAt',
    ...PRE_REFACTOR_CLOUD_PROJECT_CREATION_ALLOWED_PROP_KEYS,
];

const PRE_REFACTOR_CLOUD_SECTION_CREATION_ALLOWED_PROP_KEYS = [
    'description', 'order', 'isCollapsed',
];

const PRE_REFACTOR_CLOUD_SECTION_PATCH_ALLOWED_PROP_KEYS = [
    'projectId', 'title',
    ...PRE_REFACTOR_CLOUD_SECTION_CREATION_ALLOWED_PROP_KEYS,
];

describe('cloud Project schema contract', () => {
    it('keeps creation validation aligned with schema write semantics', () => {
        const expected = PROJECT_SYNC_FIELD_SCHEMA
            .filter((field) => field.cloudWrite === 'create-patch')
            .map((field) => field.name);

        expect(sorted(CLOUD_PROJECT_CREATION_ALLOWED_PROP_KEYS)).toEqual(sorted(expected));
    });

    it('keeps patch validation aligned with schema write semantics', () => {
        const expected = PROJECT_SYNC_FIELD_SCHEMA
            .filter((field) => field.cloudWrite === 'create-patch' || field.cloudWrite === 'patch')
            .map((field) => field.name);

        expect(sorted(CLOUD_PROJECT_PATCH_ALLOWED_PROP_KEYS)).toEqual(sorted(expected));
    });

    it('derives CLOUD_PROJECT_CREATION_ALLOWED_PROP_KEYS identical to the pre-refactor literal', () => {
        expect(sorted(CLOUD_PROJECT_CREATION_ALLOWED_PROP_KEYS)).toEqual(sorted(PRE_REFACTOR_CLOUD_PROJECT_CREATION_ALLOWED_PROP_KEYS));
    });

    it('derives CLOUD_PROJECT_PATCH_ALLOWED_PROP_KEYS identical to the pre-refactor literal', () => {
        expect(sorted(CLOUD_PROJECT_PATCH_ALLOWED_PROP_KEYS)).toEqual(sorted(PRE_REFACTOR_CLOUD_PROJECT_PATCH_ALLOWED_PROP_KEYS));
    });
});

describe('cloud Section schema contract', () => {
    it('keeps creation validation aligned with schema write semantics', () => {
        const expected = SECTION_SYNC_FIELD_SCHEMA
            .filter((field) => field.cloudWrite === 'create-patch')
            .map((field) => field.name);

        expect(sorted(CLOUD_SECTION_CREATION_ALLOWED_PROP_KEYS)).toEqual(sorted(expected));
    });

    it('keeps patch validation aligned with schema write semantics', () => {
        const expected = SECTION_SYNC_FIELD_SCHEMA
            .filter((field) => field.cloudWrite === 'create-patch' || field.cloudWrite === 'patch')
            .map((field) => field.name);

        expect(sorted(CLOUD_SECTION_PATCH_ALLOWED_PROP_KEYS)).toEqual(sorted(expected));
    });

    it('derives CLOUD_SECTION_CREATION_ALLOWED_PROP_KEYS identical to the pre-refactor literal', () => {
        expect(sorted(CLOUD_SECTION_CREATION_ALLOWED_PROP_KEYS)).toEqual(sorted(PRE_REFACTOR_CLOUD_SECTION_CREATION_ALLOWED_PROP_KEYS));
    });

    it('derives CLOUD_SECTION_PATCH_ALLOWED_PROP_KEYS identical to the pre-refactor literal', () => {
        expect(sorted(CLOUD_SECTION_PATCH_ALLOWED_PROP_KEYS)).toEqual(sorted(PRE_REFACTOR_CLOUD_SECTION_PATCH_ALLOWED_PROP_KEYS));
    });
});
