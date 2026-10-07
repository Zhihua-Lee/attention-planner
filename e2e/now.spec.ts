import { expect, test, type Page } from '@playwright/test';
import { add, openRow, row, start, T0, toList, reloadSaved } from './helpers';

test('NOW shows one task with its reason, and "another" cycles', async ({ page }) => {
  await start(page);
  await add(page, '交停车费 截止今天', '整理书桌', '写论文 !');
  await page.getByRole('tab', { name: 'NOW' }).click();
  const card = page.getByTestId('now-card');
  await expect(card.getByRole('heading')).toHaveText('交停车费');
  await expect(card).toContainText('今天截止');
  await card.getByRole('button', { name: '换一件' }).click();
  await expect(card.getByRole('heading')).toContainText('写论文');
  await expect(card).toContainText('标了重要');
  await card.getByRole('button', { name: '完成' }).click();
  await expect(card.getByRole('heading')).not.toContainText('写论文');
});

test('a reserved time happening now comes first', async ({ page }) => {
  await start(page, new Date('2026-09-29T15:30:00-05:00'));
  await add(page, '整理书桌 !');
  await toList(page);
  await page.getByRole('textbox', { name: '记下新任务' }).fill('写报告');
  await page.locator('.capture').getByRole('button', { name: '哪天做' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^今天/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '15:00' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '2 小时', exact: true }).click();
  await page.getByRole('textbox', { name: '记下新任务' }).press('Enter');
  await page.getByRole('tab', { name: 'NOW' }).click();
  const card = page.getByTestId('now-card');
  await expect(card.getByRole('heading')).toHaveText('写报告');
  await expect(card).toContainText('现在是预留的时段 · 到 17:00');
});

test('the agenda moves by day and week, and opens a task', async ({ page }) => {
  await start(page);
  await add(page, '明天下午 复习', '周五交报告');
  await page.getByRole('tab', { name: 'NOW' }).click();
  const agenda = page.getByRole('region', { name: '日程' });
  await expect(agenda).toContainText('9/29 周二 · 今天');
  await agenda.getByRole('button', { name: '后一天' }).click();
  await expect(agenda).toContainText('9/30 周三');
  await expect(agenda.locator('.pill', { hasText: '复习' })).toContainText('下午');
  await agenda.getByRole('button', { name: '周' }).click();
  await expect(agenda).toContainText('9/28 – 10/4');
  await expect(agenda.locator('.witem.due', { hasText: '交报告' })).toBeVisible();
  await agenda.getByRole('button', { name: '今天' }).isDisabled();
  await agenda.getByRole('button', { name: '下一周' }).click();
  await expect(agenda).toContainText('10/5 – 10/11');
  await agenda.getByRole('button', { name: '今天' }).click();
  await agenda.getByRole('button', { name: /周三 9\/30/ }).click();
  await expect(agenda).toContainText('9/30 周三');
  await agenda.locator('.pill', { hasText: '复习' }).click();
  await page.getByRole('dialog', { name: '详情' }).getByRole('button', { name: '打开任务' }).click();
  await expect(page.getByTestId('task-detail')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '任务名称' })).toHaveValue('复习');
});

/** Pixels per hour in the day view. */
const hourPx = async (page: Page) =>
  (await page
    .getByRole('region', { name: '日程' })
    .locator('.timeline')
    .evaluate((el) => el.clientHeight)) / 24;

test('the day scrolls through 24 hours and opens at the current time with a now marker', async ({ page }) => {
  await start(page, new Date('2026-09-29T16:20:00-05:00'));
  await page.getByRole('tab', { name: 'NOW' }).click();
  const agenda = page.getByRole('region', { name: '日程' });
  await agenda.getByRole('button', { name: '日', exact: true }).click();
  const scroller = agenda.locator('.day-scroll');
  await expect(agenda.locator('.now-tag')).toHaveText('16:20');
  await expect(agenda.locator('.now-tag')).toBeInViewport();
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(8 * (await hourPx(page))); // as far down as it goes
  expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
});

test('overlapping events sit side by side; tapping shows details; an empty time can be reserved', async ({ page }) => {
  await start(page);
  await add(page, '复习第 3 章 2小时');
  await page.getByRole('tab', { name: 'NOW' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  const ev = (uid: string, s: string, e: string, title: string, more: string[] = []) =>
    ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, `DTSTART:${s}`, `DTEND:${e}`, ...more, 'END:VEVENT'].join(
      '\r\n',
    );
  const ics = [
    'BEGIN:VCALENDAR',
    ev('a', '20260929T140000', '20260929T150000', '组会', ['LOCATION:Zoom']),
    ev('b', '20260929T143000', '20260929T153000', '一对一'),
    'END:VCALENDAR',
  ].join('\r\n');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入日历文件', exact: true }).click();
  await (await chooser).setFiles({ name: 'cal.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) });
  await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '完成' }).click();
  const agenda = page.getByRole('region', { name: '日程' });
  await agenda.getByRole('button', { name: '日', exact: true }).click();
  const a = await agenda.locator('.blk.event', { hasText: '组会' }).boundingBox();
  const b = await agenda.locator('.blk.event', { hasText: '一对一' }).boundingBox();
  expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + 1);
  await agenda.locator('.blk.event', { hasText: '组会' }).click();
  const details = page.getByRole('dialog', { name: '详情' });
  await expect(details).toContainText('14:00–15:00（1 小时）');
  await expect(details).toContainText('Zoom');
  await page.keyboard.press('Escape');
  // An empty spot at 17:00 → reserve it for an existing task, then change its time from the details.
  const H = await hourPx(page);
  await agenda.locator('.day-scroll').evaluate((el, h) => (el.scrollTop = 16 * h), H);
  const area = await agenda.locator('.lane-area').boundingBox();
  await page.mouse.click(area!.x + area!.width - 10, area!.y + 17 * H + 8);
  const sheet = page.getByRole('dialog', { name: '预留时段' });
  await expect(sheet.getByLabel('开始')).toHaveValue('17:00');
  await sheet.getByRole('radio', { name: '已有任务' }).click();
  await sheet.getByRole('option', { name: /复习第 3 章/ }).click();
  await expect(sheet.getByRole('button', { name: '2 小时', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: '预留' }).click();
  const slot = agenda.locator('.blk.slot', { hasText: '复习第 3 章' });
  await expect(slot).toContainText('17:00–19:00');
  await slot.click();
  await page.getByRole('dialog', { name: '详情' }).getByRole('button', { name: '改时间' }).click();
  await page.getByRole('dialog', { name: '详情' }).getByRole('button', { name: '18:00' }).click();
  await page.getByRole('dialog', { name: '详情' }).getByRole('button', { name: '1 小时', exact: true }).click();
  await expect(slot).toContainText('18:00–19:00');
});

test('short events keep a readable title; height matches length; nothing covers the next', async ({ page }) => {
  await start(page);
  await page.getByRole('tab', { name: 'NOW' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  const ev = (uid: string, s: string, e: string, title: string) =>
    ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, `DTSTART:${s}`, `DTEND:${e}`, 'END:VEVENT'].join('\r\n');
  const ics = [
    'BEGIN:VCALENDAR',
    ev('a', '20260929T123000', '20260929T133000', 'Math Lab Hour'),
    ev('b', '20260929T130000', '20260929T133000', 'Research: Sparse Sensing Reading Group'),
    ev('c', '20260929T133000', '20260929T142000', 'CS:4200:0001 Numerical Analysis I'),
    'END:VCALENDAR',
  ].join('\r\n');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入日历文件', exact: true }).click();
  await (await chooser).setFiles({ name: 'cal.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) });
  await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '完成' }).click();
  const agenda = page.getByRole('region', { name: '日程' });
  await agenda.getByRole('button', { name: '日', exact: true }).click();
  expect(await hourPx(page)).toBe(40); // a fixed scale keeps the day an overview
  const box = async (name: string) => (await agenda.locator('.blk.event', { hasText: name }).boundingBox())!;
  const [lab, research, math] = [await box('Math Lab'), await box('Research'), await box('CS:4200')];
  expect(lab.height).toBeGreaterThan(research.height * 1.8); // an hour is twice half an hour
  expect(research.y + research.height).toBeLessThanOrEqual(math.y + 1); // no covering
  // The half-hour block shows its title and its time, each inside the block.
  for (const sel of ['.bt', '.t']) {
    const inner = (await agenda.locator('.blk.event', { hasText: 'Research' }).locator(sel).boundingBox())!;
    expect(inner.y + inner.height).toBeLessThanOrEqual(research.y + research.height + 1);
  }
});

test('full width can be switched on for reading on a large screen', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'phones are already full width');
  await start(page);
  const app = page.locator('.app');
  const narrow = (await app.boundingBox())!.width;
  await page.getByRole('button', { name: '全宽' }).click();
  await expect(page.getByRole('button', { name: '全宽' })).toHaveAttribute('aria-pressed', 'true');
  expect((await app.boundingBox())!.width).toBeGreaterThan(narrow + 100);
  await reloadSaved(page);
  await expect(page.getByRole('button', { name: '全宽' })).toHaveAttribute('aria-pressed', 'true');
});

test('reserving a new task warns about an overlap but still reserves it', async ({ page }) => {
  await start(page);
  await add(page, '今天 15点 写引言 1小时');
  await page.getByRole('tab', { name: 'NOW' }).click();
  const agenda = page.getByRole('region', { name: '日程' });
  await agenda.getByRole('button', { name: '日', exact: true }).click();
  const H = await hourPx(page);
  await agenda.locator('.day-scroll').evaluate((el, h) => (el.scrollTop = 14 * h), H);
  const area = await agenda.locator('.lane-area').boundingBox();
  await page.mouse.click(area!.x + area!.width - 10, area!.y + 17 * H + 8); // empty at 17:00
  const sheet = page.getByRole('dialog', { name: '预留时段' });
  await sheet.getByLabel('开始').fill('15:30');
  await expect(sheet.getByRole('note')).toContainText('写引言');
  await sheet.getByRole('textbox', { name: '这段时间做什么？' }).fill('回邮件');
  await sheet.getByRole('textbox', { name: '这段时间做什么？' }).press('Enter');
  await expect(agenda.locator('.blk.slot', { hasText: '回邮件' })).toContainText('15:30–16:30');
});

test('the capacity check warns when a deadline will not fit', async ({ page }) => {
  await start(page);
  await add(page, '明天交大作业 20小时');
  await page.getByRole('tab', { name: 'NOW' }).click();
  await expect(page.getByRole('note')).toContainText('大作业：明天前大约还差');
});

test('a task that reopens finishes its round and comes back next time', async ({ page }) => {
  await start(page);
  await add(page, '1560 备课');
  const detail = await openRow(page, '1560 备课');
  await detail.getByRole('textbox', { name: '添加步骤' }).fill('讲义');
  await detail.getByRole('textbox', { name: '添加步骤' }).press('Enter');
  await detail.getByRole('button', { name: '不重复' }).click();
  await detail.getByRole('radio', { name: '原地重开' }).click();
  await detail.getByRole('combobox', { name: '频率' }).selectOption('weekly');
  await detail.getByRole('button', { name: '四', exact: true }).click(); // Tuesday is already on
  await expect(detail.getByRole('button', { name: /每周二、四 · 原地重开/ })).toBeVisible();
  await detail.getByRole('checkbox', { name: '讲义' }).check();
  await expect(detail.getByRole('button', { name: '重新打开本轮' })).toBeVisible();
  await page.getByRole('button', { name: '收起' }).click();
  await expect(row(page, '1560 备课')).toContainText('下一轮 后天');
  await page.clock.setFixedTime(new Date(T0.getTime() + 2 * 864e5)); // Thursday
  await reloadSaved(page);
  await toList(page);
  await expect(row(page, '1560 备课')).not.toHaveClass(/done/);
  const again = await openRow(page, '1560 备课');
  await expect(again.getByRole('checkbox', { name: '讲义' })).not.toBeChecked();
  await expect(again.locator('.history')).toContainText('完成历史 · 1');
});

test('a "new copy" task creates the next one when completed', async ({ page }) => {
  await start(page);
  await add(page, '今天 洗床单');
  const detail = await openRow(page, '洗床单');
  await detail.getByRole('button', { name: '不重复' }).click();
  await detail.getByRole('radio', { name: '新建一份' }).click();
  await detail.getByRole('combobox', { name: '频率' }).selectOption('weekly');
  await detail.getByRole('combobox', { name: '何时停止' }).selectOption('count');
  await detail.getByRole('spinbutton', { name: '总次数' }).fill('3');
  await detail.getByRole('button', { name: '完成', exact: true }).click();
  await expect(row(page, '洗床单')).toContainText('10/6');
});

test('find time: free working times before the deadline, one tap reserves; the estimate stays', async ({ page }) => {
  await start(page);
  await add(page, '周四交表格 90分钟');
  const detail = await openRow(page, '交表格');
  await detail.getByRole('button', { name: '找时间' }).click();
  const menu = page.locator('.find-time');
  await expect(menu).toContainText('1.5 小时');
  await menu.getByRole('button').first().click();
  await expect(page.locator('.toast')).toContainText('已预留');
  await expect(detail).toContainText('已排 1.5 小时');
  await expect(detail.getByRole('button', { name: '找时间' })).toHaveCount(0); // all reserved
  await expect(detail.getByRole('button', { name: /^1.5 小时$/ })).toBeVisible(); // the estimate is unchanged
});

test('a tapped free time suggests tasks that suit it, unless turned off in Settings', async ({ page }) => {
  await start(page);
  await add(page, '周四交表格 1小时', '随手记的');
  await page.getByRole('tab', { name: 'NOW' }).click();
  const agenda = page.getByRole('region', { name: '日程' });
  await agenda.getByRole('button', { name: '日', exact: true }).click();
  const H = await hourPx(page);
  const tapAt17 = async () => {
    await agenda.locator('.day-scroll').evaluate((el, h) => (el.scrollTop = 16 * h), H);
    const area = (await agenda.locator('.lane-area').boundingBox())!;
    await page.mouse.click(area.x + area.width - 10, area.y + 17 * H + 8);
  };
  await tapAt17();
  const sheet = page.getByRole('dialog', { name: '预留时段' });
  const suggested = sheet.getByRole('group', { name: '推荐' });
  await expect(suggested.getByRole('button').first()).toContainText('交表格');
  await suggested.getByRole('button', { name: /交表格/ }).click();
  await sheet.getByRole('button', { name: '预留' }).click();
  await expect(agenda.locator('.blk.slot', { hasText: '交表格' })).toContainText('17:00–18:00');
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('checkbox', { name: '点空白时间时推荐任务' }).uncheck();
  await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '完成' }).click();
  await agenda.locator('.day-scroll').evaluate((el, h) => (el.scrollTop = 14 * h), H);
  const area = (await agenda.locator('.lane-area').boundingBox())!;
  await page.mouse.click(area.x + area.width - 10, area.y + 15 * H + 8);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('group', { name: '推荐' })).toHaveCount(0);
});

test('a new copy can show up some days before its deadline', async ({ page }) => {
  await start(page);
  await add(page, '每周五交周报');
  const detail = await openRow(page, '交周报');
  await detail.getByRole('button', { name: /新建一份/ }).click();
  await detail.getByRole('spinbutton', { name: '截止前几天出现' }).fill('2');
  await page.getByRole('button', { name: '收起' }).click();
  await row(page, '交周报').getByRole('checkbox', { name: '完成: 交周报' }).click();
  // Done on Tuesday 9/29 before Friday 10/2; the next copy is due 10/9 and waits until Wednesday 10/7.
  await expect(row(page, '交周报').first()).toContainText('暂缓到');
});
