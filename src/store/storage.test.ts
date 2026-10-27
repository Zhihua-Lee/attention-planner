import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { load, save } from './storage';

afterEach(() => vi.restoreAllMocks());

describe('storage', () => {
  it('saves and loads', async () => {
    expect(await save('k', { a: 1 })).toBe(true);
    expect(await load('k')).toEqual({ a: 1 });
  });

  it('a lost connection is reopened, so the save still lands', async () => {
    await save('k', 1);
    const real = IDBDatabase.prototype.transaction;
    let fail = true;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      if (fail) {
        fail = false;
        throw new DOMException('Connection lost', 'InvalidStateError');
      }
      return real.apply(this, args);
    });
    expect(await save('k', 2)).toBe(true);
    expect(await load('k')).toBe(2);
  });

  it('a refused open is not remembered: the next save opens again', async () => {
    vi.resetModules();
    const fresh = await import('./storage');
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('refused');
    });
    expect(await fresh.save('k', 4)).toBe(false);
    open.mockRestore();
    expect(await fresh.save('k', 5)).toBe(true);
    expect(await fresh.load('k')).toBe(5);
  });
});
