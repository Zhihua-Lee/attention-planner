import type { Change } from './changes';

/** Changes to existing tasks wait here until the owner approves or rejects them in the browser. */
export type Proposal = {
  id: string;
  summary: string;
  changes: Change[];
  /** The AI client that proposed it, as it named itself. */
  client: string;
  createdAt: string;
  status: 'pending' | 'applied' | 'rejected' | 'failed';
  decidedAt?: string;
  error?: string;
  /** Must come back with the approval form, so a page from elsewhere cannot approve. */
  nonce: string;
};

/** A pending proposal lapses after this long. */
export const PROPOSAL_DAYS = 3;

export interface ProposalStore {
  get(id: string): Promise<Proposal | null>;
  put(p: Proposal): Promise<void>;
}

export const randomId = (bytes = 16) =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const isExpired = (p: Proposal, now = Date.now()) =>
  p.status === 'pending' && now - new Date(p.createdAt).getTime() > PROPOSAL_DAYS * 864e5;

/** Proposals kept in Workers KV for two weeks (pending ones lapse sooner). */
export function kvProposals(kv: {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}): ProposalStore {
  return {
    async get(id) {
      const raw = /^[A-Za-z0-9_-]{10,64}$/.test(id) ? await kv.get(`ap-proposal:${id}`) : null;
      return raw ? (JSON.parse(raw) as Proposal) : null;
    },
    async put(p) {
      await kv.put(`ap-proposal:${p.id}`, JSON.stringify(p), { expirationTtl: 14 * 86400 });
    },
  };
}

export function memoryProposals(): ProposalStore & { all: Map<string, Proposal> } {
  const all = new Map<string, Proposal>();
  return {
    all,
    async get(id) {
      return all.get(id) ?? null;
    },
    async put(p) {
      all.set(p.id, structuredClone(p));
    },
  };
}
