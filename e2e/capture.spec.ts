import { expect, test } from '@playwright/test';
import { add, openRow, row, start, toList } from './helpers';

test('capture recognises a deadline, effort and importance, and saves on Enter', async ({ page }) => {
  await start(page);
  await toList(page);
  const box = page.getByRole('textbox', { name: '记下新任务' });
  await box.fill('周五交报告 3小时 !');
  const chips = page.locator('.capture .chips');
  await expect(chips.getByRole('button', { name: /截止：周五截止/ })).toBeVisible();
  await expect(chips.getByRole('button', { name: /用时：3 小时/ })).toBeVisible();
  await expect(chips.getByRole('button', { name: '★' })).toHaveAttribute('aria-pressed', 'true');
  await box.press('Enter');
  await expect(box).toHaveValue('');
  const r = row(page, '交报告');
  await expect(r).toContainText('周五截止');
  await expect(r.locator('.st')).toBeVisible();
});

test('a chip offers the next detail and a second tap clears it', async ({ page }) => {
  await start(page);
  await toList(page);
  const box = page.getByRole('textbox', { name: '记下新任务' });
  await box.fill('写周报');
  await page.locator('.capture').getByRole('button', { name: '哪天做' }).click();
  await page.getByRole('dialog', { name: '哪天做' }).getByRole('button', { name: /明天/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '下午' }).click();
  const when = page.locator('.capture').getByRole('button', { name: /哪天做：明天 下午/ });
  await expect(when).toBeVisible();
  await page.locator('.capture').getByRole('button', { name: '截止' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /后天/ }).click();
  await expect(page.locator('.chip.nudge')).toBeVisible(); // a deadline without effort asks for effort
  await when.click();
  await expect(page.locator('.capture').getByRole('button', { name: '哪天做' })).toBeVisible();
  await box.press('Enter');
  await expect(row(page, '写周报')).toContainText('后天截止');
});

test('reserving a time uses a half-hour grid and a duration', async ({ page }) => {
  await start(page);
  await toList(page);
  await page.getByRole('textbox', { name: '记下新任务' }).fill('准备讲义');
  await page.locator('.capture').getByRole('button', { name: '哪天做' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^今天/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '15:00' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '1.5 小时' }).click();
  await expect(page.locator('.capture').getByRole('button', { name: /今天 15:00–16:30/ })).toBeVisible();
  await page.getByRole('textbox', { name: '记下新任务' }).press('Enter');
  await page.getByRole('tab', { name: 'NOW' }).click();
  await expect(page.locator('.blk.slot', { hasText: '准备讲义' })).toContainText('15:00–16:30');
  await page.locator('.blk.slot', { hasText: '准备讲义' }).click();
  await page.getByRole('dialog', { name: '详情' }).getByRole('button', { name: '打开任务' }).click();
  const detail = page.getByTestId('task-detail');
  await detail.locator('.pill', { hasText: '15:00–16:30' }).click();
  await page.getByRole('spinbutton', { name: '这次已做（分钟）' }).fill('40');
  await page.getByRole('spinbutton', { name: '这次已做（分钟）' }).press('Enter');
  await expect(detail.locator('.pill', { hasText: '15:00–16:30' })).toContainText('已做 40 分钟');
});

test('adding can be undone from the toast', async ({ page }) => {
  await start(page);
  await add(page, '临时的事');
  await expect(row(page, '临时的事')).toBeVisible();
  await page.locator('.toast').getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('.tt', { hasText: '临时的事' })).toHaveCount(0);
});

test('tasks survive a reload', async ({ page }) => {
  await start(page);
  await add(page, '记得续签');
  await page.waitForTimeout(400); // the debounced save
  await page.reload();
  await toList(page);
  await expect(row(page, '记得续签')).toBeVisible();
});

test('a repeat in words: with a deadline a new copy each time, otherwise the task reopens', async ({ page }) => {
  await start(page);
  await toList(page);
  const box = page.getByRole('textbox', { name: '记下新任务' });
  await box.fill('每天 看邮件');
  await expect(page.locator('.capture .chips').getByRole('button', { name: /重复：每 1 天|重复：每天/ })).toBeVisible();
  await box.press('Enter');
  await box.fill('每周五交周报');
  await expect(page.locator('.capture .chips').getByRole('button', { name: /截止：周五截止/ })).toBeVisible();
  await box.press('Enter');
  const mail = await openRow(page, '看邮件');
  await expect(mail.getByRole('button', { name: /原地重开/ })).toBeVisible();
  await page.getByRole('button', { name: '收起' }).click();
  const report = await openRow(page, '交周报');
  await expect(report.getByRole('button', { name: /每周五 · 新建一份/ })).toBeVisible();
});
