import { expect, test, type Locator } from '@playwright/test';
import { capture, inbox, openApp, openTask, readTasks, showAllProperties } from './planner-helpers';

const tue = '2026-09-29T12:00:00Z', thu = '2026-10-01T12:00:00Z';
const schedule = { id: '1560-v1', frequency: 'weekly', interval: 1, weekdays: [2, 4], startDate: '2026-09-28', time: '06:00', timeZone: 'America/Chicago' };
const policy = { mode: 'custom', schedule, end: { mode: 'date', date: '2026-12-10' }, revision: 1, updatedAt: tue, deviceId: 'test' };
const task = (id = '1560', extra: Record<string, unknown> = {}) => ({ id, title: id, status: 'inbox', tags: [], contexts: [],
    createdAt: tue, updatedAt: tue, checklist: [{ id: 'prepare', title: 'Prepare class', isCompleted: false }, { id: 'grade', title: 'Grade assignments', isCompleted: false }],
    planner: { version: 1, blocks: [], days: [], checklistRefresh: { version: 1, defaults: policy, items: {}, marks: {} } }, ...extra });

const chooseWeekdays = async (menu: Locator) => { // starts on Tuesday, so Tuesday is already chosen
    await menu.getByLabel('Frequency', { exact: true }).selectOption('weekly');
    for (const day of ['Mo', 'We', 'Th', 'Fr']) await menu.getByRole('button', { name: day, exact: true }).click();
};

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
        await expect(detail.locator('[data-property="repeat"] [data-task-round]')).toHaveAttribute('data-task-round', '1560-v1/2026-10-01');
        await detail.locator('[data-task-round-history] > summary').click();
        await expect(detail.locator('[data-task-round-history]')).toContainText('2026-09-29 · Completed');
        expect((await readTasks(page))[0].status).toBe('inbox'); expect(await readTasks(page)).toHaveLength(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

test('the repeat menu sets a reopen rule for the task and its own rule for one step', async ({ page }) => {
    await page.clock.install({ time: new Date(tue) });
    await openApp(page, [task('1560', { planner: { version: 1, blocks: [], days: [] } })]); const detail = await openTask(page, '1560');
    await showAllProperties(detail);
    const row = detail.locator('[data-property="repeat"]');
    await row.getByRole('button', { name: 'None', exact: true }).click();
    const menu = detail.locator('[data-repeat-menu="task"]');
    await menu.getByRole('radio', { name: 'Reopen', exact: true }).click();
    await expect.poll(async () => (await readTasks(page))[0].planner.checklistRefresh?.defaults?.schedule?.frequency).toBe('daily');
    expect((await readTasks(page))[0].planner.checklistRefresh.defaults.schedule.time).toBe('00:00');
    await chooseWeekdays(menu);
    await expect.poll(async () => (await readTasks(page))[0].planner.checklistRefresh.defaults.schedule.weekdays).toEqual([1, 2, 3, 4, 5]);
    const version = (await readTasks(page))[0].planner.checklistRefresh.defaults.schedule.id;
    await menu.getByLabel('Stop repeating', { exact: true }).selectOption('until');
    await menu.getByLabel('End date', { exact: true }).fill('2026-12-10');
    await expect.poll(async () => (await readTasks(page))[0].planner.checklistRefresh.defaults.end.date).toBe('2026-12-10');
    expect((await readTasks(page))[0].planner.checklistRefresh.defaults.schedule.id).toBe(version); // An end date keeps the rounds.
    await detail.getByRole('button', { name: 'Repeat: Prepare class', exact: true }).click();
    const step = detail.locator('[data-repeat-menu="step"]');
    await step.getByRole('radio', { name: 'Own rule', exact: true }).click(); // a new rule repeats daily
    await expect.poll(async () => (await readTasks(page))[0].planner.checklistRefresh.items.prepare?.schedule?.frequency).toBe('daily');
    await detail.getByRole('button', { name: 'Back', exact: true }).click(); await page.reload(); await openTask(page, '1560');
    await expect(detail.locator('[data-step-repeat="prepare"]')).toHaveText(/Daily/);
    await expect(row).toContainText('Weekdays');
    await row.getByRole('button', { name: /Weekdays/ }).click();
    await menu.getByRole('radio', { name: 'New copy', exact: true }).click();
    await expect.poll(async () => (await readTasks(page))[0].recurrence?.rule).toBe('weekly');
    expect((await readTasks(page))[0].planner.checklistRefresh.defaults.mode).toBe('off');
});

test('capture saves either repeat mode', async ({ page }) => {
    await page.clock.install({ time: new Date(tue) }); await openApp(page);
    for (const [title, mode] of [['Reopens', 'Reopen'], ['Copies', 'New copy']] as const) {
        const sheet = await capture(page, title);
        await sheet.locator('summary', { hasText: 'Repeat?' }).click();
        await sheet.getByRole('radio', { name: mode, exact: true }).click();
        await chooseWeekdays(sheet);
        if (mode === 'New copy') { await sheet.getByLabel('Stop repeating', { exact: true }).selectOption('count'); await sheet.getByLabel('Total times', { exact: true }).fill('5'); }
        await sheet.getByRole('button', { name: 'Add to Inbox', exact: true }).click(); await expect(sheet).toHaveCount(0);
    }
    const rows = await readTasks(page), find = (title: string) => rows.find((row: { title: string }) => row.title === title);
    expect(find('Reopens').planner.checklistRefresh.defaults.schedule).toMatchObject({ frequency: 'weekly', weekdays: [1, 2, 3, 4, 5] });
    expect(find('Reopens').recurrence).toBeUndefined();
    expect(find('Copies').recurrence).toMatchObject({ byDay: ['MO', 'TU', 'WE', 'TH', 'FR'], count: 5 });
    expect(find('Copies').planner.checklistRefresh).toBeUndefined();
});

test('an edit in progress across a refresh boundary does not check a new period', async ({ page }) => {
    await page.clock.install({ time: new Date(tue) }); await openApp(page, [task()]); const detail = await openTask(page, '1560');
    await detail.getByRole('checkbox', { name: 'Prepare class', exact: true }).check();
    const name = detail.getByRole('textbox', { name: 'Task name', exact: true });
    await name.fill('1560 updated');
    await page.clock.setSystemTime(new Date(thu));
    await name.press('Control+s');
    await expect.poll(async () => (await readTasks(page))[0].title).toBe('1560 updated');
    await detail.getByRole('button', { name: 'Back', exact: true }).click(); await page.reload(); await inbox(page); await openTask(page, '1560 updated');
    await expect(detail.getByRole('checkbox', { name: 'Prepare class', exact: true })).not.toBeChecked();
    const row = (await readTasks(page))[0]; expect(row.planner.checklistRefresh.marks.prepare['1560-v1/2026-10-01']).toBeUndefined();
});
