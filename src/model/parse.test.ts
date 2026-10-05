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

describe('repeats in words', () => {
  const rule = (input: string, step = false) => parseCapture(input, now, { step }).repeat;
  it('reads Chinese repeats and takes them out of the title', () => {
    expect(parseCapture('每天 看邮件', now)).toMatchObject({
      title: '看邮件',
      repeat: { freq: 'daily', every: 1, fromDone: false, start: '2026-09-29' },
      tokens: { repeat: '每天' },
    });
    expect(rule('每3天 浇花')).toMatchObject({ freq: 'daily', every: 3 });
    expect(rule('每个工作日 站会')).toMatchObject({ freq: 'weekly', weekdays: [1, 2, 3, 4, 5] });
    expect(rule('每周一三五 跑步')).toMatchObject({ freq: 'weekly', every: 1, weekdays: [1, 3, 5] });
    expect(rule('每两周 组会')).toMatchObject({ freq: 'weekly', every: 2 });
    expect(rule('每月15号 还信用卡')).toMatchObject({ freq: 'monthly', monthDay: 15 });
    expect(rule('每月最后一天 对账')).toMatchObject({ freq: 'monthly', monthDay: -1 });
    expect(rule('每年 体检')).toMatchObject({ freq: 'yearly', every: 1 });
  });
  it('reads English repeats', () => {
    expect(parseCapture('check mail daily', now)).toMatchObject({ title: 'check mail', repeat: { freq: 'daily' } });
    expect(rule('gym every mon and thu')).toMatchObject({ freq: 'weekly', weekdays: [1, 4] });
    expect(rule('standup weekdays')).toMatchObject({ weekdays: [1, 2, 3, 4, 5] });
    expect(rule('review every 2 weeks')).toMatchObject({ freq: 'weekly', every: 2 });
    expect(rule('rent monthly')).toMatchObject({ freq: 'monthly' });
  });
  it('a repeat with a deadline word is due on its next occurrence, and starts there', () => {
    expect(parseCapture('每周五交周报', now)).toMatchObject({
      title: '交周报',
      due: '2026-10-02',
      repeat: { freq: 'weekly', weekdays: [5], start: '2026-10-02' },
    });
  });
  it('a weekday after 每周 is not this week’s date', () => {
    expect(parseCapture('每周五 打扫', now).plan).toBeUndefined();
  });
  it('"不重复" is read as such', () => {
    expect(parseCapture('不重复 买票', now)).toMatchObject({ title: '买票', repeat: 'none' });
  });
});

describe('steps', () => {
  it('any date is the step’s deadline; durations and repeats are read; times and "!" stay', () => {
    expect(parseCapture('周五 交初稿 30分钟', now, { step: true })).toMatchObject({
      title: '交初稿',
      due: '2026-10-02',
      effort: 30,
      tokens: { due: '周五', effort: '30分钟' },
    });
    expect(parseCapture('明天 列提纲', now, { step: true })).toMatchObject({ title: '列提纲', due: '2026-09-30' });
    expect(parseCapture('3点 打电话 !', now, { step: true })).toMatchObject({ title: '3点 打电话 !' });
    expect(parseCapture('每天 喝水', now, { step: true })).toMatchObject({ title: '喝水', repeat: { freq: 'daily' } });
  });
});
