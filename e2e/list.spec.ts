import { expect, test } from '@playwright/test';
import { add, openRow, row, start } from './helpers';

test('completing a task moves it to Done, with undo', async ({ page }) => {
  await start(page);
  await add(page, '买参考书');
  await row(page, '买参考书').getByRole('checkbox').click();
  await expect(page.locator('.list > .row .tt', { hasText: '买参考书' })).toHaveCount(0);
  await page.getByRole('button', { name: /已完成 1/ }).click();
  await expect(row(page, '买参考书')).toHaveClass(/done/);
  await page.locator('.toast').getByRole('button', { name: '撤销' }).click();
  await expect(row(page, '买参考书')).not.toHaveClass(/done/);
});

test('details edit in place: title, steps, arrangement, effort, snooze', async ({ page }) => {
  await start(page);
  await add(page, '写报告');
  const detail = await openRow(page, '写报告');
  const title = page.getByRole('textbox', { name: '任务名称' });
  await title.fill('写实验报告');
  await title.press('Enter');
  await detail.getByRole('textbox', { name: '添加步骤' }).fill('整理数据');
  await detail.getByRole('textbox', { name: '添加步骤' }).press('Enter');
  await detail.getByRole('textbox', { name: '添加步骤' }).fill('画图');
  await detail.getByRole('textbox', { name: '添加步骤' }).press('Enter');
  await detail.getByRole('button', { name: /拖动排序.*: 画图/ }).press('ArrowUp');
  await expect(detail.locator('.step-text').first()).toHaveValue('画图');
  await detail.getByRole('button', { name: '+ 添加' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /明天/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '晚上' }).click();
  await detail.getByRole('button', { name: '+ 添加' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /后天/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '上午' }).click();
  await expect(detail.locator('.pill', { hasText: '明天 晚上' })).toBeVisible();
  await expect(detail.locator('.pill', { hasText: '后天 上午' })).toBeVisible();
  await detail.getByRole('button', { name: '未填' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '2 小时' }).click();
  await detail.getByRole('checkbox', { name: '暂缓' }).check();
  await detail.getByRole('textbox', { name: '暂缓原因' }).fill('等数据');
  await detail.getByRole('textbox', { name: '暂缓原因' }).blur();
  await page.getByRole('button', { name: '收起' }).click();
  const r = row(page, '写实验报告');
  await expect(r).toHaveClass(/snoozed/);
  await page.getByRole('button', { name: /暂缓 1/ }).click();
  await expect(r).toBeVisible();
});

test('the note renders Markdown and edits on click', async ({ page }) => {
  await start(page);
  await add(page, '复习');
  const detail = await openRow(page, '复习');
  await detail.getByRole('button', { name: '编辑正文' }).click();
  await detail.getByRole('textbox', { name: '正文' }).fill('看 **第 3 章**\n\n- 例题');
  await detail.getByRole('textbox', { name: '正文' }).blur();
  await expect(detail.locator('.note-view strong')).toHaveText('第 3 章');
  await expect(detail.locator('.note-view li')).toHaveText('例题');
});

test('filters: new, today, due; areas group the list', async ({ page }) => {
  await start(page);
  await add(page, '今天下午 整理', '周五交表格', '随手记的');
  await page.getByRole('button', { name: /^新加的/ }).click();
  await expect(page.locator('.list .tt')).toHaveText(['随手记的']);
  await page.getByRole('button', { name: /^今天/ }).click();
  await expect(page.locator('.list .tt')).toHaveText(['整理']);
  await page.getByRole('button', { name: /^有截止/ }).click();
  await expect(page.locator('.list .tt')).toHaveText(['交表格']);
  await page.getByRole('button', { name: /^全部/ }).click();
  const detail = await openRow(page, '交表格');
  await detail.getByRole('button', { name: '未分类' }).click();
  await page.getByRole('textbox', { name: '新的区域或项目' }).fill('研究');
  await page.getByRole('dialog').getByRole('button', { name: '区域' }).click();
  await expect(detail.getByRole('button', { name: '研究' })).toBeVisible();
  await page.getByRole('button', { name: '收起' }).click();
  await page.getByRole('combobox', { name: '按区域或项目' }).selectOption({ label: '研究' });
  await expect(page.locator('.list .tt')).toHaveText(['交表格']);
});

test('a linked task is listed right after the task it points to', async ({ page }) => {
  await start(page);
  await add(page, '论文', '重画图 3', '别的事 !');
  const detail = await openRow(page, '重画图 3');
  await detail.getByRole('button', { name: '无' }).click();
  await page.getByRole('textbox', { name: '搜索任务' }).fill('论文');
  await page.getByRole('dialog').getByRole('button', { name: '论文' }).click();
  await page.getByRole('button', { name: '收起' }).click();
  await expect(page.locator('.list > .row .tt')).toHaveText(['别的事', '论文', '重画图 3']);
  await expect(row(page, '重画图 3')).toHaveClass(/linked/);
});
