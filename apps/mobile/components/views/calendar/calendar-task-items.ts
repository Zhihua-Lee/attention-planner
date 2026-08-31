import { getTaskScheduledAt, hasTimeComponent, safeParseDate, type Task } from '@mindwtr/core';

export const calendarDateKey = (date: Date): string => (
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
);

export const addCalendarMapItem = <T,>(map: Map<string, T[]>, date: Date, item: T) => {
  const key = calendarDateKey(date);
  const items = map.get(key);
  if (items) {
    items.push(item);
    return;
  }
  map.set(key, [item]);
};

type CalendarTaskTime = Pick<Task, 'scheduledAt' | 'startTime'>;

export const isTimedScheduledTask = (task: CalendarTaskTime): boolean => (
  hasTimeComponent(getTaskScheduledAt(task))
);

export const isAllDayScheduledTask = (task: CalendarTaskTime): boolean => (
  Boolean(getTaskScheduledAt(task)) && !hasTimeComponent(getTaskScheduledAt(task))
);

export const buildScheduledTasksByDate = (tasks: readonly Task[]): Map<string, Task[]> => {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    const scheduledAt = getTaskScheduledAt(task);
    if (!scheduledAt) continue;
    const scheduledDate = safeParseDate(scheduledAt);
    if (scheduledDate) addCalendarMapItem(map, scheduledDate, task);
  }
  return map;
};
