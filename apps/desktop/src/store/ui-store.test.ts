import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DONE_AXES, FOCUS_AXES, REFERENCE_AXES } from '../components/views/list/next-grouping';

// The `===` chains these sanitizers used before the rosters were unified,
// copied verbatim. Shipped builds persisted exactly what these accepted, so
// anything they accept must still hydrate — a narrower roster would silently
// reset a real user's saved grouping on next launch.
const legacyAcceptedNextGroupBy = (value: unknown): boolean => (
    value === 'none'
    || value === 'context'
    || value === 'area'
    || value === 'project'
    || value === 'energy'
    || value === 'priority'
    || value === 'person'
    || value === 'tag'
);

const legacyAcceptedReferenceGroupBy = (value: unknown): boolean => (
    value === 'none'
    || value === 'context'
    || value === 'area'
    || value === 'project'
    || value === 'tag'
);

async function hydrate(stored: Record<string, unknown>) {
    window.localStorage.clear();
    vi.resetModules();
    window.localStorage.setItem('mindwtr:list-options:v1', JSON.stringify(stored));
    const { useUiStore } = await import('./ui-store');
    return useUiStore.getState().listOptions;
}

describe('useUiStore list options', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.resetModules();
    });

    it('hydrates persisted Focus/list view options', async () => {
        window.localStorage.setItem('mindwtr:list-options:v1', JSON.stringify({
            showDetails: true,
            nextGroupBy: 'project',
            referenceGroupBy: 'context',
            focusTop3Only: true,
        }));

        const { useUiStore } = await import('./ui-store');

        expect(useUiStore.getState().listOptions).toEqual({
            showDetails: true,
            nextGroupBy: 'project',
            referenceGroupBy: 'context',
            // Written by a build that predates the Done axis: defaulted, not undefined.
            doneGroupBy: 'none',
            focusTop3Only: true,
        });
    });

    it('persists Focus/list view options on change', async () => {
        const { LIST_OPTIONS_STORAGE_KEY, useUiStore } = await import('./ui-store');

        useUiStore.getState().setListOptions({
            showDetails: true,
            nextGroupBy: 'project',
            referenceGroupBy: 'tag',
            doneGroupBy: 'completedDate',
            doneSortBy: 'completed',
            focusTop3Only: true,
        });

        expect(JSON.parse(window.localStorage.getItem(LIST_OPTIONS_STORAGE_KEY) || '{}')).toEqual({
            showDetails: true,
            nextGroupBy: 'project',
            referenceGroupBy: 'tag',
            doneGroupBy: 'completedDate',
            doneSortBy: 'completed',
            focusTop3Only: true,
        });
    });

    it('hydrates every axis a shipped build could have persisted', async () => {
        for (const axis of FOCUS_AXES) {
            expect((await hydrate({ nextGroupBy: axis })).nextGroupBy).toBe(axis);
        }
        for (const axis of REFERENCE_AXES) {
            expect((await hydrate({ referenceGroupBy: axis })).referenceGroupBy).toBe(axis);
        }
        for (const axis of DONE_AXES) {
            expect((await hydrate({ doneGroupBy: axis })).doneGroupBy).toBe(axis);
        }
    // One module reload per axis (13) — well under a second idle, but the
    // default 5s timeout is not enough when another suite has the CPU.
    }, 20000);

    it('accepts exactly what the pre-roster === chains accepted', () => {
        const candidates: unknown[] = [
            'none', 'context', 'area', 'project', 'tag', 'energy', 'priority', 'person',
            'status', 'due', '', ' none', 'NONE', null, undefined, 0, 1, true, [], {}, ['none'],
        ];

        for (const candidate of candidates) {
            expect([candidate, FOCUS_AXES.includes(candidate as never)])
                .toEqual([candidate, legacyAcceptedNextGroupBy(candidate)]);
            expect([candidate, REFERENCE_AXES.includes(candidate as never)])
                .toEqual([candidate, legacyAcceptedReferenceGroupBy(candidate)]);
        }
    });

    it('falls back for a stored axis outside the roster', async () => {
        const options = await hydrate({ nextGroupBy: 'status', referenceGroupBy: 'energy' });

        expect(options.nextGroupBy).toBe('none');
        expect(options.referenceGroupBy).toBe('area');
    });
});


describe('routine feedback', () => {
    it('coalesces save confirmations without dropping recovery actions or errors', async () => {
        vi.useFakeTimers();
        try {
            const { useUiStore } = await import('./ui-store');
            useUiStore.setState({ toasts: [] });
            const store = useUiStore.getState();
            const undo = vi.fn();
            store.showToast('Done', 'info', 12000, { label: 'Undo', onClick: undo });
            store.showToast('Connection failed', 'error');
            store.showToast('First reservation saved', 'success');
            store.showToast('Second reservation saved', 'success');
            expect(useUiStore.getState().toasts.map(t => t.message)).toEqual(['Done', 'Connection failed', 'Second reservation saved']);
            vi.advanceTimersByTime(3500);
            expect(useUiStore.getState().toasts.map(t => t.message)).toEqual(['Done']);
            useUiStore.getState().toasts[0].action!.onClick();
            expect(undo).toHaveBeenCalledOnce();
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });
});
