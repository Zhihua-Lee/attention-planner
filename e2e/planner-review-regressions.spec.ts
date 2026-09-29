import { expect, test } from '@playwright/test';
import { createTask, openApp, openTask, readTasks } from './planner-helpers';
test('an in-place edit is saved on leaving the field and survives reload with details open', async ({ page }) => {
    await openApp(page);
    await createTask(page, 'Keep original title');
    const detail = await openTask(page, 'Keep original title');
    const name = detail.getByRole('textbox', { name: 'Task name', exact: true });
    await name.fill('Renamed in place');
    await name.press('Escape');
    await expect(name).not.toBeFocused();
    await expect(detail).toBeVisible();
    await expect.poll(async () => (await readTasks(page))[0].title).toBe('Renamed in place');
    await page.reload();
    await expect(page.getByTestId('task-details').getByRole('textbox', { name: 'Task name', exact: true })).toHaveValue('Renamed in place');
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
