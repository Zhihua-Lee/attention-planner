import { expect, type Page } from '@playwright/test';

/** Tuesday 2026-09-29, 10:00 in the test time zone. */
export const T0 = new Date('2026-09-29T10:00:00-05:00');

/** Open the app at a fixed time with empty storage. */
export async function start(page: Page, time = T0) {
  await page.clock.install({ time });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'NOW' })).toBeVisible();
}

export async function toList(page: Page) {
  await page.getByRole('tab', { name: '清单' }).click();
}

export async function add(page: Page, ...lines: string[]) {
  await toList(page);
  const box = page.getByRole('textbox', { name: '记下新任务' });
  for (const line of lines) {
    await box.fill(line);
    await box.press('Enter');
    await expect(box).toHaveValue('');
  }
}

export const row = (page: Page, title: string) =>
  page.locator('.row', { has: page.locator('.tt', { hasText: title }) }).first();
export const openRow = async (page: Page, title: string) => {
  await row(page, title).locator('.title-btn').click();
  return page.getByTestId('task-detail');
};

/** Reload after the last change has been written (writes start at once but finish asynchronously). */
export async function reloadSaved(page: Page) {
  await page.waitForTimeout(300);
  await page.reload();
}
