import { test, expect, type Page } from '@playwright/test';
import { inbox, openApp, openTask, readTasks } from './planner-helpers';
const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, status: 'inbox', tags: [], contexts: [], createdAt: '2026-01-01T09:00:00Z', updatedAt: '2026-01-01T09:00:00Z', ...extra });
async function linkOf(page: Page, id: string) { return (await readTasks(page)).find((item: { id: string }) => item.id === id)?.parentTaskId ?? null; }

test('dropping onto the middle links tasks, keeps content, and supports undo after reload', async ({ page }) => {
    await openApp(page, [task('Target'), task('Linked', { description: 'Independent body', dueDate: '2040-01-03', availableAt: '2040-01-01', recurrence: { rule: 'daily' }, repeatReminderMinutes: 15 })]);
    await inbox(page);
    const source = await page.getByRole('button', { name: 'Drag or move task: Linked', exact: true }).boundingBox();
    const target = await page.locator('[data-task-id="Target"]').boundingBox();
    if (!source || !target) throw new Error('Missing drag targets');
    await page.mouse.move(source.x + 20, source.y + 20); await page.mouse.down();
    await page.mouse.move(target.x + 100, target.y + target.height / 2, { steps: 15 });
    await expect(page.getByText('Link to this task', { exact: true })).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => linkOf(page, 'Linked')).toBe('Target');
    await expect(page.locator('[data-tree-task="Linked"]')).toHaveAttribute('data-tree-depth', '1');
    const linked = (await readTasks(page)).find((item: { id: string }) => item.id === 'Linked');
    expect(linked).toMatchObject({ title: 'Linked', description: 'Independent body', dueDate: '2040-01-03', availableAt: '2040-01-01', status: 'inbox', recurrence: { rule: 'daily' }, repeatReminderMinutes: 15 });
    await page.reload(); await inbox(page);
    await expect(page.locator('[data-tree-task="Linked"]')).toHaveAttribute('data-tree-depth', '1');
    await page.getByRole('button', { name: 'Drag or move task: Linked', exact: true }).click();
    await page.getByRole('dialog', { name: 'Move task', exact: true }).getByRole('button', { name: 'Remove link', exact: true }).click();
    await expect.poll(() => linkOf(page, 'Linked')).toBeNull();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => linkOf(page, 'Linked')).toBe('Target');
});

test('completing or deleting the target leaves the linked task visible and independent', async ({ page }) => {
    await openApp(page, [task('Target'), task('Linked', { parentTaskId: 'Target' })]); await inbox(page);
    await page.locator('[data-task-id="Target"]').getByRole('checkbox', { name: 'Complete task', exact: true }).click();
    await expect(page.locator('[data-task-id="Target"]')).toHaveCount(0);
    await expect(page.locator('[data-tree-task="Linked"]')).toHaveAttribute('data-tree-depth', '0');
    await expect(page.locator('[data-tree-task="Linked"]').getByRole('button', { name: 'Linked to：Target', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.locator('[data-task-id="Target"]').getByRole('button', { name: 'Delete task', exact: true }).click();
    await expect(page.locator('[data-task-id="Linked"]')).toBeVisible();
    expect((await readTasks(page)).find((item: { id: string }) => item.id === 'Linked').deletedAt).toBeUndefined();
});

test.describe('phone links', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    test('the detail panel links, lists tasks linked here, excludes loops and removes links', async ({ page }) => {
        await openApp(page, [task('Target'), task('Linked')]);
        let detail = await openTask(page, 'Linked');
        await expect(detail.getByRole('button', { name: 'Add subtask', exact: true })).toHaveCount(0);
        await detail.getByRole('button', { name: 'Link to a task…', exact: true }).tap();
        const picker = page.getByRole('dialog', { name: 'Move task', exact: true });
        await picker.getByRole('button', { name: 'Target', exact: true }).tap();
        await expect.poll(() => linkOf(page, 'Linked')).toBe('Target');
        await detail.getByRole('button', { name: 'Back', exact: true }).tap();
        detail = await openTask(page, 'Target');
        await detail.getByRole('button', { name: 'Linked', exact: true }).tap();
        await expect(detail.getByRole('heading', { name: 'Linked', exact: true })).toBeVisible();
        await detail.getByRole('button', { name: 'Back', exact: true }).tap();
        await detail.getByRole('button', { name: 'Link to a task…', exact: true }).tap();
        await expect(picker.getByRole('button', { name: 'Linked', exact: true })).toHaveCount(0); // Would form a loop.
        await picker.getByRole('button', { name: 'Cancel', exact: true }).tap();
        await detail.getByRole('button', { name: 'Linked', exact: true }).tap();
        await detail.getByRole('button', { name: 'Remove link', exact: true }).tap();
        await expect.poll(() => linkOf(page, 'Linked')).toBeNull();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    test('long-press handle links by touch without making the entire card unscrollable', async ({ page }) => {
        await openApp(page, [task('Target'), task('Linked')]); await inbox(page);
        const handle = page.getByRole('button', { name: 'Drag or move task: Linked', exact: true });
        await handle.scrollIntoViewIfNeeded();
        const from = await handle.boundingBox(), to = await page.locator('[data-task-id="Target"]').boundingBox();
        if (!from || !to) throw new Error('Missing touch targets');
        expect(await handle.evaluate(node => getComputedStyle(node).touchAction)).toBe('none');
        expect(await page.locator('[data-task-id="Linked"]').evaluate(node => getComputedStyle(node).touchAction)).not.toBe('none');
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + 20, y: from.y + 20 }] });
        await page.waitForTimeout(240); // Exercise TouchSensor's deliberate long-press threshold.
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x + 90, y: to.y + to.height / 2 }] });
        await expect(page.getByText('Link to this task', { exact: true })).toBeVisible();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => linkOf(page, 'Linked')).toBe('Target');
    });
});

test('clicking a title, note or step text edits it in place; only the checkbox completes a step', async ({ page }) => {
    await openApp(page, [task('Notes', { description: 'Read the brief', checklist: [{ id: 'draft', title: 'Write draft', isCompleted: false }] })]);
    const detail = await openTask(page, 'Notes');
    await detail.getByRole('button', { name: 'Write draft', exact: true }).click();
    await expect(detail.locator('[data-checklist-input="draft"]')).toBeFocused();
    expect((await readTasks(page))[0].checklist[0].isCompleted).toBe(false);
    await detail.locator('[data-checklist-input="draft"]').fill('Write first draft');
    await detail.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await readTasks(page))[0].checklist[0].title).toBe('Write first draft');
    await detail.getByRole('checkbox', { name: 'Write first draft', exact: true }).check();
    await expect.poll(async () => (await readTasks(page))[0].checklist[0].isCompleted).toBe(true);
    await detail.getByRole('heading', { name: 'Notes', exact: true }).click();
    await expect(detail.getByLabel('Task name', { exact: true })).toBeFocused();
    await detail.getByRole('button', { name: 'Discard edits', exact: true }).click();
    await detail.locator('[data-description-view]').getByText('Read the brief').click();
    await expect(detail.locator('form textarea')).toBeFocused();
});
