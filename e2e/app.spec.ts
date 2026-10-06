import { expect, test } from '@playwright/test';
import { add, row, start } from './helpers';

test('search finds titles and notes; Enter opens the task', async ({ page }) => {
  await start(page);
  await add(page, '写报告', '买菜');
  const detail = page.getByTestId('task-detail');
  await row(page, '买菜').locator('.title-btn').click();
  await detail.getByRole('button', { name: '编辑正文' }).click();
  await detail.getByRole('textbox', { name: '正文' }).fill('西红柿和鸡蛋');
  await detail.getByRole('textbox', { name: '正文' }).blur();
  await page.getByRole('button', { name: '收起' }).click();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: '搜索' });
  await search.getByRole('combobox', { name: '搜索' }).fill('鸡蛋');
  await expect(search.getByRole('option')).toHaveCount(1);
  await expect(search.getByRole('option')).toContainText('西红柿和鸡蛋');
  await page.keyboard.press('Enter');
  await expect(search).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '任务名称' })).toHaveValue('买菜');
});

test('keyboard: N captures, / searches, Ctrl+Z undoes', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcuts are for desktop');
  await start(page);
  await page.keyboard.press('n');
  await expect(page.getByRole('textbox', { name: '记下新任务' })).toBeFocused();
  await page.keyboard.type('键盘记下的');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+z'); // the capture box is empty again
  await expect(page.locator('.tt', { hasText: '键盘记下的' })).toHaveCount(0);
  await page.getByRole('textbox', { name: '记下新任务' }).blur(); // '/' types a slash while in the box
  await page.keyboard.press('/');
  await expect(page.getByRole('dialog', { name: '搜索' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '搜索' })).toHaveCount(0);
});

test('settings: language, chip order and working time apply at once', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '设置' }).click();
  const sheet = page.getByRole('dialog', { name: '设置' });
  await sheet.getByRole('button', { name: '收进更多: 用时' }).click();
  await sheet.getByRole('button', { name: '放到前排: 重复' }).click();
  await sheet.getByRole('radio', { name: 'English' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Done' }).click();
  await page.getByRole('tab', { name: 'List' }).click();
  const chips = page.locator('.capture .chips');
  await expect(chips.getByRole('button', { name: 'Effort' })).toHaveCount(0);
  await expect(chips.getByRole('button', { name: 'Repeat' })).toBeVisible();
});

test('importing a file from the previous app', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '设置' }).click();
  const legacy = {
    tasks: [
      { id: 'a', title: '旧任务', status: 'next', dueDate: '2026-10-01' },
      { id: 'b', title: '等别人', status: 'waiting' },
      { id: 'c', title: '做完了', status: 'done', completedAt: '2026-09-01T00:00:00.000Z' },
    ],
  };
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入旧应用数据' }).click();
  await (
    await chooser
  ).setFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  await expect(page.locator('.toast')).toContainText('导入了 3 个任务（已完成 1，暂缓 1）');
  await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '完成' }).click();
  await page.getByRole('tab', { name: '清单' }).click();
  await expect(row(page, '旧任务')).toContainText('后天截止');
  await expect(row(page, '等别人')).toHaveClass(/snoozed/);
});

test('importing a calendar file shows its events in the agenda', async ({ page }) => {
  await start(page);
  await add(page, '写报告');
  await page.getByRole('tab', { name: 'NOW' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:1',
    'SUMMARY:组会',
    'DTSTART:20260929T140000',
    'DTEND:20260929T150000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入 .ics' }).click();
  await (await chooser).setFiles({ name: 'cal.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) });
  await expect(page.locator('.toast')).toContainText('导入了 1 个日程');
  await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '完成' }).click();
  await expect(page.locator('.blk.event', { hasText: '组会' })).toContainText('14:00–15:00');
  await expect(page.getByTestId('now-card')).toContainText('接下来 4 小时空闲');
});

test('no horizontal scroll and nothing overlaps the top bar', async ({ page }) => {
  await start(page);
  await add(
    page,
    '一个名字特别特别长的任务，用来检查在手机上会不会撑出横向滚动条或者把右边的信息挤出去 周五截止 3小时',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await row(page, '一个名字特别').locator('.title-btn').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the previous app's data in this browser is imported once, with undo", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('seeded', '1');
      localStorage.setItem(
        'attention-planner-data-v2',
        JSON.stringify({
          tasks: [
            { id: 'old-1', title: '旧应用里的任务', status: 'next' },
            { id: 'old-2', title: '等回信', status: 'waiting' },
          ],
        }),
      );
    }
  });
  await start(page);
  await expect(page.locator('.toast')).toContainText('已导入旧应用的 2 个任务');
  await page.getByRole('tab', { name: '清单' }).click();
  await expect(row(page, '旧应用里的任务')).toBeVisible();
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole('tab', { name: '清单' }).click();
  await expect(page.locator('.tt', { hasText: '旧应用里的任务' })).toHaveCount(1);
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('a calendar subscribed by address appears in the agenda and can be removed', async ({ page }) => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:s1',
    'SUMMARY:水文课',
    'LOCATION:SC 3505',
    'DTSTART:20260929T130000',
    'DTEND:20260929T141500',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  await page.route('**/ics?url=*', (route) => {
    expect(decodeURIComponent(route.request().url())).toContain('example.edu/classes.ics'); // webcal is turned into https on the server
    return route.fulfill({ status: 200, contentType: 'text/calendar', body: ics });
  });
  await start(page);
  await page.getByRole('button', { name: '设置' }).click();
  const sheet = page.getByRole('dialog', { name: '设置' });
  await sheet.getByLabel('订阅名称').fill('课表');
  await sheet.getByLabel('日历订阅地址').fill('webcal://example.edu/classes.ics');
  await sheet.getByRole('button', { name: '订阅', exact: true }).click();
  await expect(sheet.locator('.sub-row', { hasText: '课表' })).toContainText('1 个日程');
  await sheet.getByRole('button', { name: '完成' }).click();
  await expect(page.locator('.blk.event', { hasText: '水文课' })).toContainText('13:00–14:15');
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '取消订阅: 课表' }).click();
  await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '完成' }).click();
  await expect(page.locator('.blk.event', { hasText: '水文课' })).toHaveCount(0);
});

test('web-page shortcuts are taken over: Ctrl+S syncs instead of saving the page, Ctrl+F searches tasks', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard shortcuts are for desktop');
  await start(page);
  // Note, after the app has handled it, whether the browser's own action for Ctrl+S was stopped.
  await page.evaluate(() =>
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 's') (window as unknown as { saved?: boolean }).saved = e.defaultPrevented;
    }),
  );
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => (window as unknown as { saved?: boolean }).saved)).toBe(true);
  await expect(page.locator('.toast')).toContainText('已自动保存');
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('dialog', { name: /搜索/ })).toBeVisible();
});

test('the goal is written in Settings and shows on NOW only when turned on', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  await dialog.getByRole('textbox', { name: '目标' }).fill('# 做出能被用起来的科研\n身体健康地读完博士');
  await dialog.getByRole('textbox', { name: '目标' }).blur();
  await dialog.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('button', { name: '目标' })).toHaveCount(0); // off unless turned on
  await page.getByRole('button', { name: '设置' }).click();
  await dialog.getByRole('checkbox', { name: '在 NOW 顶部显示' }).check();
  await dialog.getByRole('button', { name: '完成' }).click();
  const goal = page.getByRole('button', { name: '目标' });
  await expect(goal).toHaveText('做出能被用起来的科研');
  await goal.click();
  await expect(goal).toContainText('身体健康地读完博士');
});

test('Settings are grouped: the navigation jumps to a group and follows the scrolling', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  const nav = dialog.getByRole('navigation', { name: '设置分组' });
  await expect(nav.locator('[aria-current="true"]')).toHaveText('常用');
  await nav.getByRole('button', { name: '同步与数据' }).click();
  await expect(nav.locator('[aria-current="true"]')).toHaveText('同步与数据');
  await expect(dialog.getByRole('button', { name: '导出备份' })).toBeInViewport();
  await page.waitForTimeout(900); // a chosen group stays marked while the pane scrolls to it
  await dialog.locator('.settings-pane').evaluate((el) => (el.scrollTop = 0));
  await expect(nav.locator('[aria-current="true"]')).toHaveText('常用');
  // The pane never scrolls sideways.
  expect(await dialog.locator('.settings-pane').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(
    1,
  );
});
