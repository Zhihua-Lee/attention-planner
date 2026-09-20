import { describe, expect, it } from 'vitest';
import { emptyPlainCapture, preparePlainCapture, type PlainCaptureDraft } from './plain-capture';

const draft = (patch: Partial<PlainCaptureDraft> = {}): PlainCaptureDraft => ({ ...emptyPlainCapture(), title: 'Laundry', ...patch });
const props = (patch: Partial<PlainCaptureDraft> = {}) => {
    const result = preparePlainCapture(draft(patch));
    if (!result.ok) throw new Error(result.error);
    return result.props;
};

describe('plain capture contract', () => {
    it('captures without any metadata', () => expect(props()).toEqual({ status: 'inbox', description: undefined }));
    it('treats title syntax as literal text', () => {
        const title = 'Read C++ @home #1 /done';
        expect(preparePlainCapture(draft({ title }))).toMatchObject({ ok: true, title });
        expect(props({ title }).status).toBe('inbox');
    });
    it('requires a nonblank title', () => expect(preparePlainCapture(emptyPlainCapture())).toEqual({ ok: false, error: 'title' }));
    it('supports clarified but unscheduled tasks', () => expect(props({ destination: 'next' }).status).toBe('next'));
    it('uses an instant for reservations, not availability or deadlines', () => {
        const result = props({ scheduledAt: '2026-09-18T09:30' });
        expect(result.scheduledAt).toBe(new Date(2026, 8, 18, 9, 30).toISOString());
        expect(result.status).toBe('next');
        expect(result).not.toHaveProperty('startTime');
        expect(result).not.toHaveProperty('availableAt');
        expect(result).not.toHaveProperty('dueDate');
    });
    it('preserves an all-day deadline without creating a reservation', () => {
        expect(props({ dueDate: '2026-09-18' })).toMatchObject({ status: 'inbox', dueDate: '2026-09-18' });
        expect(props({ dueDate: '2026-09-18' })).not.toHaveProperty('scheduledAt');
    });
    it.each(['2026-02-31', '2026-13-01', 'not-a-date'])('rejects invalid deadline %s', dueDate => {
        expect(preparePlainCapture(draft({ dueDate }))).toMatchObject({ ok: false, error: 'due' });
    });
    it.each(['2026-09-18', '2026-09-18T25:00', '2026-02-31T09:00'])('rejects invalid reservation %s', scheduledAt => {
        expect(preparePlainCapture(draft({ scheduledAt }))).toMatchObject({ ok: false, error: 'schedule' });
    });
    it.each([0, -1, 1.5, NaN, 1000])('rejects repeat interval %s', interval => {
        expect(preparePlainCapture(draft({ repeat: 'weekly', interval }))).toMatchObject({ ok: false, error: 'interval' });
    });
    it('builds recurrence from controls rather than title parsing', () => {
        expect(props({ repeat: 'weekly', interval: 2 }).recurrence).toEqual({ rule: 'weekly', strategy: 'strict', rrule: 'FREQ=WEEKLY;INTERVAL=2' });
        expect(props({ repeat: 'daily', interval: 7, afterCompletion: true }).recurrence).toMatchObject({ strategy: 'fluid' });
    });
    it('makes area and project assignment exclusive', () => {
        expect(props({ container: 'project:p1' })).toHaveProperty('projectId', 'p1');
        expect(props({ container: 'project:p1' })).not.toHaveProperty('areaId');
        expect(props({ container: 'area:a1' })).toHaveProperty('areaId', 'a1');
        expect(props({ container: 'area:a1' })).not.toHaveProperty('projectId');
    });
    it('does not mutate the input draft or manufacture attention settings', () => {
        const input = draft({ description: 'Line one\n- [ ] Step' });
        const before = JSON.stringify(input);
        preparePlainCapture(input);
        expect(JSON.stringify(input)).toBe(before);
        expect(props()).not.toHaveProperty('isFocusedToday');
        expect(props()).not.toHaveProperty('snoozedUntil');
    });
});
