import { expect, test, type Locator, type Page } from '@playwright/test';
import { DATA_KEY, openApp, openTask, readTasks } from './planner-helpers';

const now = '2026-09-29T12:00:00Z';
const schedule = { id: '1560-v1', frequency: 'weekly', interval: 1, weekdays: [2, 4], startDate: '2026-09-28', time: '06:00', timeZone: 'America/Chicago' };
const defaults = { mode: 'custom', schedule, end: { mode: 'date', date: '2026-12-10' }, revision: 1, updatedAt: now, deviceId: 'test' };
const task = (id = '1560', extra: Record<string, unknown> = {}) => ({ id, title: id, status: 'inbox', tags: [], contexts: [], createdAt: now, updatedAt: now,
    checklist: [{ id: 'prepare', title: 'Prepare class', isCompleted: false }, { id: 'grade', title: 'Grade assignments', isCompleted: false }],
    planner: { version: 1, blocks: [], days: [], checklistRefresh: { version: 1, defaults, items: {}, marks: {} } }, ...extra });
async function expandSettings(detail: Locator) {
    const settings = detail.getByTestId('checklist-refresh-settings');
    if (await settings.getAttribute('open') === null) await settings.locator(':scope > summary').click();
    return settings;
}
async function start(page: Page, tasks = [task()]) {
    await page.clock.install({ time: new Date(now) }); await openApp(page, tasks);
    const detail = await openTask(page, '1560');
    return { detail, settings: await expandSettings(detail) };
}

for (const width of [1280, 390]) {
    test(`keeps separate unsaved targets across switch, detail close and reload at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const { detail, settings } = await start(page);
        await expect(settings.getByLabel('Refresh rule', { exact: true })).toHaveAccessibleName('Refresh rule');
        await expect(settings.getByLabel('Configure', { exact: true })).toHaveAccessibleName('Configure');
        await settings.getByLabel('Repeat', { exact: true }).selectOption('daily');
        await settings.getByLabel('Every (interval)', { exact: true }).fill('2');
        await settings.getByLabel('Refresh time', { exact: true }).fill('07:15');
        await settings.getByLabel('Timezone', { exact: true }).fill('America/New_York');
        await settings.getByLabel('End date', { exact: true }).fill('2026-12-17');
        await settings.getByLabel('Pause refreshing', { exact: true }).check();
        await settings.getByLabel('Configure', { exact: true }).selectOption('prepare');
        await settings.getByLabel('Refresh rule', { exact: true }).selectOption('off');
        await settings.getByLabel('End date mode', { exact: true }).selectOption('never');
        await settings.getByLabel('Configure', { exact: true }).selectOption('grade');
        await expect(settings.getByLabel('Refresh rule', { exact: true })).toHaveValue('inherit');
        const bulk = settings.getByTestId('checklist-end-bulk');
        await bulk.locator(':scope > summary').click();
        await expect(bulk.getByRole('button', { name: 'Select all', exact: true })).toBeDisabled();
        await settings.getByLabel('Configure', { exact: true }).selectOption('');
        await expect(settings.getByLabel('Repeat', { exact: true })).toHaveValue('daily');
        await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('07:15');
        expect((await readTasks(page))[0].planner.checklistRefresh.defaults).toEqual(defaults);
        await detail.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(detail).toHaveCount(0); await page.reload();
        await openTask(page, '1560'); await expandSettings(detail);
        await expect(settings.getByLabel('Every (interval)', { exact: true })).toHaveValue('2');
        await expect(settings.getByLabel('Timezone', { exact: true })).toHaveValue('America/New_York');
        await expect(settings.getByLabel('End date', { exact: true })).toHaveValue('2026-12-17');
        await expect(settings.getByLabel('Pause refreshing', { exact: true })).toBeChecked();
        await settings.getByLabel('Configure', { exact: true }).selectOption('prepare');
        await expect(settings.getByLabel('Refresh rule', { exact: true })).toHaveValue('off');
        await expect(settings.getByLabel('End date mode', { exact: true })).toHaveValue('never');
        await settings.getByRole('button', { name: 'Save refresh settings', exact: true }).click();
        await expect.poll(async () => (await readTasks(page))[0].planner.checklistRefresh.items.prepare?.mode).toBe('off');
        await settings.getByLabel('Configure', { exact: true }).selectOption('');
        await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('07:15');
        await settings.getByRole('button', { name: 'Discard rule draft', exact: true }).click();
        await expect(settings.getByLabel('Repeat', { exact: true })).toHaveValue('weekly');
        await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('06:00');
        await detail.getByRole('button', { name: 'Back', exact: true }).click(); await page.reload();
        await openTask(page, '1560'); await expandSettings(detail);
        await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('06:00');
        await expect(settings.getByRole('button', { name: 'Discard rule draft', exact: true })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

for (const leave of ['Close', 'Escape', 'browser Back', 'Edit content'] as const) {
    test(`retains a rule draft after leaving through ${leave}`, async ({ page }) => {
        const { detail, settings } = await start(page);
        await settings.getByLabel('Refresh time', { exact: true }).fill('07:25');
        if (leave === 'Close') await detail.getByRole('button', { name: 'Close', exact: true }).click();
        else if (leave === 'Escape') await page.keyboard.press('Escape');
        else if (leave === 'browser Back') await page.goBack();
        else {
            await detail.getByRole('button', { name: 'Edit content', exact: true }).click();
            await detail.getByRole('button', { name: 'Discard edits', exact: true }).click();
        }
        if (leave !== 'Edit content') { await expect(detail).toHaveCount(0); await openTask(page, '1560'); }
        await expandSettings(detail);
        await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('07:25');
        expect((await readTasks(page))[0].planner.checklistRefresh.defaults.schedule.time).toBe('06:00');
    });
}

test('failed validation keeps a draft and successful save clears only that target backup', async ({ page }) => {
    const { detail, settings } = await start(page);
    await settings.getByLabel('Timezone', { exact: true }).fill('Invalid/Zone');
    await settings.getByRole('button', { name: 'Save refresh settings', exact: true }).click();
    await expect(settings.getByRole('alert')).toBeVisible();
    expect((await readTasks(page))[0].planner.checklistRefresh.defaults).toEqual(defaults);
    await detail.getByRole('button', { name: 'Back', exact: true }).click(); await page.reload();
    await openTask(page, '1560'); await expandSettings(detail);
    await expect(settings.getByLabel('Timezone', { exact: true })).toHaveValue('Invalid/Zone');
    await settings.getByLabel('Timezone', { exact: true }).fill('America/Chicago');
    await settings.getByLabel('Refresh time', { exact: true }).fill('07:35');
    await settings.getByRole('button', { name: 'Save refresh settings', exact: true }).click();
    await expect(settings.getByRole('status')).toHaveText('Refresh settings saved.');
    await expect.poll(async () => (await readTasks(page))[0].planner.checklistRefresh.defaults.schedule.time).toBe('07:35');
    await detail.getByRole('button', { name: 'Back', exact: true }).click(); await page.reload();
    await openTask(page, '1560'); await expandSettings(detail);
    await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('07:35');
    await expect(settings.getByRole('button', { name: 'Discard rule draft', exact: true })).toHaveCount(0);
});

test('restored drafts retain the old base and refuse to overwrite a newer saved rule', async ({ page }) => {
    const { detail, settings } = await start(page);
    await settings.getByLabel('Refresh time', { exact: true }).fill('07:45');
    await detail.getByRole('button', { name: 'Back', exact: true }).click();
    await page.evaluate(key => {
        const data = JSON.parse(localStorage.getItem(key)!);
        const rule = data.tasks[0].planner.checklistRefresh.defaults;
        rule.end = { mode: 'date', date: '2026-12-24' }; rule.revision += 1;
        localStorage.setItem(key, JSON.stringify(data));
    }, DATA_KEY);
    await page.reload(); await openTask(page, '1560'); await expandSettings(detail);
    await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('07:45');
    await settings.getByRole('button', { name: 'Save refresh settings', exact: true }).click();
    await expect(settings.getByRole('alert')).toContainText('changed on another device');
    expect((await readTasks(page))[0].planner.checklistRefresh.defaults.end.date).toBe('2026-12-24');
    await settings.getByRole('button', { name: 'Discard rule draft', exact: true }).click();
    await expect(settings.getByLabel('End date', { exact: true })).toHaveValue('2026-12-24');
    await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('06:00');
});

test('storage denial retains drafts across unmounts and warns before losing the memory fallback', async ({ page }) => {
    await page.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key.startsWith('attention-planner:checklist-rule-draft:')) throw new DOMException('Quota', 'QuotaExceededError');
            original.call(this, key, value);
        };
    });
    const { detail, settings } = await start(page);
    await settings.getByLabel('Refresh time', { exact: true }).fill('07:55');
    await expect(settings.getByRole('alert')).toContainText('Browser storage is unavailable');
    await settings.getByLabel('Configure', { exact: true }).selectOption('prepare');
    await detail.getByRole('button', { name: 'Back', exact: true }).click();
    expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
    await openTask(page, '1560'); await expandSettings(detail);
    await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('07:55');
    await settings.getByRole('button', { name: 'Discard rule draft', exact: true }).click();
    expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
});

test('navigating to a linked task preserves separate drafts and saved values', async ({ page }) => {
    const { detail, settings } = await start(page, [task(), task('1560 child', { parentTaskId: '1560', planner: { version: 1, blocks: [], days: [] } })]);
    await settings.getByLabel('Refresh time', { exact: true }).fill('07:05');
    await detail.getByRole('button', { name: '1560 child', exact: true }).click();
    await expect(detail.getByRole('heading', { name: '1560 child', exact: true })).toBeVisible();
    await expandSettings(detail);
    await settings.getByLabel('Refresh rule', { exact: true }).selectOption('custom');
    await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('06:00');
    await settings.getByLabel('Refresh time', { exact: true }).fill('08:05');
    await detail.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(detail.getByRole('heading', { name: '1560', exact: true })).toBeVisible();
    await expandSettings(detail);
    await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('07:05');
    await settings.getByRole('button', { name: 'Discard rule draft', exact: true }).click();
    await detail.getByRole('button', { name: '1560 child', exact: true }).click();
    await expandSettings(detail);
    await expect(settings.getByLabel('Refresh time', { exact: true })).toHaveValue('08:05');
    expect((await readTasks(page)).find((item: { id: string }) => item.id === '1560 child').planner.checklistRefresh).toBeUndefined();
});
