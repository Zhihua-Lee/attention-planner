import { expect, test, type Page } from '@playwright/test';
import { add, openRow, row, start, toList } from './helpers';

/** Choose buttons or the right-click menu for task rows or steps in Settings. */
async function choose(page: Page, group: '任务行的操作' | '步骤的操作', option: '按钮' | '右键菜单') {
  await page.getByRole('button', { name: '设置' }).click();
  const sheet = page.getByRole('dialog', { name: '设置' });
  await sheet.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option }).click();
  await sheet.getByRole('button', { name: '完成' }).click();
}

test('task rows: buttons by default; with the menu chosen, a right-click opens it and its choices work', async ({
  page,
}) => {
  await start(page);
  await add(page, '整理书架');
  // Buttons: the ☀ button is there and a right-click opens nothing of the app's.
  await expect(row(page, '整理书架').locator('.myday-btn')).toHaveCount(1);
  await row(page, '整理书架').locator('.tt').click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);

  await choose(page, '任务行的操作', '右键菜单');
  await toList(page);
  await expect(row(page, '整理书架').locator('.myday-btn')).toHaveCount(0);
  await row(page, '整理书架').locator('.tt').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '整理书架' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    '完成',
    '☀ 加到今天',
    '截止…',
    '安排…',
    '找时间…',
    '★ 标为重要',
    '暂缓',
    '区域…',
    '上级任务…',
    '打开',
    '删除',
  ]);
  // The first choice has the focus; arrows move it and Escape closes the menu.
  await expect(menu.getByRole('menuitem', { name: '完成' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: '☀ 加到今天' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await row(page, '整理书架').locator('.tt').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '★ 标为重要' }).click();
  await expect(row(page, '整理书架').getByLabel('重要')).toBeVisible();
  // A choice that needs more opens its picker by the row.
  await row(page, '整理书架').locator('.tt').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '截止…' }).click();
  await page.getByRole('dialog', { name: '整理书架' }).getByRole('button', { name: /^明天/ }).click();
  await expect(row(page, '整理书架')).toContainText('明天截止');
  await row(page, '整理书架').locator('.tt').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '删除' }).click();
  await expect(row(page, '整理书架')).toHaveCount(0);
});

test('steps: with the menu chosen, no buttons after the step, and a right-click offers them', async ({ page }) => {
  await start(page);
  await add(page, '写报告');
  await choose(page, '步骤的操作', '右键菜单');
  await toList(page);
  const detail = await openRow(page, '写报告');
  await detail.getByRole('textbox', { name: '添加步骤' }).fill('列提纲');
  await detail.getByRole('textbox', { name: '添加步骤' }).press('Enter');
  const step = detail.locator('.step', { hasText: '' }).first();
  await expect(step.locator('.step-tools')).toHaveCount(0);
  await step.getByRole('textbox', { name: '步骤内容' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '步骤' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    '☀ 今天做这一步',
    '截止…',
    '用时与找时间…',
    '重复…',
    '独立成任务',
    '删除',
  ]);
  await menu.getByRole('menuitem', { name: '☀ 今天做这一步' }).click();
  await expect(step.locator('.step-tag.today')).toBeVisible();
  await step.getByRole('textbox', { name: '步骤内容' }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '删除' }).click();
  await expect(detail.locator('.step')).toHaveCount(0);
});

test('NOW: a right-click on a reserved time finishes, moves or removes it; on an empty time it reserves', async ({
  page,
}) => {
  await start(page);
  await toList(page);
  await page.getByRole('textbox', { name: '记下新任务' }).fill('准备讲义');
  await page.locator('.capture').getByRole('button', { name: '哪天做' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^今天/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '15:00' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '1 小时', exact: true }).click();
  await page.getByRole('textbox', { name: '记下新任务' }).press('Enter');
  await page.getByRole('tab', { name: 'NOW' }).click();
  const block = page.locator('.blk.slot', { hasText: '准备讲义' });
  await block.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '准备讲义' });
  await expect(menu.getByRole('menuitem')).toHaveText(['完成任务', '改时间…', '打开任务', '取消这次预留']);
  await menu.getByRole('menuitem', { name: '改时间…' }).click();
  await expect(page.getByRole('dialog', { name: '详情' })).toBeVisible();
  await page.keyboard.press('Escape');
  await block.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '取消这次预留' }).click();
  await expect(block).toHaveCount(0);
  // An empty time: a right-click reserves it, like a tap.
  await page.locator('.lane-area').click({ button: 'right', position: { x: 40, y: 12 * 40 + 5 } });
  const sheet = page.getByRole('dialog', { name: '预留时段' });
  await expect(sheet.locator('input[type="time"]')).toHaveValue('12:00');
});

test('calendar events: the menu says where they come from; the week view has menus too', async ({ page }) => {
  await start(page);
  await add(page, '周五交报告');
  await page.getByRole('textbox', { name: '记下新任务' }).fill('准备讲义');
  await page.locator('.capture').getByRole('button', { name: '哪天做' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^今天/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '15:00' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '1 小时', exact: true }).click();
  await page.getByRole('textbox', { name: '记下新任务' }).press('Enter');
  await page.getByRole('tab', { name: 'NOW' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  const ev = (uid: string, title: string, ...when: string[]) =>
    ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, ...when, 'END:VEVENT'].join('\r\n');
  const ics = [
    'BEGIN:VCALENDAR',
    ev('a', '组会', 'DTSTART:20260929T130000', 'DTEND:20260929T140000'),
    ev('b', '早读', 'DTSTART:20260929T080000', 'DTEND:20260929T090000'),
    ev('c', '校庆', 'DTSTART;VALUE=DATE:20260929', 'DTEND;VALUE=DATE:20260930'),
    'END:VCALENDAR',
  ].join('\r\n');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入日历文件', exact: true }).click();
  await (await chooser).setFiles({ name: 'cal.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) });
  await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '完成' }).click();
  const agenda = page.getByRole('region', { name: '日程' });
  await agenda.getByRole('button', { name: '日', exact: true }).click();

  // An event: its time and source on top; reserving after it starts where it ends.
  await agenda.locator('.blk.event', { hasText: '组会' }).click({ button: 'right' });
  let menu = page.getByRole('menu', { name: '组会' });
  await expect(menu.locator('.ctx-note')).toHaveText(
    '周二 9/29 · 13:00–14:00（1 小时） · 来自导入的日历文件，这里不能修改',
  );
  await expect(menu.getByRole('menuitem')).toHaveText(['详情', '接着安排一件事（14:00 起）…']);
  await menu.getByRole('menuitem', { name: /接着安排一件事/ }).click();
  await expect(page.getByRole('dialog', { name: '预留时段' }).getByLabel('开始')).toHaveValue('14:00');
  await page.keyboard.press('Escape');
  // Over already, or all day: nothing to reserve after it.
  await agenda.locator('.blk.event', { hasText: '早读' }).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: '早读' }).getByRole('menuitem')).toHaveText(['详情']);
  await page.keyboard.press('Escape');
  await agenda.locator('.pill.allday', { hasText: '校庆' }).click({ button: 'right' });
  menu = page.getByRole('menu', { name: '校庆' });
  await expect(menu.locator('.ctx-note')).toContainText('全天');
  await expect(menu.getByRole('menuitem')).toHaveText(['详情']);
  await menu.getByRole('menuitem', { name: '详情' }).click();
  await expect(page.getByRole('dialog', { name: '详情' })).toContainText('来自导入的日历文件');
  await page.keyboard.press('Escape');

  // The week: events, reserved times, deadlines and the day itself.
  await agenda.getByRole('button', { name: '周', exact: true }).click();
  await agenda.locator('.witem.event', { hasText: '组会' }).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: '组会' }).locator('.ctx-note')).toContainText('来自导入的日历文件');
  await page.keyboard.press('Escape');
  await agenda.locator('.witem.slot', { hasText: '准备讲义' }).click({ button: 'right' });
  menu = page.getByRole('menu', { name: '准备讲义' });
  await expect(menu.getByRole('menuitem')).toHaveText(['完成任务', '改时间…', '打开任务', '取消这次预留']);
  await menu.getByRole('menuitem', { name: '改时间…' }).click();
  await expect(page.getByRole('dialog', { name: '详情' }).getByRole('button', { name: '16:00' })).toBeVisible();
  await page.keyboard.press('Escape');
  await agenda.locator('.witem.due', { hasText: '交报告' }).click({ button: 'right' });
  menu = page.getByRole('menu', { name: '交报告' });
  await expect(menu.locator('.ctx-note')).toHaveText('这天截止');
  await expect(menu.getByRole('menuitem')).toHaveText(['完成任务', '打开任务']);
  await page.keyboard.press('Escape');
  await agenda.getByRole('button', { name: /周三 9\/30/ }).click({ button: 'right' });
  menu = page.getByRole('menu', { name: '周三 9/30' });
  await expect(menu.getByRole('menuitem')).toHaveText(['看这一天', '在这天预留…']);
  await menu.getByRole('menuitem', { name: '在这天预留…' }).click();
  await expect(page.getByRole('dialog', { name: '预留时段' }).getByLabel('开始')).toHaveValue('09:00');
  await page.keyboard.press('Escape');
  await agenda.getByRole('button', { name: /周三 9\/30/ }).click({ button: 'right' });
  await page.getByRole('menu', { name: '周三 9/30' }).getByRole('menuitem', { name: '看这一天' }).click();
  await expect(agenda).toContainText('9/30 周三');
});
