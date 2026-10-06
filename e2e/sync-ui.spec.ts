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

/** A document with one task and an AI's pending proposal for it, put straight into this browser's storage. */
async function seedProposal(page: import('@playwright/test').Page) {
  const doc = {
    v: 1,
    clock: 5,
    tasks: {
      t1: {
        id: 't1',
        title: '交论文',
        due: '2026-09-28',
        created: '2026-09-27T10:00:00.000Z',
        plan: [],
        steps: [],
        rounds: [],
        fs: { title: S(1, 'a'), due: S(1, 'a') },
        s: S(1, 'a'),
      },
    },
    areas: {},
    projects: {},
    proposals: {
      p1: {
        id: 'p1',
        summary: '推迟论文，先写摘要',
        client: 'Claude Code',
        created: '2026-09-29T14:00:00.000Z',
        status: 'pending',
        changes: [
          { type: 'update', task_id: 't1', due: '2026-10-05' },
          { type: 'add_step', task_id: 't1', text: '写摘要' },
        ],
        s: S(5, 'ai'),
      },
    },
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
}

test('an AI proposal shows in the list and on its task; approving applies it, undo brings it back', async ({
  page,
}) => {
  await start(page);
  await seedProposal(page);
  await page.reload();
  await toList(page);
  const bar = page.getByRole('region', { name: 'AI 提议' });
  await expect(bar.getByRole('button', { name: /AI 提议 · 1/ })).toBeVisible();
  await expect(row(page, '交论文')).toContainText('AI 提议');
  await row(page, '交论文').locator('.title-btn').click();
  const detail = page.getByTestId('task-detail');
  const card = detail.locator('.proposal');
  await expect(card).toContainText('推迟论文，先写摘要');
  // Drawn like the task's row: the new deadline highlighted beside the old one struck through, the new step dashed.
  await expect(card.locator('.pv-task .meta .chg .was')).toBeVisible();
  await expect(card.locator('.pv-steps li.new')).toHaveText('写摘要');
  // And in words, under 明细.
  await card.getByText('明细').click();
  await expect(card).toContainText('截止：9/28（周一） → 10/5（周一）');
  await expect(card).toContainText('给 「交论文」 加步骤：写摘要');
  await card.getByRole('button', { name: '批准全部 2 条' }).click();
  await expect(page.locator('.toast')).toContainText('已批准并套用');
  await expect(detail.getByLabel('截止日期')).toHaveValue('2026-10-05');
  await expect(detail.locator('.step')).toContainText(['写摘要']);
  await expect(bar).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: '撤销' }).click();
  await expect(page.getByRole('region', { name: 'AI 提议' })).toBeVisible();
  await expect(detail.getByLabel('截止日期')).toHaveValue('2026-09-28');
});

test('an AI’s link opens the list at its proposal; rejecting changes nothing', async ({ page }) => {
  await start(page);
  await seedProposal(page);
  await page.goto('/?proposal=p1');
  const card = page.locator('.proposals .proposal.focus');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '拒绝' }).click();
  await expect(page.locator('.toast')).toContainText('已拒绝');
  await expect(page.getByRole('region', { name: 'AI 提议' })).toHaveCount(0);
  await expect(row(page, '交论文')).not.toContainText('AI 提议');
});
