import { describe, expect, it } from 'vitest';
import { layoutBlocks } from './layout';

const b = (key: string, s: number, e: number) => ({ key, kind: 'event' as const, title: key, s, e });

describe('calendar layout', () => {
  it('puts overlapping blocks side by side and lets separate ones use the full width', () => {
    const placed = layoutBlocks([b('a', 600, 660), b('b', 630, 690), b('c', 640, 650), b('d', 720, 780)]);
    const by = Object.fromEntries(placed.map((p) => [p.key, [p.lane, p.lanes]]));
    expect(by).toEqual({ a: [0, 3], b: [1, 3], c: [2, 3], d: [0, 1] });
  });
  it('reuses a lane once the block in it has ended', () => {
    const placed = layoutBlocks([b('a', 600, 630), b('long', 600, 720), b('c', 640, 700)]);
    const by = Object.fromEntries(placed.map((p) => [p.key, [p.lane, p.lanes]]));
    expect(by).toEqual({ long: [0, 2], a: [1, 2], c: [1, 2] });
  });
});
