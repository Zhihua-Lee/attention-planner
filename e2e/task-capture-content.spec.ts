import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
    test(`creates title, body and steps together at ${width}px without an edit roundtrip`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(() => localStorage.setItem('mindwtr:desktop:first-run-onboarding:v1', 'dismissed'));
        await page.goto('/');
        await page.locator('[data-sidebar-item][data-view="inbox"]').click();
        const title = `Capture report ${width}`;
        await page.getByPlaceholder(/add task/i).fill(title);
        await page.getByRole('button', { name: 'Content and steps', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByPlaceholder('Add Task', { exact: true })).toHaveValue(title);
        const body = dialog.getByRole('textbox', { name: 'Content', exact: true });
        await body.fill('Background\n- First thought\n  - Nested thought');
        await body.press('End');
        await body.press('Enter');
        await body.pressSequentially('More context');
        const expectedBody = await body.inputValue();
        await expect(dialog).toBeVisible();
        await expect(page.locator('[data-task-id]', { hasText: title })).toHaveCount(0);
        await dialog.locator('summary').filter({ hasText: 'Checklist' }).click();
        await dialog.getByRole('button', { name: 'Add Item', exact: true }).click();
        await dialog.getByPlaceholder('Item name', { exact: true }).fill('Review figures');
        await expect(dialog.getByRole('button', { name: /Move step to Inbox/ })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Content and steps', exact: true }).click();
        await dialog.getByRole('button', { name: 'Content and steps', exact: true }).click();
        await expect(body).toHaveValue(expectedBody);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('capture.png'), fullPage: true });
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await page.reload();
        await page.locator('[data-sidebar-item][data-view="inbox"]').click();
        const row = page.locator('[data-task-id]', { hasText: title });
        await expect(row).toHaveCount(1);
        await expect(row).not.toContainText('Background');
        await row.locator('[data-task-view-toggle]').click();
        await expect(row).toContainText('Nested thought');
        await expect(row).toContainText('More context');
        await expect(row).toContainText('Review figures');

        // Global Add uses the same draft surface; cancel must leave no record.
        await page.getByRole('button', { name: 'Add Task (Inbox)', exact: true }).click();
        await dialog.getByPlaceholder('Add Task', { exact: true }).fill('Discarded draft');
        await dialog.getByRole('button', { name: 'Content and steps', exact: true }).click();
        await body.fill('Discard this body');
        await dialog.locator('summary').filter({ hasText: 'Checklist' }).click();
        await dialog.getByRole('button', { name: 'Add Item', exact: true }).click();
        await dialog.getByPlaceholder('Item name', { exact: true }).fill('Discard this step');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await page.reload();
        await page.locator('[data-sidebar-item][data-view="inbox"]').click();
        await expect(page.locator('[data-task-id]')).toHaveCount(1);
    });
}
