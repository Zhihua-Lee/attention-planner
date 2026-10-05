export type Block = {
  key: string;
  kind: 'event' | 'slot';
  title: string;
  s: number;
  e: number;
  sub?: string;
  taskId?: string;
};
export type Placed = Block & { lane: number; lanes: number };

/** Overlapping blocks share the width side by side, the way Outlook lays them out. */
export function layoutBlocks(blocks: Block[]): Placed[] {
  const sorted = blocks.slice().sort((a, b) => a.s - b.s || b.e - a.e);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((b) => b.lane + 1));
    for (const b of cluster) out.push({ ...b, lanes });
    cluster = [];
  };
  for (const b of sorted) {
    if (b.s >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.e > b.s).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...b, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, b.e);
  }
  if (cluster.length) flush();
  return out;
}

/**
 * Pixels per hour in the day view. Height always reads as length; the scale grows (up to a limit) until the
 * shortest item on the day has room for its title and time, the way Outlook makes short meetings readable.
 */
export function hourHeight(durations: number[]): number {
  const shortest = Math.max(15, Math.min(60, ...durations));
  return Math.round(Math.min(120, Math.max(48, (38 / shortest) * 60)));
}
