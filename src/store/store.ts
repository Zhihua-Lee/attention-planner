import { useSyncExternalStore } from 'react';
import { emptyDoc, inRounds, restore, type Ctx } from '../model/doc';
import { importLegacy, type ImportReport } from '../model/legacyImport';
import { mergeDocs } from '../model/merge';
import type { CalendarEvent, Doc } from '../model/types';
import { brokerStatus, brokerTokens, DriveRemote, readOutlookExport, type TokenSource } from './drive';
import { addDays, dayOf } from '../model/dates';
import { outlookEvents } from '../model/outlook';
import { parseIcs } from '../model/ics';
import { replaceEvents } from '../model/derive';
import { syncReminders } from './push';
import { deviceId, load, save } from './storage';
import { syncOnce, type Remote } from './sync';

export type SyncState = { status: 'off' | 'idle' | 'syncing' | 'error'; lastAt?: string; error?: string };
/** Where calendar events come from: the Outlook export in Google Drive, an imported .ics file, or nowhere yet. */
export type CalendarState = { source: 'outlook' | 'none'; at?: string; error?: string };
/** Each subscription's last read: when, how many events, or what went wrong. */
export type SubState = Record<string, { at?: string; count?: number; error?: string }>;
export type State = {
  ready: boolean;
  doc: Doc;
  canUndo: boolean;
  sync: SyncState;
  calendar: CalendarState;
  subs: SubState;
  saveError?: string;
  /** Set once when the previous app's data was imported on start. */
  imported?: ImportReport;
};

/** Where the previous app kept its data in this browser (same origin once the domain moves here). */
export const LEGACY_KEY = 'attention-planner-data-v2';
const local = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage refused; nothing to remember */
    }
  },
};

const KEY = 'doc';
const UNDO_LIMIT = 50;

/**
 * The single source of truth on this device. Every change goes through `commit`, which stamps it,
 * keeps an undo snapshot, saves it locally and schedules a sync.
 */
export class Store {
  private state: State;
  private listeners = new Set<() => void>();
  private undoStack: Doc[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private remote: Remote | null = null;
  private tokens: TokenSource | null = null;
  private calendarAt = 0;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  readonly device = deviceId();

  constructor() {
    this.state = {
      ready: false,
      doc: emptyDoc(this.ctx()),
      canUndo: false,
      sync: { status: 'off' },
      calendar: { source: 'none' },
      subs: {},
    };
  }

  ctx = (): Ctx => ({ now: new Date(), device: this.device });
  get = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  async init() {
    const stored = await load<Doc>(KEY);
    const doc = stored?.v === 1 ? stored : this.state.doc;
    this.set({ ready: true, doc });
    this.importPreviousApp();
    this.schedulePush(1500);
    const broker = local.get('ap:broker');
    if (broker) this.connectBroker(broker);
    else if (!local.get('ap:broker-off')) {
      // Served next to the sync broker and already signed in: connect without asking.
      void brokerStatus('/api').then((s) => {
        if (s !== 'connected' || this.remote) return;
        local.set('ap:broker', '/api');
        this.connectBroker('/api');
      });
    }
    window.addEventListener('focus', () => {
      this.scheduleSync(500);
      void this.refreshSubscriptions();
    });
    void this.refreshSubscriptions(true);
    setInterval(() => void this.refreshSubscriptions(), 30 * 60e3);
    window.addEventListener('beforeunload', () => void this.flush());
  }

  /** Import what the previous app left in this browser, once. Records keep their ids, so devices that each import merge cleanly. */
  private importPreviousApp() {
    const raw = local.get(LEGACY_KEY);
    if (!raw || local.get('ap:legacy-imported')) return;
    try {
      const data: unknown = JSON.parse(raw);
      let report: ImportReport | undefined;
      this.commit((d, c) => {
        const [next, r] = importLegacy(d, c, data);
        report = r;
        return next;
      });
      local.set('ap:legacy-imported', new Date().toISOString());
      if (report?.tasks) this.set({ imported: report });
    } catch {
      /* unreadable: leave it for a manual import from Settings */
    }
  }
  clearImported() {
    this.set({ imported: undefined });
  }

  /** Apply a change. `undoable: false` is for changes that should not appear as an undo step. */
  commit(fn: (doc: Doc, ctx: Ctx) => Doc, { undoable = true } = {}) {
    const before = this.state.doc;
    const doc = fn(before, this.ctx());
    if (doc === before) return;
    if (undoable) {
      this.undoStack.push(before);
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }
    this.set({ doc, canUndo: this.undoStack.length > 0 });
    this.scheduleSave();
    this.scheduleSync(2000);
    this.schedulePush();
  }

  /** Reminders follow the data: re-send them a few seconds after changes settle (only when push is on). */
  schedulePush(ms = 4000) {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void syncReminders(this.state.doc).catch(() => undefined), ms);
  }

  undo() {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;
    this.set({ doc: restore(this.state.doc, snapshot, this.ctx()), canUndo: this.undoStack.length > 0 });
    this.scheduleSave();
    this.scheduleSync(2000);
    return true;
  }

  private dirty = false;
  private scheduleSave() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 250);
  }
  /** Write pending changes. Nothing is written when nothing changed, so another tab's save is never overwritten. */
  async flush() {
    clearTimeout(this.saveTimer);
    if (!this.dirty) return;
    this.dirty = false;
    const ok = await save(KEY, this.state.doc);
    if (ok === (this.state.saveError !== undefined)) this.set({ saveError: ok ? undefined : 'storage' });
  }

  /** Sync through the broker at `base`; the same Google access also reads the Outlook calendar export. */
  connectBroker(base: string) {
    this.tokens = brokerTokens(base);
    this.connect(new DriveRemote(this.tokens), this.tokens);
  }
  connect(remote: Remote | null, tokens: TokenSource | null = null) {
    this.remote = remote;
    this.tokens = tokens;
    if (!remote) this.set({ calendar: { source: 'none' } });
    this.set({ sync: remote ? { status: 'idle' } : { status: 'off' } });
    if (remote) this.scheduleSync(0);
  }
  private scheduleSync(ms: number) {
    if (!this.remote) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.syncNow(), ms);
  }
  async syncNow() {
    if (!this.remote || this.state.sync.status === 'syncing') return;
    this.set({ sync: { ...this.state.sync, status: 'syncing' } });
    const sent = this.state.doc;
    try {
      const merged = await syncOnce(sent, this.remote, new Date());
      // Keep edits made while the sync was in flight: merge them over the synced copy.
      const doc = this.state.doc === sent ? merged : mergeDocs(this.state.doc, merged);
      this.set({ doc, sync: { status: 'idle', lastAt: new Date().toISOString() } });
      this.scheduleSave();
      void this.refreshCalendar();
      this.schedulePush();
    } catch (e) {
      this.set({ sync: { ...this.state.sync, status: 'error', error: e instanceof Error ? e.message : String(e) } });
    }
  }

  /** Replace the events from one source (Outlook, an imported file, a subscription); other sources stay. */
  setEvents(source: string, events: CalendarEvent[]) {
    this.commit((d) => ({ ...d, events: replaceEvents(d.events, source, events) }), { undoable: false });
  }

  private subsAt = 0;
  /** Read every calendar subscription (at most every 30 minutes unless forced). */
  async refreshSubscriptions(force = false) {
    const subs = this.state.doc.settings.calendars ?? [];
    if (!subs.length || (!force && Date.now() - this.subsAt < 30 * 60e3)) return;
    this.subsAt = Date.now();
    const today = dayOf(new Date());
    for (const sub of subs) {
      try {
        const res = await fetch(`/ics?url=${encodeURIComponent(sub.url)}`);
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        const events = parseIcs(await res.text(), addDays(today, -14), addDays(today, 120));
        this.setEvents(`sub:${sub.id}`, events);
        this.set({ subs: { ...this.state.subs, [sub.id]: { at: new Date().toISOString(), count: events.length } } });
      } catch (e) {
        this.set({
          subs: {
            ...this.state.subs,
            [sub.id]: { ...this.state.subs[sub.id], error: e instanceof Error ? e.message : String(e) },
          },
        });
      }
    }
  }

  /** Read the Outlook export at most every 10 minutes (or when forced) and show its events on this device. */
  async refreshCalendar(force = false) {
    if (!this.tokens || (!force && Date.now() - this.calendarAt < 10 * 60e3)) return;
    this.calendarAt = Date.now();
    try {
      const payload = await readOutlookExport(this.tokens);
      if (payload === null) return this.set({ calendar: { source: 'none' } });
      const today = dayOf(new Date());
      const events = outlookEvents(payload, addDays(today, -14), addDays(today, 120));
      this.setEvents('outlook', events);
      this.set({ calendar: { source: 'outlook', at: new Date().toISOString() } });
    } catch (e) {
      this.set({ calendar: { ...this.state.calendar, error: e instanceof Error ? e.message : String(e) } });
    }
  }
}

export const store = new Store();

/**
 * What the screen reads: the state with every task as its current round sees it (a task that reopens shows this
 * round's dates). Recomputed when the state changes or the minute turns; writes still go to the stored document.
 */
let snap: { state: State; minute: number; out: State } | null = null;
function view(): State {
  const state = store.get();
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60e3);
  if (snap && snap.state === state && snap.minute === minute) return snap.out;
  const doc = inRounds(state.doc, now);
  const out = snap && snap.state === state && snap.out.doc === doc ? snap.out : { ...state, doc };
  snap = { state, minute, out };
  return out;
}
export const useStore = () => useSyncExternalStore(store.subscribe, view);
