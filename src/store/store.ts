import { useSyncExternalStore } from 'react';
import { emptyDoc, restore, type Ctx } from '../model/doc';
import { importLegacy, type ImportReport } from '../model/legacyImport';
import { mergeDocs } from '../model/merge';
import type { Doc } from '../model/types';
import { brokerStatus, brokerTokens, DriveRemote } from './drive';
import { deviceId, load, save } from './storage';
import { syncOnce, type Remote } from './sync';

export type SyncState = { status: 'off' | 'idle' | 'syncing' | 'error'; lastAt?: string; error?: string };
export type State = {
  ready: boolean;
  doc: Doc;
  canUndo: boolean;
  sync: SyncState;
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
  readonly device = deviceId();

  constructor() {
    this.state = { ready: false, doc: emptyDoc(this.ctx()), canUndo: false, sync: { status: 'off' } };
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
    const broker = local.get('ap:broker');
    if (broker) this.connect(new DriveRemote(brokerTokens(broker)));
    else if (!local.get('ap:broker-off')) {
      // Served next to the sync broker and already signed in: connect without asking.
      void brokerStatus('/api').then((s) => {
        if (s !== 'connected' || this.remote) return;
        local.set('ap:broker', '/api');
        this.connect(new DriveRemote(brokerTokens('/api')));
      });
    }
    window.addEventListener('focus', () => this.scheduleSync(500));
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
  }

  undo() {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;
    this.set({ doc: restore(this.state.doc, snapshot, this.ctx()), canUndo: this.undoStack.length > 0 });
    this.scheduleSave();
    this.scheduleSync(2000);
    return true;
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 250);
  }
  async flush() {
    clearTimeout(this.saveTimer);
    const ok = await save(KEY, this.state.doc);
    if (ok === (this.state.saveError !== undefined)) this.set({ saveError: ok ? undefined : 'storage' });
  }

  connect(remote: Remote | null) {
    this.remote = remote;
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
    } catch (e) {
      this.set({ sync: { ...this.state.sync, status: 'error', error: e instanceof Error ? e.message : String(e) } });
    }
  }
}

export const store = new Store();
export const useStore = () => useSyncExternalStore(store.subscribe, store.get);
