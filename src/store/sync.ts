import { mergeDocs, purgeTombstones, stable } from '../model/merge';
import type { Doc } from '../model/types';

/** Somewhere the whole document is kept, written only if nobody else wrote since it was read. */
export interface Remote {
  read(): Promise<{ doc: Doc | null; version?: string }>;
  /** Throws `ConflictError` when `version` is no longer current. */
  write(doc: Doc, version?: string): Promise<{ version: string }>;
}

export class ConflictError extends Error {
  constructor() {
    super('Someone else saved first.');
  }
}

/** What leaves this device: everything except device-local calendar events. */
const shareable = (doc: Doc): Doc => {
  const { events: _events, ...rest } = doc;
  return rest;
};

/**
 * One sync: read the remote copy, merge, and write back only if the remote is missing something.
 * A concurrent writer makes the conditional write fail; then it reads again and retries.
 */
export async function syncOnce(local: Doc, remote: Remote, now: Date, attempts = 4): Promise<Doc> {
  for (let i = 0; i < attempts; i++) {
    const r = await remote.read();
    const merged = purgeTombstones(r.doc ? mergeDocs(local, r.doc) : local, now);
    const out = shareable(merged);
    if (!r.doc || stable(out) !== stable(shareable(r.doc))) {
      try {
        await remote.write(out, r.version);
      } catch (e) {
        if (e instanceof ConflictError) continue;
        throw e;
      }
    }
    return merged;
  }
  throw new Error('Sync kept conflicting with another device. It will try again.');
}

/** An in-memory remote, used by tests and as a model of the real one. */
export class MemoryRemote implements Remote {
  doc: Doc | null = null;
  version = 0;
  writes = 0;
  async read() {
    return { doc: this.doc ? structuredClone(this.doc) : null, version: String(this.version) };
  }
  async write(doc: Doc, version?: string) {
    if (version !== undefined && version !== String(this.version)) throw new ConflictError();
    this.doc = structuredClone(doc);
    this.version++;
    this.writes++;
    return { version: String(this.version) };
  }
}
