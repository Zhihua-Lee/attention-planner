import { describe, expect, it } from 'vitest';
import { parseCapture } from './parse';

const now = new Date(2026, 8, 29, 10, 0); // Tuesday

describe('capture parsing', () => {
  it('reads a deadline, effort and importance from Chinese', () => {
    const p = parseCapture('周五交报告 3小时 !', now);
    expect(p).toMatchObject({ title: '交报告', due: '2026-10-02', effort: 180, star: true });
  });
  it('treats a plain day and part of day as when to do it', () => {
    expect(parseCapture('明天下午 写周报', now)).toMatchObject({
      title: '写周报',
      plan: { day: '2026-09-30', part: 'pm' },
    });
    expect(parseCapture('后天晚上8点 打电话', now)).toMatchObject({ plan: { day: '2026-10-01', start: '20:00' } });
    expect(parseCapture('下周一 3点半 开会', now).plan).toEqual({ day: '2026-10-05', start: '03:30' });
  });
  it('reads English', () => {
    expect(parseCapture('call mom tomorrow at 7pm 30m', now)).toMatchObject({
      title: 'call mom',
      plan: { day: '2026-09-30', start: '19:00' },
      effort: 30,
    });
    expect(parseCapture('report due fri', now)).toMatchObject({ title: 'report', due: '2026-10-02' });
  });
  it('leaves numbers that are not times or durations in the title', () => {
    expect(parseCapture('1560 备课', now)).toMatchObject({ title: '1560 备课' });
    expect(parseCapture('1560 备课', now).plan).toBeUndefined();
  });
  it('keeps what it recognised so a chip can show it', () => {
    expect(parseCapture('周五交报告 3小时', now).tokens).toMatchObject({ due: '周五', effort: '3小时' });
  });
});
