import { expect, test } from '@playwright/test';
import { add, openRow, row, start, T0, toList } from './helpers';

/** On a phone a step's buttons appear once the step is focused, so focus it first. */
const tool = async (detail: import('@playwright/test').Locator, name: string, step: string) => {
  await detail
    .locator('.step')
    .filter({ has: detail.page().getByRole('checkbox', { name: step, exact: true }) })
    .locator('.step-text')
    .click();
  await detail.getByRole('button', { name: `${name}: ${step}` }).click();
};

const addSteps = async (detail: import('@playwright/test').Locator, ...texts: string[]) => {
  for (const text of texts) {
    await detail.getByRole('textbox', { name: '添加步骤' }).fill(text);
    await detail.getByRole('textbox', { name: '添加步骤' }).press('Enter');
  }
};

test('a step can have its own deadline; NOW and the list name the step', async ({ page }) => {
  await start(page);
  await add(page, '周五交报告');
  const detail = await openRow(page, '交报告');
  await addSteps(detail, '画图', '写结论');
  await tool(detail, '截止', '画图');
  await page.getByRole('dialog', { name: '步骤' }).getByRole('button', { name: /^今天/ }).click();
  await expect(detail.locator('.step-tag', { hasText: '今天截止' })).toBeVisible();
  await page.getByRole('button', { name: '收起' }).click();
  await expect(row(page, '交报告')).toContainText('画图 · 今天截止');
  await page.getByRole('tab', { name: 'NOW' }).click();
  await expect(page.getByTestId('now-card')).toContainText('步骤“画图”今天截止');
});

test('settings choose the buttons after each step; a step becomes its own linked task', async ({ page }) => {
  await start(page);
  await add(page, '论文');
  let detail = await openRow(page, '论文');
  await addSteps(detail, '重画图 3');
  await expect(detail.getByRole('button', { name: '独立成任务: 重画图 3' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: '用时: 重画图 3' })).toHaveCount(0);
  await page.getByRole('button', { name: '设置' }).click();
  const sheet = page.getByRole('dialog', { name: '设置' });
  await sheet.getByRole('checkbox', { name: '用时' }).check();
  await sheet.getByRole('checkbox', { name: '独立成任务' }).check();
  await sheet.getByRole('checkbox', { name: '截止' }).uncheck();
  await sheet.getByRole('button', { name: '完成' }).click();
  detail = page.getByTestId('task-detail');
  await expect(detail.getByRole('button', { name: '截止: 重画图 3' })).toHaveCount(0);
  await tool(detail, '用时', '重画图 3');
  await page.getByRole('dialog', { name: '步骤' }).getByRole('button', { name: '2 小时' }).click();
  await expect(detail.getByRole('button', { name: /2 小时（步骤合计）/ })).toBeVisible();
  await tool(detail, '独立成任务', '重画图 3');
  await expect(page.locator('.toast')).toContainText('成了独立的任务');
  await page.getByRole('button', { name: '收起' }).click();
  await expect(row(page, '重画图 3')).toHaveClass(/linked/);
  await expect(page.locator('.list > .row .tt')).toHaveText(['论文', '重画图 3']);
});

test('steps reorder by dragging the handle', async ({ page }) => {
  await start(page);
  await add(page, '准备');
  const detail = await openRow(page, '准备');
  await addSteps(detail, '一', '二', '三');
  const handle = detail.getByRole('button', { name: /拖动排序.*: 三/ });
  const target = await detail.getByRole('button', { name: /拖动排序.*: 一/ }).boundingBox();
  const box = await handle.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(box!.x + box!.width / 2, box!.y + ((target!.y - 6 - box!.y) * i) / 10);
  await page.mouse.up();
  await expect
    .poll(() => detail.locator('.step-text').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)))
    .toEqual(['三', '一', '二']);
  await page.reload();
  await toList(page);
  const again = await openRow(page, '准备');
  await expect
    .poll(() => again.locator('.step-text').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)))
    .toEqual(['三', '一', '二']);
});

test('a step in a plain task can repeat on its own rule', async ({ page }) => {
  await start(page);
  await add(page, '日常');
  const detail = await openRow(page, '日常');
  await addSteps(detail, '看邮件', '一次性的事');
  await tool(detail, '重复', '看邮件');
  const pop = page.getByRole('dialog', { name: '步骤' });
  await pop.getByRole('radio', { name: '单独重复' }).click();
  await expect(pop.getByRole('combobox', { name: '频率' })).toHaveValue('daily');
  await page.keyboard.press('Escape');
  await expect(detail.locator('.step-tag', { hasText: '每天' })).toBeVisible();
  await detail.getByRole('checkbox', { name: '看邮件' }).check();
  await detail.getByRole('checkbox', { name: '一次性的事' }).check();
  await page.clock.setFixedTime(new Date(T0.getTime() + 864e5));
  await page.reload();
  await toList(page);
  const next = await openRow(page, '日常');
  await expect(next.getByRole('checkbox', { name: '看邮件' })).not.toBeChecked();
  await expect(next.getByRole('checkbox', { name: '一次性的事' })).toBeChecked();
});

test('a long step wraps instead of being cut off, and Shift+Enter adds a line', async ({ page }) => {
  await start(page);
  await add(page, '复习');
  const detail = await openRow(page, '复习');
  await addSteps(detail, '把第三章所有例题重新做一遍，特别是第 12 到 20 题，做完对照答案写出错因，再整理到错题本里');
  const text = detail.locator('.step-text').first();
  const box = await text.boundingBox();
  expect(box!.height).toBeGreaterThan(30); // more than one line
  expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await text.click();
  await page.keyboard.press('Control+End'); // the end of the text, not of the wrapped line
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('第二行');
  await page.keyboard.press('Enter');
  await expect(text).toHaveValue(/\n第二行$/);
  await page.waitForTimeout(400);
  await page.reload();
  await toList(page);
  const again = await openRow(page, '复习');
  await expect(again.locator('.step-text').first()).toHaveValue(/\n第二行$/);
});
