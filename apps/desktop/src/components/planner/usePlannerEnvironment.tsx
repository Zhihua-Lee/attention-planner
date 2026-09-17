import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { activeWorkBlocks, blockEnd, createPlanningPolicy, localPlanDate, plannerPatch, rolloverWork, taskPlanner, useTaskStore, type ExternalCalendarEvent, type Task } from '@mindwtr/core';
import { fetchExternalCalendarEvents } from '../../lib/external-calendar-events';
import { editTask, WORK_CHANGED_EVENT } from '../../lib/lifecycle-actions';
type Environment = {
  now: Date;
  events: ExternalCalendarEvent[];
  calendarError: string | null;
  loaded: boolean;
  currentId: string | null;
  refresh: () => void;
  showDate: (date: string) => void;
};
const Context = createContext<Environment | null>(null);
export function usePlannerEnvironment() {
  const value = useContext(Context);
  if (!value) throw new Error('Planner provider is missing.');
  return value;
}
export function PlannerEnvironment({
  children
}: {
  children: ReactNode;
}) {
  const [viewDay, setViewDay] = useState(() => localPlanDate(new Date()));
  const [now, setNow] = useState(() => new Date());
  const [events, setEvents] = useState<ExternalCalendarEvent[]>([]);
  const [calendarError, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [currentId, setCurrentId] = useState(() => localStorage.getItem('attention-planner:current-work'));
  const tasks = useTaskStore(s => s.tasks),
    projects = useTaskStore(s => s.projects),
    windows = useTaskStore(s => s.settings.gtd?.planningWindows);
  const busyRef = useRef(false);
  const day = localPlanDate(now);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const resume = () => {
      if (!document.hidden) {
        tick();
        setRefreshToken(v => v + 1);
      }
    };
    const current = () => setCurrentId(localStorage.getItem('attention-planner:current-work'));
    const timer = window.setInterval(tick, 30_000);
    const calendarTimer = window.setInterval(resume, 300_000);
    window.addEventListener(WORK_CHANGED_EVENT, current);
    window.addEventListener('storage', current);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return () => {
      clearInterval(timer);
      clearInterval(calendarTimer);
      window.removeEventListener(WORK_CHANGED_EVENT, current);
      window.removeEventListener('storage', current);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    const start = new Date(`${day < viewDay ? day : viewDay}T00:00:00`),
      end = new Date(`${day > viewDay ? day : viewDay}T00:00:00`);
    end.setDate(end.getDate() + 8);
    fetchExternalCalendarEvents(start, end).then(result => {
      if (cancelled) return;
      setEvents(result.events);
      setError(result.events.some(e => !Number.isFinite(Date.parse(e.start)) || !Number.isFinite(Date.parse(e.end)) || Date.parse(e.end) <= Date.parse(e.start)) ? 'Calendar returned an invalid interval.' : result.warnings.join('; ') || null);
      setLoaded(true);
    }).catch(error => {
      if (!cancelled) {
        setError(String(error));
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [day, viewDay, refreshToken]);
  useEffect(() => {
    if (!loaded || busyRef.current || document.hidden) return;
    const hasExpired = tasks.some(t => !t.deletedAt && !['done', 'archived', 'reference'].includes(t.status) && taskPlanner(t).blocks.some(b => b.state === 'pending' || b.state === 'scheduled' && blockEnd(b) <= now.getTime()));
    if (!hasExpired) return;
    busyRef.current = true;
    void (async () => {
      // Sequential commits include previously moved allocations in later collision checks.
      for (const candidate of tasks) {
        for (const old of taskPlanner(candidate).blocks) {
          if (!['scheduled', 'pending'].includes(old.state)) continue;
          await editTask(candidate.id, (task, clock) => {
            if (['done', 'archived', 'reference'].includes(task.status)) return {};
            const state = useTaskStore.getState();
            const policy = createPlanningPolicy(state.tasks, state.projects, clock.now);
            const reason = policy.executionBlock(task);
            const p = taskPlanner(task),
              block = p.blocks.find(b => b.id === old.id);
            if (!block) return {};
            const busy = [...events.map(e => ({
              start: e.start,
              end: e.end
            })), ...state.tasks.flatMap((t: Task) => activeWorkBlocks(t).filter(b => !(t.id === task.id && b.id === block.id) && blockEnd(b) > clock.now.getTime()).map(b => ({
              start: b.startAt,
              end: new Date(blockEnd(b)).toISOString()
            })))];
            const moved = rolloverWork(task, block, {
              ...clock,
              windows: windows ?? [],
              busy,
              calendarTrusted: !calendarError,
              blocked: reason === 'unavailable' ? null : reason
            });
            if (moved === block) return {};
            return plannerPatch(task, {
              ...p,
              blocks: p.blocks.map(b => b.id === block.id ? moved : b)
            });
          });
        }
      }
    })().catch(error => setError(String(error))).finally(() => {
      busyRef.current = false;
    });
  }, [tasks, projects, windows, now, loaded, calendarError, events]);
  const value = useMemo(() => ({
    now,
    events,
    calendarError,
    loaded,
    currentId,
    refresh: () => setRefreshToken(v => v + 1),
    showDate: setViewDay
  }), [now, events, calendarError, loaded, currentId]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
