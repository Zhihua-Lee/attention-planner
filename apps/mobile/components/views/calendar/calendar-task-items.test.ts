import { describe, expect, it } from 'vitest';
import type { Task } from '@mindwtr/core';

import {
  buildScheduledTasksByDate,
  calendarDateKey,
  isAllDayScheduledTask,
  isTimedScheduledTask,
} from './calendar-task-items';

const task = (overrides: Partial<Task>): Task => ({
  id: overrides.id ?? 'task-1',
  title: overrides.title ?? 'Task',
  status: overrides.status ?? 'next',
  contexts: [],
  tags: [],
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  ...overrides,
});

describe('calendar task item grouping', () => {
  it('indexes explicit and legacy timed schedules without treating availability as a block', () => {
    const availability = task({ id: 'available', startTime: '2026-04-20' });
    const legacyTimed = task({ id: 'legacy-timed', startTime: '2026-04-20T09:00:00' });
    const scheduled = task({ id: 'scheduled', scheduledAt: '2026-04-20T13:00:00' });
    const allDayScheduled = task({ id: 'all-day-scheduled', scheduledAt: '2026-04-20' });

    const grouped = buildScheduledTasksByDate([availability, legacyTimed, scheduled, allDayScheduled]);

    expect(grouped.get(calendarDateKey(new Date(2026, 3, 20)))?.map((item) => item.id)).toEqual([
      'legacy-timed',
      'scheduled',
      'all-day-scheduled',
    ]);
    expect(isAllDayScheduledTask(availability)).toBe(false);
    expect(isAllDayScheduledTask(allDayScheduled)).toBe(true);
    expect(isTimedScheduledTask(availability)).toBe(false);
    expect(isTimedScheduledTask(legacyTimed)).toBe(true);
    expect(isTimedScheduledTask(scheduled)).toBe(true);
  });
});
