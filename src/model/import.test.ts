import { describe, expect, it } from 'vitest';
import { emptyDoc, stepDone, stepsOf } from './doc';
import { parseIcs } from './ics';
import { importLegacy } from './legacyImport';

const now = new Date(2026, 8, 29, 10, 0);
const ctx = { now, device: 'test' };

const legacy = {
  areas: [{ id: 'a1', name: '研究' }],
  projects: [{ id: 'p1', title: '论文', areaId: 'a1', status: 'active' }],
  tasks: [
    {
      id: 't1',
      title: '写报告',
      status: 'next',
      priority: 'high',
      dueDate: '2026-10-02',
      timeEstimate: 'custom:360',
      projectId: 'p1',
      description: '图 3 要重画',
      tags: ['#paper'],
      checklist: [{ id: 'c1', title: '整理数据', isCompleted: true }],
      planner: {
        version: 1,
        days: [{ date: '2026-09-29', selected: true }],
        blocks: [
          {
            id: 'b1',
            startAt: new Date(2026, 8, 29, 15).toISOString(),
            durationMinutes: 120,
            completedMinutes: 30,
            state: 'scheduled',
          },
          { id: 'b2', startAt: new Date(2026, 8, 30, 9).toISOString(), durationMinutes: 60, state: 'cancelled' },
        ],
      },
    },
    { id: 't2', title: '回邮件', status: 'waiting' },
    { id: 't3', title: '材料到了再做', status: 'next', availableAt: '2026-10-05' },
    { id: 't4', title: '旧的', status: 'archived', completedAt: '2026-09-01T00:00:00.000Z' },
    { id: 't5', title: '删掉的', status: 'next', deletedAt: '2026-09-02T00:00:00.000Z' },
    {
      id: 't6',
      title: '洗床单',
      status: 'next',
      dueDate: '2026-09-29',
      recurrence: { rule: 'weekly', strategy: 'strict', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=5' },
    },
    {
      id: 't7',
      title: '1560 备课',
      status: 'inbox',
      parentTaskId: 't1',
      checklist: [
        { id: 's1', title: '讲义', isCompleted: false },
        { id: 's2', title: '每天看邮件', isCompleted: false },
      ],
      planner: {
        version: 1,
        days: [],
        blocks: [],
        checklistRefresh: {
          version: 1,
          defaults: {
            mode: 'custom',
            schedule: {
              id: 'v1',
              frequency: 'weekly',
              interval: 1,
              weekdays: [2, 4],
              startDate: '2026-09-28',
              time: '06:00',
              timeZone: 'America/Chicago',
            },
            end: { mode: 'date', date: '2026-12-10' },
          },
          items: { s2: { mode: 'off', end: { mode: 'never' } } },
          marks: {},
        },
      },
    },
  ],
};

describe('legacy import', () => {
  const [doc, report] = importLegacy(emptyDoc(ctx), ctx, legacy);
  it('reports what it brought over', () => {
    expect(report).toEqual({ tasks: 6, done: 1, snoozed: 2, areas: 1, projects: 1, skipped: 1 });
  });
  it('maps fields, arrangements and leftovers', () => {
    const t = doc.tasks.t1;
    expect(t).toMatchObject({
      title: '写报告',
      star: true,
      due: '2026-10-02',
      effort: 360,
      projectId: 'p1',
      note: '图 3 要重画',
      legacy: { tags: ['#paper'], priority: 'high', status: 'next' },
    });
    expect(t.plan.map((p) => [p.day, p.start, p.minutes, p.doneMin])).toEqual([
      ['2026-09-29', undefined, undefined, undefined],
      ['2026-09-29', '15:00', 120, 30],
    ]);
    expect(stepsOf(t)[0]).toMatchObject({ text: '整理数据', done: true });
  });
  it('turns waiting/someday and future availability into a snooze', () => {
    expect(doc.tasks.t2.snooze).toEqual({ reason: '等待中' });
    expect(doc.tasks.t3.snooze).toEqual({ until: '2026-10-05' });
    expect(doc.tasks.t4.done).toBe('2026-09-01T00:00:00.000Z');
    expect(doc.tasks.t5).toBeUndefined();
  });
  it('maps both repeat styles', () => {
    expect(doc.tasks.t6.repeat).toEqual({
      mode: 'copy',
      rule: { freq: 'weekly', every: 2, fromDone: false, start: '2026-09-29', weekdays: [2], count: 5 },
    });
    expect(doc.tasks.t7.repeat).toEqual({
      mode: 'reopen',
      rule: {
        freq: 'weekly',
        every: 1,
        fromDone: false,
        start: '2026-09-28',
        time: '06:00',
        weekdays: [2, 4],
        until: '2026-12-10',
      },
    });
    expect(stepsOf(doc.tasks.t7)[1].repeat).toBe('none');
    expect(doc.tasks.t7.linkTo).toBe('t1');
  });
});

describe('ics import', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:class',
    'SUMMARY:上课',
    'DTSTART:20260928T090000',
    'DTEND:20260928T103000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:allday',
    'SUMMARY:Holiday',
    'DTSTART;VALUE=DATE:20260930',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:once',
    'SUMMARY:Dentist\\, follow-up',
    'DTSTART:20261002T160000',
    'DTEND:20261002T170000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  it('expands weekly repeats, keeps all-day events apart and unescapes text', () => {
    const events = parseIcs(ics, '2026-09-28', '2026-10-31');
    expect(events.map((e) => `${e.day} ${e.start}-${e.end} ${e.title}`)).toEqual([
      '2026-09-28 09:00-10:30 上课',
      '2026-09-30 00:00-23:59 Holiday',
      '2026-09-30 09:00-10:30 上课',
      '2026-10-02 16:00-17:00 Dentist, follow-up',
      '2026-10-05 09:00-10:30 上课',
      '2026-10-07 09:00-10:30 上课',
    ]);
  });
});

describe('outlook export', () => {
  it('reads the Power Automate export: shapes, all-day, midnight crossings and the window', async () => {
    const { outlookEvents } = await import('./outlook');
    const local = (d: string, t: string) => new Date(`${d}T${t}:00`).toISOString();
    const payload = {
      events: [
        { id: 'a', subject: '组会', start: local('2026-09-29', '14:00'), end: local('2026-09-29', '15:00') },
        {
          id: 'b',
          title: '值班',
          startWithTimeZone: local('2026-09-29', '22:00'),
          endWithTimeZone: local('2026-09-30', '02:00'),
        },
        {
          id: 'c',
          subject: '假期',
          start: local('2026-09-30', '00:00'),
          end: local('2026-10-01', '00:00'),
          isAllDay: true,
        },
        { id: 'd', subject: '太远', start: local('2026-12-01', '09:00'), end: local('2026-12-01', '10:00') },
        {
          id: 'e',
          subject: 'Graph 格式',
          start: { dateTime: '2026-09-30T09:00:00' },
          end: { dateTime: '2026-09-30T09:30:00' },
        },
      ],
    };
    expect(
      outlookEvents(payload, '2026-09-28', '2026-10-31').map((e) => `${e.day} ${e.start}-${e.end} ${e.title}`),
    ).toEqual([
      '2026-09-29 14:00-15:00 组会',
      '2026-09-29 22:00-23:59 值班',
      '2026-09-30 00:00-02:00 值班',
      '2026-09-30 00:00-23:59 假期',
      '2026-09-30 09:00-09:30 Graph 格式',
    ]);
    expect(outlookEvents(payload, '2026-09-28', '2026-10-31').find((e) => e.title === '假期')?.allDay).toBe(true);
    expect(outlookEvents({ value: [] }, '2026-09-28', '2026-10-31')).toEqual([]);
    expect(outlookEvents('nonsense', '2026-09-28', '2026-10-31')).toEqual([]);
  });
});

describe('importing the previous app again, or on another device', () => {
  it('leaves what is already here alone, and loses to any real edit when merging', async () => {
    const { addTask, setField } = await import('./doc');
    const { mergeDocs } = await import('./merge');
    const [first] = importLegacy(emptyDoc(ctx), ctx, legacy);
    const later = { now: new Date(2026, 9, 6, 16), device: 'phone' };
    const edited = setField(first, later, 't1', 'title', '写报告（改过）');
    // A second import here changes nothing; one on a fresh device merges without undoing the edit.
    const [again, report] = importLegacy(edited, later, legacy);
    expect(again.tasks.t1.title).toBe('写报告（改过）');
    expect(report.tasks).toBe(0);
    const [fresh] = importLegacy(emptyDoc(later), later, legacy);
    expect(fresh.tasks.t1.s.rev).toBe(0);
    expect(mergeDocs(fresh, edited).tasks.t1.title).toBe('写报告（改过）');
    expect(mergeDocs(edited, fresh).tasks.t1.title).toBe('写报告（改过）');
    void addTask;
  });

  it('carries a completed step on its own rhythm over as done when it was', () => {
    const data = {
      tasks: [
        {
          id: 'chores',
          title: '家务',
          status: 'next',
          checklist: [{ id: 'nails', title: '剪指甲', isCompleted: true, completedAt: '2026-09-27T15:00:00.000Z' }],
          planner: {
            checklistRefresh: {
              defaults: {
                mode: 'custom',
                schedule: { frequency: 'weekly', interval: 1, weekdays: [5], startDate: '2026-09-04' },
              },
              items: {
                nails: {
                  mode: 'custom',
                  schedule: { frequency: 'weekly', interval: 2, anchor: 'completion', startDate: '2026-09-04' },
                },
              },
            },
          },
        },
      ],
    };
    const [doc] = importLegacy(emptyDoc(ctx), ctx, data);
    const step = stepsOf(doc.tasks.chores)[0];
    expect(step.repeat).toBeTypeOf('object');
    expect(step.doneAt).toBe('2026-09-27T15:00:00.000Z');
    expect(stepDone(doc.tasks.chores, step, now)).toBe(true); // two weeks from 9/27 are not up on 9/29
  });
});
