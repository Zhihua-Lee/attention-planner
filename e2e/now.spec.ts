import { expect, test } from '@playwright/test';
import { add, openRow, row, start, T0, toList } from './helpers';

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
  await page.getByRole('dialog').getByRole('button', { name: '2 小时' }).click();
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
  await expect(page.getByTestId('task-detail')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '任务名称' })).toHaveValue('复习');
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
  await page.reload();
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
