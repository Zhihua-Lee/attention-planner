import { expect, test } from '@playwright/test';
import { add, openRow, row, start, reloadSaved, T0 } from './helpers';

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

test('a local path in the note is a link: copied, or opened where this device can', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await start(page);
  await add(page, '整理笔记');
  const detail = await openRow(page, '整理笔记');
  await detail.getByRole('button', { name: '编辑正文' }).click();
  await detail.getByRole('textbox', { name: '正文' }).fill('先看 D:\\笔记\\.ai\\计划.md，再整理 `D:\\my notes`');
  await detail.getByRole('textbox', { name: '正文' }).blur();
  const links = detail.locator('.note-view a');
  await expect(links).toHaveText(['D:\\笔记\\.ai\\计划.md', 'D:\\my notes']);
  await expect(links.first()).toHaveAttribute('href', /^ap-open:D%3A%5C/);

  // Without the helper the browser cannot open it, so a click copies the path and the note stays as it is.
  await links.nth(1).click();
  await expect(page.locator('.toast')).toContainText('已复制路径：D:\\my notes');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('D:\\my notes');
  await expect(detail.getByRole('textbox', { name: '正文' })).toHaveCount(0);

  // With the helper, the click is left to the browser, which hands the link to it.
  await page.getByRole('button', { name: '设置' }).click();
  const sheet = page.getByRole('dialog', { name: '设置' });
  await sheet.getByRole('checkbox', { name: '这台设备点路径直接打开' }).check();
  await sheet.getByRole('button', { name: '完成' }).click();
  await page.evaluate(() =>
    window.addEventListener('click', (e) => {
      (window as unknown as { left: boolean }).left = !e.defaultPrevented;
      e.preventDefault(); // the test browser has no helper to hand it to
    }),
  );
  await detail.locator('.note-view a').first().click();
  expect(await page.evaluate(() => (window as unknown as { left: boolean }).left)).toBe(true);
});

test('the folders you work in are listed in Settings, with the install command for them', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await start(page);
  await page.getByRole('button', { name: '设置' }).click();
  const sheet = page.getByRole('dialog', { name: '设置' });
  const add = sheet.getByRole('button', { name: '添加', exact: true });
  await sheet.getByRole('textbox', { name: '文件夹路径' }).fill('研究');
  await expect(add).toBeDisabled(); // not a full path
  await sheet.getByRole('textbox', { name: '文件夹路径' }).fill('E:/research/');
  await sheet.getByRole('textbox', { name: '文件夹用途' }).fill('论文和数据');
  await add.click();
  await sheet.getByRole('textbox', { name: '文件夹路径' }).fill('D:\\my notes');
  await add.click();
  await expect(sheet.locator('.sub-row .sub-name')).toHaveText(['E:\\research', 'D:\\my notes']);
  await expect(sheet.locator('.sub-row').first()).toContainText('论文和数据');
  const command = 'powershell -ExecutionPolicy Bypass -File .\\install.ps1 -Roots "E:\\research;D:\\my notes"';
  await expect(sheet.getByLabel('安装命令')).toHaveText(command);
  await expect(sheet.locator('.install-where')).toContainText('tools\\open-link');
  await sheet.getByRole('button', { name: '复制安装命令' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);

  await sheet.getByRole('button', { name: '移除文件夹: D:\\my notes' }).click();
  await expect(sheet.locator('.sub-row .sub-name')).toHaveText(['E:\\research']);
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
  await page.getByRole('textbox', { name: '新的区域' }).fill('研究');
  await page.getByRole('dialog').getByRole('button', { name: '添加' }).click();
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
  await reloadSaved(page);
  await page.getByRole('tab', { name: '清单' }).click();
  await expect(page.locator('.list .tt')).toHaveText(['一', '二', '三']);
  await page.getByRole('radio', { name: '智能' }).click();
  await expect(page.locator('.list .tt')).toHaveText(['三', '二', '一']);
});

test('a key pressed as a drag is let go starts from the dragged order', async ({ page }) => {
  await start(page);
  await add(page, '一', '二', '三');
  await page.getByRole('radio', { name: '手动' }).click();
  const target = await page.getByRole('button', { name: /拖动排序.*: 三/ }).boundingBox();
  const box = await page.getByRole('button', { name: /拖动排序.*: 一/ }).boundingBox();
  const x = box!.x + box!.width / 2;
  const top = target!.y - 8;
  await page.mouse.move(x, box!.y + box!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, box!.y + ((top - box!.y) * i) / 10);
  await expect(page.locator('.list .tt')).toHaveText(['一', '三', '二']);
  // Let go and press ↑ in one go, before the next frame, when the drop is reported.
  await page.evaluate(
    ({ x, y }) => {
      const up = { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true, button: 0 };
      window.dispatchEvent(new PointerEvent('pointerup', up));
      const handle = [...document.querySelectorAll('.list .handle')].find((b) => /: 二$/.test(b.ariaLabel ?? ''));
      handle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    },
    { x, y: top },
  );
  await expect(page.locator('.list .tt')).toHaveText(['一', '二', '三']);
  await page.waitForTimeout(400);
  await expect(page.locator('.list .tt')).toHaveText(['一', '二', '三']);
  await reloadSaved(page);
  await page.getByRole('tab', { name: '清单' }).click();
  await expect(page.locator('.list .tt')).toHaveText(['一', '二', '三']);
});

test('a subtask is listed under its parent task, at any depth, and cannot take its own subtask as parent', async ({
  page,
}) => {
  await start(page);
  await add(page, '论文', '重画图 3', '画坐标轴', '别的事 !');
  const under = async (child: string, parent: string) => {
    const detail = await openRow(page, child);
    await detail.getByRole('button', { name: '无' }).click();
    await page.getByRole('textbox', { name: '搜索任务' }).fill(parent);
    await page.getByRole('dialog').getByRole('button', { name: parent }).click();
    await page.getByRole('button', { name: '收起' }).click();
    await expect(page.getByTestId('task-detail')).toHaveCount(0);
  };
  await under('重画图 3', '论文');
  await under('画坐标轴', '重画图 3');
  await expect(page.locator('.list > .row .tt')).toHaveText(['别的事', '论文', '重画图 3', '画坐标轴']);
  await expect(row(page, '重画图 3')).toHaveAttribute('style', /--depth: 1/);
  await expect(row(page, '画坐标轴')).toHaveAttribute('style', /--depth: 2/);
  const detail = await openRow(page, '论文');
  await expect(detail).toContainText('子任务：重画图 3');
  await detail.getByRole('button', { name: '无' }).click();
  await page.getByRole('textbox', { name: '搜索任务' }).fill('画');
  await expect(page.getByRole('dialog').getByRole('button', { name: '画坐标轴' })).toHaveCount(0);
});

test('“only the next one” shows each parent task with its next subtask; a subtask is in its parent’s area', async ({
  page,
}) => {
  await start(page);
  await add(page, '别的事', '论文', '写摘要', '画图');
  for (const child of ['写摘要', '画图']) {
    const detail = await openRow(page, child);
    await detail.getByRole('button', { name: '无' }).click();
    await page.getByRole('textbox', { name: '搜索任务' }).fill('论文');
    await page.getByRole('dialog').getByRole('button', { name: '论文' }).click();
    await page.getByRole('button', { name: '收起' }).click();
    await expect(page.getByTestId('task-detail')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '只看下一个' }).click();
  // Newest first: 画图 is the next one under 论文.
  await expect(page.locator('.list > .row .tt')).toHaveText(['论文', '画图', '别的事']);
  await expect(row(page, '论文')).toContainText('还有 1 个子任务');
  await page.getByRole('button', { name: '只看下一个' }).click();
  await expect(page.locator('.list > .row .tt')).toHaveText(['论文', '画图', '写摘要', '别的事']);
  // An area on the parent: the subtasks show under its filter too.
  const detail = await openRow(page, '论文');
  await detail.getByRole('button', { name: '未分类' }).click();
  await page.getByRole('textbox', { name: '新的区域' }).fill('研究');
  await page.getByRole('dialog').getByRole('button', { name: '添加' }).click();
  await page.getByRole('button', { name: '收起' }).click();
  await expect(page.getByTestId('task-detail')).toHaveCount(0);
  await page.locator('.filters').getByRole('button', { name: /^研究/ }).click();
  await expect(page.locator('.list > .row .tt')).toHaveText(['论文', '画图', '写摘要']);
  const sub = await openRow(page, '画图');
  await expect(sub.getByRole('button', { name: '研究（随上级任务）' })).toBeVisible();
});

test('“by area” shows “All” in sections that fold, and a folded one stays folded', async ({ page }) => {
  await start(page);
  await add(page, '回邮件 !', '投稿');
  const detail = await openRow(page, '投稿');
  await detail.getByRole('button', { name: '未分类' }).click();
  await page.getByRole('textbox', { name: '新的区域' }).fill('科研');
  await page.getByRole('dialog').getByRole('button', { name: '添加' }).click();
  await page.getByRole('button', { name: '收起' }).click();
  await expect(page.getByTestId('task-detail')).toHaveCount(0);
  await page.getByRole('button', { name: '按区域分组' }).click();
  // Each area runs down the left of its tasks.
  await expect(page.locator('.area-name')).toHaveText(['科研', '没有区域']);
  await expect(page.locator('.list .row .tt')).toHaveText(['投稿', '回邮件']);
  const open = '.area-sec:not(.folded) .row .tt';
  await page.getByRole('button', { name: '科研，1 个任务' }).click();
  await expect(page.getByRole('button', { name: '科研 · 1 个已收起' })).toBeVisible();
  await expect(page.locator(open)).toHaveText(['回邮件']);
  await reloadSaved(page);
  await page.getByRole('tab', { name: '清单' }).click();
  await expect(page.getByRole('button', { name: '科研，1 个任务' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(open)).toHaveText(['回邮件']);
  await page.getByRole('button', { name: '按区域分组' }).click();
  await expect(page.locator('.list .row .tt')).toHaveText(['回邮件', '投稿']);
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

test('add to today from a row (☀ or T); yesterday’s plans are offered; Today explains itself', async ({
  page,
  isMobile,
}) => {
  await start(page);
  await add(page, '打电话给银行', '写周报 !', '随手记的');
  await page.locator('.filters').getByRole('button', { name: /^今天/ }).click();
  await expect(page.locator('.list .tt')).toHaveCount(0);
  await page.locator('.filters').getByRole('button', { name: /^全部/ }).click();
  if (isMobile) {
    // Swipe left on the row.
    const box = (await row(page, '打电话给银行').locator('.row-main').boundingBox())!;
    await page.mouse.move(box.x + box.width - 40, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width - 40 - i * 20, box.y + box.height / 2);
    await page.mouse.up();
  } else {
    await row(page, '打电话给银行').hover();
    await page.getByRole('button', { name: '加到今天: 打电话给银行' }).click();
    await row(page, '写周报').locator('.title-btn').focus();
    await page.keyboard.press('t');
  }
  await expect(page.locator('.toast')).toContainText('已加到今天');
  await page.locator('.filters').getByRole('button', { name: /^今天/ }).click();
  await expect(page.locator('.list .tt')).toContainText(['打电话给银行']);
  // Filters for important and unplanned.
  await page.locator('.filters').getByRole('button', { name: /^重要/ }).click();
  await expect(page.locator('.list .tt')).toHaveText(['写周报']);
  await page
    .locator('.filters')
    .getByRole('button', { name: /^未安排/ })
    .click();
  await expect(page.locator('.list .tt')).toContainText(['随手记的']);
  // The next day: yesterday's plan is offered, not moved.
  await page.clock.setFixedTime(new Date(T0.getTime() + 864e5));
  await reloadSaved(page);
  await page.getByRole('tab', { name: '清单' }).click();
  await page.locator('.filters').getByRole('button', { name: /^今天/ }).click();
  await expect(page.locator('.carry')).toContainText('昨天计划了');
  await page.locator('.carry').getByRole('button', { name: '都加到今天' }).click();
  await expect(page.locator('.list .tt')).toContainText(['打电话给银行']);
  await page.getByRole('button', { name: '“今天”包括什么' }).click();
  await expect(page.getByRole('dialog', { name: '“今天”包括什么' })).toContainText('今天截止或已经逾期的');
});

test('an open task closes on a click outside it, on the blank of its top line, or with Escape', async ({ page }) => {
  await start(page);
  await add(page, '写报告', '别的事');
  await openRow(page, '写报告');
  // A menu inside it closes first; the task stays open.
  await page.getByTestId('task-detail').getByRole('button', { name: '未填' }).click();
  await page.locator('.list-bar').click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('task-detail')).toHaveCount(1);
  await page.locator('.list-bar').click({ position: { x: 2, y: 2 } });
  await expect(page.getByTestId('task-detail')).toHaveCount(0);
  await openRow(page, '写报告');
  // The open task's row shows its name in a box, so it is found by its details.
  await page
    .locator('[data-task]', { has: page.getByTestId('task-detail') })
    .locator('.row-main')
    .click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId('task-detail')).toHaveCount(0);
  await openRow(page, '写报告');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-detail')).toHaveCount(0);
});

test('“by area”: while a long section scrolls past, its name stays near the middle of the screen', async ({ page }) => {
  await start(page);
  await add(page, ...Array.from({ length: 24 }, (_, i) => `任务 ${i + 1}`));
  await page.getByRole('button', { name: '设置' }).click();
  const sheet = page.getByRole('dialog', { name: '设置' });
  await sheet.getByRole('textbox', { name: '新的区域' }).fill('科研');
  await sheet.getByRole('button', { name: '加区域' }).click();
  await sheet.getByRole('button', { name: '完成' }).click();
  // Put them all in it, through the stored document, then group.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok) => {
      const r = indexedDB.open('attention-planner', 1);
      r.onsuccess = () => ok(r.result);
    });
    const doc = await new Promise<{ tasks: Record<string, { areaId?: string }>; areas: Record<string, unknown> }>(
      (ok) => {
        const r = db.transaction('kv').objectStore('kv').get('doc');
        r.onsuccess = () => ok(r.result);
      },
    );
    const area = Object.keys(doc.areas)[0];
    for (const t of Object.values(doc.tasks)) t.areaId = area;
    await new Promise((ok) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(doc, 'doc');
      tx.oncomplete = ok;
    });
  });
  await page.reload();
  await page.getByRole('tab', { name: '清单' }).click();
  await page.getByRole('button', { name: '按区域分组' }).click();
  const middle = (page.viewportSize()?.height ?? 800) / 2;
  for (const y of [300, 700]) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(100);
    const box = (await page.locator('.area-name').first().boundingBox())!;
    expect(Math.abs(box.y + box.height / 2 - middle)).toBeLessThan(60);
  }
});
