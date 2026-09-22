import { describe, expect, it } from 'vitest';
import { type ExternalCalendarEvent, type Task } from '@mindwtr/core';
import { buildPlannerCalendarDay, PLANNER_DAY_HEIGHT } from './planner-calendar-layout';
const at = (time: string, day = '2026-09-22') => new Date(`${day}T${time}:00`).toISOString();
const event = (id: string, from: string, to: string): ExternalCalendarEvent => ({ id, sourceId: 'test', title: id, start: at(from), end: at(to), allDay: false });
const task: Task = { id: 'task', title: 'Work', status: 'next', tags: [], contexts: [], createdAt: at('06:00'), updatedAt: at('06:00'), scheduledAt: at('13:30'), timeEstimate: 'custom:60' };
describe('planner calendar layout', () => {
    it('puts overlapping tasks and events in separate columns in a shared cluster', () => {
        const day = buildPlannerCalendarDay('2026-09-22', [task], [event('a', '13:00', '14:00'), event('b', '13:15', '14:15'), event('later', '17:00', '18:00')]);
        expect(day.timed.slice(0, 3).map(x => x.columnIndex)).toEqual([0, 1, 2]);
        expect(day.timed.slice(0, 3).map(x => x.columnCount)).toEqual([3, 3, 3]);
        expect(day.timed[3].columnCount).toBe(1);
    });
    it('separates visual overlap of adjacent five-minute appointments without changing time', () => {
        const events = [event('a', '16:00', '16:05'), event('b', '16:05', '16:10')];
        const day = buildPlannerCalendarDay('2026-09-22', [], events);
        expect(day.timed.map(x => x.height)).toEqual([44, 44]);
        expect(day.timed.map(x => x.columnCount)).toEqual([2, 2]);
        expect(day.timed.map(x => x.start)).toEqual(events.map(x => x.start));
    });
    it('uses an exclusive day end and keeps all-day events out of timed columns', () => {
        const events = [{ ...event('all', '00:00', '01:00'), end: at('00:00', '2026-09-24'), allDay: true }, { ...event('night', '23:45', '23:59'), end: at('00:00', '2026-09-23') }];
        const day = buildPlannerCalendarDay('2026-09-22', [], events);
        expect(day.allDay).toHaveLength(1);
        expect(day.timed).toHaveLength(1);
        expect(day.timed[0].top + day.timed[0].height).toBe(PLANNER_DAY_HEIGHT);
        expect(buildPlannerCalendarDay('2026-09-23', [], events).timed).toHaveLength(0);
        expect(buildPlannerCalendarDay('2026-09-23', [], events).allDay).toHaveLength(1);
        expect(buildPlannerCalendarDay('2026-09-24', [], events).allDay).toHaveLength(0);
    });
    it('clips a cross-midnight event to each visible date and ignores invalid intervals', () => {
        const night = { ...event('night', '23:00', '23:59'), end: at('01:00', '2026-09-23') };
        const day = buildPlannerCalendarDay('2026-09-23', [], [night, { ...night, id: 'bad', end: 'invalid' }]);
        expect(day.timed).toHaveLength(1);
        expect(day.timed[0]).toMatchObject({ top: 0, height: 80 });
    });
});
