import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('mindwtr:desktop:first-run-onboarding:v1', 'dismissed');
    });
});

test('captures ordinary text, preserves a closed draft, and reveals its destination', async ({ page }) => {
    await page.goto('/');
    const actions = page.getByTestId('workspace-actions');
    await actions.getByRole('button', { name: /add task/i }).click();
    const sheet = page.getByTestId('plain-capture-sheet');
    const title = 'Read C++ @home #1 /done';
    await sheet.getByLabel('What do you need to do?').fill(title);
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await actions.getByRole('button', { name: /add task/i }).click();
    await expect(sheet.getByLabel('What do you need to do?')).toHaveValue(title);
    await sheet.getByRole('button', { name: 'Add to Inbox' }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('status').filter({ hasText: 'Task added.' }).getByRole('button', { name: 'View', exact: true }).click();
    await expect(page.locator('[data-task-id]', { hasText: title })).toBeVisible();
});

test('phone-sized viewport has one-step calendar access and a reachable capture close', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const actions = page.getByTestId('workspace-actions');
    await actions.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(actions.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-current', 'page');
    await actions.getByRole('button', { name: /add task/i }).click();
    const sheet = page.getByTestId('plain-capture-sheet');
    await expect(sheet).toBeVisible();
    const close = sheet.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeInViewport();
    await close.click();
    await expect(sheet).toHaveCount(0);
    await expect(actions.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-current', 'page');
});
