import { describe, expect, it } from 'vitest';
import { normalizeAttentionFrames, resolveActiveAttentionFrame, selectNow, type AttentionFrame } from './attention-frames';
import type { ExternalCalendarEvent } from './ics';
import type { Task } from './types';

const frame = (overrides: Partial<AttentionFrame> = {}): AttentionFrame => ({
    id: 'research',
    name: 'Research',
    startTime: '09:30',
    endTime: '12:00',
    days: [1, 2, 3, 4, 5],
    matchTokens: ['@research'],
    ...overrides,
});

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
    id,
    title: id,
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
});

describe('attention frames', () => {
    it('normalizes valid frames and drops unsafe values', () => {
        expect(normalizeAttentionFrames([
            frame({ matchTokens: [' @Research ', '@research'], color: '#ABCDEF' }),
            frame({ id: '' }),
            frame({ id: 'bad-time', startTime: '25:00' }),
        ])).toEqual([{
            ...frame(),
            matchTokens: ['@research'],
            color: '#abcdef',
        }]);
    });

    it('resolves daytime and overnight frames against their starting day', () => {
        expect(resolveActiveAttentionFrame([frame()], new Date(2026, 7, 24, 10, 0))?.id).toBe('research');
        expect(resolveActiveAttentionFrame([frame()], new Date(2026, 7, 24, 13, 0))).toBeNull();

        const overnight = frame({ id: 'sleep', startTime: '23:00', endTime: '07:00', days: [1] });
        expect(resolveActiveAttentionFrame([overnight], new Date(2026, 7, 24, 23, 30))?.id).toBe('sleep');
        expect(resolveActiveAttentionFrame([overnight], new Date(2026, 7, 25, 6, 30))?.id).toBe('sleep');
    });
});

describe('NOW selection', () => {
    const now = new Date('2026-08-24T15:00:00.000Z');

    it('puts a current calendar event ahead of tasks', () => {
        const event: ExternalCalendarEvent = {
            id: 'meeting',
            sourceId: 'outlook',
            title: 'Lab meeting',
            start: '2026-08-24T14:30:00.000Z',
            end: '2026-08-24T15:30:00.000Z',
            allDay: false,
        };
        expect(selectNow({ events: [event], now, tasks: [task('write')] })).toEqual({
            kind: 'event',
            event,
            reason: 'calendar-event',
        });
    });

    it('chooses a currently scheduled task before focused and frame tasks', () => {
        const scheduled = task('scheduled', { scheduledAt: '2026-08-24T14:50:00.000Z', timeEstimate: '30min' });
        const focused = task('focused', { isFocusedToday: true });
        expect(selectNow({ now, tasks: [focused, scheduled] })).toMatchObject({
            kind: 'task',
            reason: 'scheduled',
            task: { id: 'scheduled' },
        });
    });

    it('lets the active frame choose before a Today commitment, then falls back to that commitment', () => {
        const focused = task('focused', { isFocusedToday: true });
        expect(selectNow({ now, tasks: [task('plain'), focused] })).toMatchObject({
            reason: 'focused',
            task: { id: 'focused' },
        });

        const frameNow = new Date(2026, 7, 24, 11, 40);
        const tooLong = task('long', { contexts: ['@research'], timeEstimate: '1hr', priority: 'urgent' });
        const fits = task('fits', { contexts: ['@research'], timeEstimate: '15min' });
        expect(selectNow({ frames: [frame()], now: frameNow, tasks: [focused, tooLong, fits] })).toMatchObject({
            reason: 'frame',
            frame: { id: 'research' },
            task: { id: 'fits' },
        });
    });

    it('ignores snoozed tasks without changing their schedule', () => {
        const snoozed = task('snoozed', {
            scheduledAt: '2026-08-24T14:50:00.000Z',
            snoozedUntil: '2026-08-24T15:30:00.000Z',
            timeEstimate: '30min',
        });
        expect(selectNow({ now, tasks: [snoozed, task('fallback')] })).toMatchObject({
            reason: 'next-action',
            task: { id: 'fallback' },
        });
    });

    it('does not let a future time block enter ordinary NOW fallbacks early', () => {
        const future = task('future', {
            scheduledAt: '2026-08-24T16:00:00.000Z',
            isFocusedToday: true,
            priority: 'urgent',
        });
        expect(selectNow({ now, tasks: [future, task('available')] })).toMatchObject({
            reason: 'next-action',
            task: { id: 'available' },
        });
    });

    it('honors exclusions and falls back deterministically', () => {
        const first = task('first', { priority: 'urgent' });
        const second = task('second', { priority: 'low' });
        expect(selectNow({ excludedTaskIds: new Set(['first']), now, tasks: [first, second] })).toMatchObject({
            reason: 'next-action',
            task: { id: 'second' },
        });
    });
});
