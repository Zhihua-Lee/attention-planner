import { test, expect } from '@playwright/test';

test.use({ locale: 'en-US' });

for (const width of [1280, 390]) {
    test(`recovers an accidental completion immediately and after reload at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        await page.addInitScript(() => localStorage.setItem('mindwtr:desktop:first-run-onboarding:v1', 'dismissed'));
        await page.goto('/');
        const now = page.getByTestId('now-card');
        await expect(now).toContainText('Nothing is demanding your attention right now');
        // Open the normal creation dialog in a fresh, unsynced browser context.
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('mindwtr:quick-add', {
            detail: { initialValue: 'Recover this task', initialProps: { status: 'next', isFocusedToday: true, description: 'Keep my notes' } },
        })));
        await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
        await expect(now).toContainText('Recover this task');
        await now.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(now).not.toContainText('Recover this task');
        const undo = page.getByRole('status').getByRole('button', { name: 'Undo', exact: true });
        await expect(undo).toBeVisible();
        await page.waitForTimeout(5500); // Old five-second toasts disappeared too soon.
        await expect(undo).toBeVisible();
        const undoBox = await undo.boundingBox();
        expect(undoBox!.width).toBeGreaterThanOrEqual(44);
        expect(undoBox!.height).toBeGreaterThanOrEqual(44);
        expect(undoBox!.x + undoBox!.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: testInfo.outputPath('completion-undo.png'), fullPage: true });
        await undo.click();
        await expect(now).toContainText('Recover this task');

        await now.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(undo).toBeVisible();
        await page.getByRole('status').getByRole('button', { name: 'Dismiss', exact: true }).click();
        await page.reload();
        await expect(now).toContainText('Nothing is demanding your attention right now');
        const doneNav = page.locator('[data-sidebar-item][data-view="done"]');
        if (!await doneNav.isVisible()) {
            if (width < 600) await page.getByRole('button', { name: 'More', exact: true }).click();
            else await page.getByRole('button', { name: 'Archive', exact: true }).click();
        }
        await doneNav.click();
        const row = page.locator('[data-task-id]', { hasText: 'Recover this task' });
        const reopen = row.getByRole('button', { name: 'Reopen task', exact: true });
        await expect(reopen).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('completed-recovery.png'), fullPage: true });
        await reopen.click();
        await expect(row).toHaveCount(0);
        await page.locator('[data-sidebar-item][data-view="agenda"]').click();
        await expect(now).toContainText('Recover this task');
        await page.reload();
        await expect(now).toContainText('Recover this task');
    });
}
