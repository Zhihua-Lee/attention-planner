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

test('filters follow the tasks: today includes repeating work; empty ones hide; areas are chips', async ({ page }) => {
  await start(page);
  await page.getByRole('tab', { name: '清单' }).click();
  await expect(page.locator('.filters')).not.toContainText('新加的'); // nothing new yet, so no chip
  await add(page, '今天下午 整理', '周五交表格', '随手记的', '每天看邮件');
  // "每天" makes it a task that reopens every day, and such a task belongs to today.
  const detail = await openRow(page, '看邮件');
  await expect(detail.getByRole('button', { name: /原地重开/ })).toBeVisible();
  await page.getByRole('button', { name: '收起' }).click();
  await page.getByRole('button', { name: /^新加的/ }).click();
  await expect(page.locator('.list .tt')).toHaveText(['随手记的']);
  await page.getByRole('button', { name: /^今天/ }).click();
  await expect(page.locator('.list .tt')).toHaveText(['看邮件', '整理']); // newest first
  await page.getByRole('button', { name: /^7 天内截止/ }).click();
  await expect(page.locator('.list .tt')).toHaveText(['交表格']);
  await page.getByRole('button', { name: /^全部/ }).click();
  const d2 = await openRow(page, '交表格');
  await d2.getByRole('button', { name: '未分类' }).click();
  await page.getByRole('textbox', { name: '新的区域或项目' }).fill('研究');
  await page.getByRole('dialog').getByRole('button', { name: '区域' }).click();
  await expect(d2.getByRole('button', { name: '研究' })).toBeVisible();
  await page.getByRole('button', { name: '收起' }).click();
  await page.locator('.filters').getByRole('button', { name: /^研究/ }).click();
  await expect(page.locator('.list .tt')).toHaveText(['交表格']);
});

test('the filters shown are chosen in Settings; "with a deadline" lists every task that has one', async ({ page }) => {
  await start(page);
  await add(page, '周五交表格', '下周五交论文', '随手记的');
  await page.getByRole('button', { name: /^有截止/ }).click();
  await expect(page.locator('.list .tt')).toHaveText(['交表格', '交论文']);
  await page.getByRole('button', { name: /^7 天内截止/ }).click();
  await expect(page.locator('.list .tt')).toHaveText(['交表格']);
  await page.getByRole('button', { name: /^全部/ }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('checkbox', { name: '新加的' }).uncheck();
  await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '完成' }).click();
  await expect(page.locator('.filters')).not.toContainText('新加的');
  await expect(page.locator('.filters')).toContainText('有截止');
});

test('the list can be sorted by hand by dragging', async ({ page }) => {
  await start(page);
  await add(page, '一', '二', '三');
  await expect(page.locator('.list .tt')).toHaveText(['三', '二', '一']); // newest first
  await page.getByRole('radio', { name: '手动' }).click();
  const handle = page.getByRole('button', { name: /拖动排序.*: 一/ });
  const target = await page.getByRole('button', { name: /拖动排序.*: 三/ }).boundingBox();
  const box = await handle.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(box!.x + box!.width / 2, box!.y + ((target!.y - 8 - box!.y) * i) / 10);
  await page.mouse.up();
  await expect(page.locator('.list .tt')).toHaveText(['一', '三', '二']);
  await page.getByRole('button', { name: /拖动排序.*: 二/ }).press('ArrowUp');
  await expect(page.locator('.list .tt')).toHaveText(['一', '二', '三']);
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole('tab', { name: '清单' }).click();
  await expect(page.locator('.list .tt')).toHaveText(['一', '二', '三']);
  await page.getByRole('radio', { name: '智能' }).click();
  await expect(page.locator('.list .tt')).toHaveText(['三', '二', '一']);
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

test('a project done in order queues its later tasks', async ({ page }) => {
  await start(page);
  await add(page, '收数据', '分析 !');
  for (const title of ['收数据', '分析']) {
    const detail = await openRow(page, title);
    await detail.getByRole('button', { name: '未分类' }).click();
    if (title === '收数据') {
      await page.getByRole('textbox', { name: '新的区域或项目' }).fill('论文');
      await page.getByRole('dialog').getByRole('button', { name: '项目' }).click();
    } else await page.getByRole('dialog').getByRole('button', { name: '论文' }).click();
    await page.getByRole('button', { name: '收起' }).click();
  }
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('dialog', { name: '设置' }).getByRole('checkbox', { name: '按顺序' }).check();
  await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '完成' }).click();
  await expect(row(page, '分析')).toContainText('排队中 · 前面还有 1 个');
  await page.getByRole('tab', { name: 'NOW' }).click();
  await expect(page.getByTestId('now-card').getByRole('heading')).toHaveText('收数据');
});

test('the note keeps its place and height when it switches to editing', async ({ page }) => {
  await start(page);
  await add(page, '写引言');
  const detail = await openRow(page, '写引言');
  await detail.getByRole('button', { name: '编辑正文' }).click();
  await detail.getByRole('textbox', { name: '正文' }).fill('第一行\n第二行\n第三行');
  await detail.getByRole('textbox', { name: '正文' }).blur();
  await page.waitForTimeout(500); // let the detail's height animation after saving settle
  await detail.locator('.note-view').scrollIntoViewIfNeeded();
  const view = (await detail.locator('.note-view').boundingBox())!;
  await detail.locator('.note-view').click();
  const edit = (await detail.getByRole('textbox', { name: '正文' }).boundingBox())!;
  expect(Math.abs(edit.y - view.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(edit.x - view.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(edit.height - view.height)).toBeLessThanOrEqual(4);
});
