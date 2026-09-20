import { expect, test } from '@playwright/test';
import { createTask, openApp, openTask } from './planner-helpers';
test('discarded content does not return after reload with details open', async ({ page }) => {
    await openApp(page);
    await createTask(page, 'Keep original title');
    const detail = await openTask(page, 'Keep original title');
    await detail.getByRole('button', { name: 'Edit content', exact: true }).click();
    await detail.getByLabel('Task name', { exact: true }).fill('Discard this title');
    await detail.getByRole('button', { name: 'Discard edits', exact: true }).click();
    await expect(detail.getByRole('heading', { name: 'Keep original title' })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('task-details').getByRole('heading', { name: 'Keep original title' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
});

for (const width of [1280, 390]) {
    test(`external event location and details are reachable at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        const day = new Date().toISOString().slice(0, 10);
        const stamp = day.replaceAll('-', '');
        await page.route('https://calendar.example.test/review.ics', route => route.fulfill({ contentType: 'text/calendar', body: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:review-event\r\nDTSTART:${stamp}T130000\r\nDTEND:${stamp}T140000\r\nSUMMARY:Research meeting\r\nLOCATION:Room 401 Science Building\r\nDESCRIPTION:Bring all your research notes\r\nEND:VEVENT\r\nEND:VCALENDAR` }));
        await page.addInitScript(() => localStorage.setItem('mindwtr-external-calendars', JSON.stringify([{ id: 'review', name: 'Test calendar', url: 'https://calendar.example.test/review.ics', enabled: true }])));
        await openApp(page);
        await page.getByTestId('workspace-actions').getByRole('button', { name: 'Calendar', exact: true }).click();
        await page.getByLabel('Planning date', { exact: true }).fill(day);
        const event = page.getByRole('button', { name: 'Research meeting · Room 401 Science Building', exact: true });
        await event.click();
        const dialog = page.getByRole('dialog', { name: 'Research meeting', exact: true });
        await expect(dialog.getByText('Room 401 Science Building')).toBeVisible();
        await expect(dialog.getByText('Bring all your research notes')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('event-details.png') });
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(dialog).toHaveCount(0);
    });
}
