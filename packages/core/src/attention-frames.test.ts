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
        const scheduled = task('scheduled', { startTime: '2026-08-24T14:50:00.000Z', timeEstimate: '30min' });
        const focused = task('focused', { isFocusedToday: true });
        expect(selectNow({ now, tasks: [focused, scheduled] })).toMatchObject({
            kind: 'task',
            reason: 'scheduled',
            task: { id: 'scheduled' },
        });
    });

    it('chooses focused work, then a matching frame task that fits the remaining window', () => {
        const focused = task('focused', { isFocusedToday: true });
        expect(selectNow({ now, tasks: [task('plain'), focused] })).toMatchObject({
            reason: 'focused',
            task: { id: 'focused' },
        });

        const frameNow = new Date(2026, 7, 24, 11, 40);
        const tooLong = task('long', { contexts: ['@research'], timeEstimate: '1hr', priority: 'urgent' });
        const fits = task('fits', { contexts: ['@research'], timeEstimate: '15min' });
        expect(selectNow({ frames: [frame()], now: frameNow, tasks: [tooLong, fits] })).toMatchObject({
            reason: 'frame',
            frame: { id: 'research' },
            task: { id: 'fits' },
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
