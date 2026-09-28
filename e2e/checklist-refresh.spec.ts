import { expect, test } from '@playwright/test';
import { inbox, openApp, openTask, readTasks } from './planner-helpers';

const tue = '2026-09-29T12:00:00Z', thu = '2026-10-01T12:00:00Z';
const schedule = { id: '1560-v1', frequency: 'weekly', interval: 1, weekdays: [2, 4], startDate: '2026-09-28', time: '06:00', timeZone: 'America/Chicago' };
const policy = { mode: 'custom', schedule, end: { mode: 'date', date: '2026-12-10' }, revision: 1, updatedAt: tue, deviceId: 'test' };
const task = (id = '1560', extra: Record<string, unknown> = {}) => ({ id, title: id, status: 'inbox', tags: [], contexts: [],
    createdAt: tue, updatedAt: tue, checklist: [{ id: 'prepare', title: 'Prepare class', isCompleted: false }, { id: 'grade', title: 'Grade assignments', isCompleted: false }],
    planner: { version: 1, blocks: [], days: [], checklistRefresh: { version: 1, defaults: policy, items: {}, marks: {} } }, ...extra });

for (const width of [1280, 390]) {
    test(`period completion stays independent and refreshes after reopening at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 }); await page.clock.install({ time: new Date(tue) });
        await openApp(page, [task()]); const detail = await openTask(page, '1560');
        await detail.getByRole('checkbox', { name: 'Prepare class', exact: true }).check();
        await expect(detail.getByRole('checkbox', { name: 'Prepare class', exact: true })).toBeChecked();
        await expect.poll(async () => (await readTasks(page))[0].planner.checklistRefresh.marks.prepare['1560-v1/2026-09-29'].completed).toBe(true);
        await detail.getByRole('button', { name: 'Complete current round', exact: true }).click();
        await expect(detail.getByRole('checkbox', { name: 'Grade assignments', exact: true })).toBeChecked();
        expect((await readTasks(page))[0].status).toBe('inbox'); expect(await readTasks(page)).toHaveLength(1);
        await detail.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(page.locator('[data-task-id="1560"]').getByRole('checkbox', { name: 'Reopen current round', exact: true })).toBeChecked();
        await page.clock.setSystemTime(new Date(thu)); await page.reload(); await openTask(page, '1560');
        await expect(detail.getByRole('checkbox', { name: 'Prepare class', exact: true })).not.toBeChecked();
        const item = detail.locator('[data-checklist-item="prepare"]');
        await expect(item.locator('[data-checklist-cycle]')).toHaveAttribute('data-checklist-cycle', '1560-v1/2026-10-01');
        await item.getByText('Completion history', { exact: true }).click();
        await expect(item).toContainText('2026-09-29 · Completed');
        expect((await readTasks(page))[0].status).toBe('inbox'); expect(await readTasks(page)).toHaveLength(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

test('configures weekdays and independent list/item end dates in the existing detail surface', async ({ page }) => {
    await page.clock.install({ time: new Date(tue) });
    await openApp(page, [task('1560', { planner: { version: 1, blocks: [], days: [] } })]); const detail = await openTask(page, '1560');
    const settings = detail.getByTestId('checklist-refresh-settings'); await settings.locator(':scope > summary').click();
    await settings.getByLabel('Refresh rule', { exact: true }).selectOption('custom');
    await settings.getByLabel('Start date', { exact: true }).fill('2026-09-28');
    await settings.getByLabel('Refresh time', { exact: true }).fill('06:00');
    await settings.getByLabel('Timezone', { exact: true }).fill('America/Chicago');
    await expect(settings.getByRole('button', { name: 'Tu', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(settings.getByRole('button', { name: 'Th', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await settings.getByLabel('End date mode', { exact: true }).selectOption('date');
    await settings.getByLabel('End date', { exact: true }).fill('2026-12-10');
    await settings.getByRole('button', { name: 'Save refresh settings', exact: true }).click();
    await expect(settings.getByRole('status')).toHaveText('Refresh settings saved.');
    await settings.getByLabel('Configure', { exact: true }).selectOption('prepare');
    await settings.getByLabel('End date mode', { exact: true }).selectOption('never');
    await settings.getByRole('button', { name: 'Save refresh settings', exact: true }).click();
    await expect.poll(async () => (await readTasks(page))[0].planner.checklistRefresh.items.prepare.end.mode).toBe('never');
    const data = (await readTasks(page))[0].planner.checklistRefresh;
    expect(data.defaults.end.date).toBe('2026-12-10'); expect(data.items.prepare.mode).toBe('inherit');
    await detail.getByRole('button', { name: 'Back', exact: true }).click(); await page.reload(); await openTask(page, '1560');
    await settings.locator(':scope > summary').click(); await settings.getByLabel('Configure', { exact: true }).selectOption('prepare');
    await expect(settings.getByLabel('End date mode', { exact: true })).toHaveValue('never');
});

test('bulk end sync previews items following the default, cancels without changes and replaces selected ends only', async ({ page }) => {
    await page.clock.install({ time: new Date(tue) });
    await openApp(page, [task()]); const detail = await openTask(page, '1560');
    const settings = detail.getByTestId('checklist-refresh-settings'); await settings.locator(':scope > summary').click();
    const bulk = settings.getByTestId('checklist-end-bulk'); await bulk.locator(':scope > summary').click();
    await bulk.getByLabel('Batch End date', { exact: true }).fill('2026-12-17');
    await bulk.getByRole('checkbox', { name: '1560 · list default', exact: true }).check();
    await bulk.getByRole('button', { name: 'Preview sync', exact: true }).click();
    const preview = bulk.getByRole('alertdialog', { name: 'Confirm end date sync' });
    await expect(preview).toContainText('1560 / Prepare class');
    await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await readTasks(page))[0].planner.checklistRefresh.defaults.end.date).toBe('2026-12-10');
    await bulk.getByRole('button', { name: 'Preview sync', exact: true }).click();
    await preview.getByRole('button', { name: 'Confirm sync', exact: true }).click();
    await expect(preview).toHaveCount(0);
    const rows = await readTasks(page), data = rows.find((t: { id: string }) => t.id === '1560').planner.checklistRefresh;
    expect(data.defaults.end.date).toBe('2026-12-17'); expect(data.defaults.schedule).toEqual(schedule);
    expect(rows).toHaveLength(1);
});

test('a content draft crossing a refresh boundary does not check a new period', async ({ page }) => {
    await page.clock.install({ time: new Date(tue) }); await openApp(page, [task()]); const detail = await openTask(page, '1560');
    await detail.getByRole('checkbox', { name: 'Prepare class', exact: true }).check();
    await detail.getByRole('button', { name: 'Edit content', exact: true }).click();
    await detail.getByLabel('Task name', { exact: true }).fill('1560 updated');
    await page.clock.setSystemTime(new Date(thu));
    await detail.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(detail.getByRole('heading', { name: '1560 updated', exact: true })).toBeVisible();
    await detail.getByRole('button', { name: 'Back', exact: true }).click(); await page.reload(); await inbox(page); await openTask(page, '1560 updated');
    await expect(detail.getByRole('checkbox', { name: 'Prepare class', exact: true })).not.toBeChecked();
    const row = (await readTasks(page))[0]; expect(row.planner.checklistRefresh.marks.prepare['1560-v1/2026-10-01']).toBeUndefined();
});
