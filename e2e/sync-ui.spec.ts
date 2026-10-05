import { expect, test } from '@playwright/test';
import { row, start, toList } from './helpers';

const S = (rev: number, by: string) => ({ rev, at: `2026-09-29T1${rev}:00:00.000Z`, by });

test('a note edited on two devices at once offers both versions', async ({ page }) => {
  await start(page);
  const doc = {
    v: 1,
    clock: 5,
    tasks: {
      t1: {
        id: 't1',
        title: '写报告',
        note: 'A 的版本：先写方法',
        created: '2026-09-28T10:00:00.000Z',
        plan: [],
        steps: [],
        rounds: [],
        fs: { title: S(1, 'a'), note: S(4, 'a') },
        fb: { note: S(1, 'a') },
        conflicts: { note: { value: 'B 的版本：先写结果', s: S(3, 'b'), against: S(4, 'a') } },
        s: S(4, 'a'),
      },
    },
    areas: {},
    projects: {},
    settings: {
      workStart: '09:00',
      workEnd: '18:00',
      workDays: [1, 2, 3, 4, 5],
      chips: ['due', 'plan', 'effort', 'star'],
      theme: 'system',
      lang: 'zh',
      s: S(0, 'a'),
    },
  };
  await page.evaluate(
    (d) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('attention-planner', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => {
          const tx = req.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(d, 'doc');
          tx.oncomplete = () => resolve();
        };
      }),
    doc,
  );
  await page.reload();
  await toList(page);
  await expect(row(page, '写报告')).toContainText('有两个版本');
  await row(page, '写报告').locator('.title-btn').click();
  const notice = page.getByRole('alert');
  await expect(notice).toContainText('另一台设备同时改了正文');
  await notice.getByRole('button', { name: '对照两版' }).click();
  await expect(notice).toContainText('B 的版本：先写结果');
  await notice.getByRole('button', { name: '换成另一版' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('task-detail').locator('.note-view')).toContainText('B 的版本：先写结果');
  await page.getByRole('button', { name: '收起' }).click();
  await expect(row(page, '写报告')).not.toContainText('有两个版本');
});

test('reminder settings are in Settings and keep their times', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '设置' }).click();
  const sheet = page.getByRole('dialog', { name: '设置' });
  await expect(sheet.getByRole('heading', { name: '提醒' })).toBeVisible();
  // Whether the browser allows notifications differs between machines; one of the three states is shown.
  await expect(
    sheet
      .getByRole('button', { name: '开启提醒' })
      .or(sheet.getByText('不支持推送通知'))
      .or(sheet.getByText('通知被浏览器禁止了')),
  ).toBeVisible();
  await sheet.getByLabel('截止当天提醒时间').fill('08:30');
  await sheet.getByLabel('预留时段提前几分钟').selectOption('15');
  await sheet.getByRole('button', { name: '完成' }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('截止当天提醒时间')).toHaveValue('08:30');
  await expect(page.getByLabel('预留时段提前几分钟')).toHaveValue('15');
});

test('Settings shows the MCP address for AI clients and a link to manage connections', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  await expect(dialog.getByRole('textbox', { name: 'MCP 地址' })).toHaveValue(/\/api\/mcp$/);
  await expect(dialog.getByRole('link', { name: '管理' })).toHaveAttribute('href', '/api/ai/connections');
});
