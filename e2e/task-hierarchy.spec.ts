import { test, expect, type Page } from '@playwright/test';
import { inbox, openApp, openTask, readTasks } from './planner-helpers';
const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, status: 'inbox', tags: [], contexts: [], createdAt: '2026-01-01T09:00:00Z', updatedAt: '2026-01-01T09:00:00Z', ...extra });
async function parentOf(page: Page, id: string) { return (await readTasks(page)).find((item: { id: string }) => item.id === id)?.parentTaskId ?? null; }

test('drag nests an independent task, preserves content and timing, and supports undo after reload', async ({ page }, info) => {
    await openApp(page, [task('Parent'), task('Child', { description: 'Independent body', dueDate: '2040-01-03', availableAt: '2040-01-01', recurrence: { rule: 'daily' }, repeatReminderMinutes: 15 })]);
    await inbox(page);
    const source = await page.getByRole('button', { name: 'Drag or move task: Child', exact: true }).boundingBox();
    const target = await page.locator('[data-task-id="Parent"]').boundingBox();
    if (!source || !target) throw new Error('Missing drag targets');
    await page.mouse.move(source.x + 20, source.y + 20); await page.mouse.down();
    await page.mouse.move(target.x + 100, target.y + 35, { steps: 15 });
    await expect(page.getByText('Release to make an independent subtask here')).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => parentOf(page, 'Child')).toBe('Parent');
    await expect(page.locator('[data-tree-task="Child"]')).toHaveAttribute('data-tree-depth', '1');
    const child = (await readTasks(page)).find((item: { id: string }) => item.id === 'Child');
    expect(child).toMatchObject({ title: 'Child', description: 'Independent body', dueDate: '2040-01-03', availableAt: '2040-01-01', status: 'inbox', recurrence: { rule: 'daily' }, repeatReminderMinutes: 15 });
    await page.reload(); await inbox(page);
    await expect(page.locator('[data-tree-task="Child"]')).toHaveAttribute('data-tree-depth', '1');
    await page.getByRole('button', { name: 'Drag or move task: Child', exact: true }).click();
    await page.getByRole('dialog', { name: 'Move task', exact: true }).getByRole('button', { name: 'Move out · top-level task', exact: true }).click();
    await expect.poll(() => parentOf(page, 'Child')).toBeNull();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => parentOf(page, 'Child')).toBe('Parent');
    await page.screenshot({ path: info.outputPath('hierarchy-desktop.png'), fullPage: true });
});

test('parent completion and deletion leave the child visible and independently editable', async ({ page }) => {
    await openApp(page, [task('Parent'), task('Child', { parentTaskId: 'Parent' })]); await inbox(page);
    await page.locator('[data-task-id="Parent"]').getByRole('checkbox', { name: 'Complete task', exact: true }).click();
    await expect(page.locator('[data-task-id="Parent"]')).toHaveCount(0);
    await expect(page.locator('[data-task-id="Child"]')).toBeVisible();
    await expect(page.locator('[data-tree-task="Child"]')).toHaveAttribute('data-tree-depth', '0');
    const detail = await openTask(page, 'Child');
    await detail.getByRole('button', { name: 'Move task…', exact: true }).click();
    await page.getByRole('dialog', { name: 'Move task', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(detail.getByRole('heading', { name: 'Child', exact: true })).toBeVisible();
    await detail.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    const row = page.locator('[data-task-id="Parent"]');
    await row.getByRole('button', { name: 'Delete task', exact: true }).click();
    await expect(page.locator('[data-task-id="Child"]')).toBeVisible();
    expect((await readTasks(page)).find((item: { id: string }) => item.id === 'Child').deletedAt).toBeUndefined();
});

test.describe('phone hierarchy', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    test('tap alternative supports recursive children, cycle exclusion, and returning from child detail', async ({ page }, info) => {
        await openApp(page, [task('Parent'), task('Child')]); await inbox(page);
        await page.getByRole('button', { name: 'Drag or move task: Child', exact: true }).tap();
        const picker = page.getByRole('dialog', { name: 'Move task', exact: true });
        await picker.getByRole('button', { name: 'Parent', exact: true }).tap();
        await expect.poll(() => parentOf(page, 'Child')).toBe('Parent');
        const detail = await openTask(page, 'Child');
        await detail.getByRole('button', { name: 'Add subtask', exact: true }).tap();
        await detail.getByLabel('Subtask name', { exact: true }).fill('Grandchild');
        await detail.getByRole('button', { name: 'Add and open', exact: true }).tap();
        await expect(detail.getByRole('heading', { name: 'Grandchild', exact: true })).toBeVisible();
        const grandchild = (await readTasks(page)).find((item: { title: string }) => item.title === 'Grandchild');
        expect(grandchild.parentTaskId).toBe('Child');
        await detail.getByRole('button', { name: 'Back', exact: true }).tap();
        await expect(detail.getByRole('heading', { name: 'Child', exact: true })).toBeVisible();
        await detail.getByRole('button', { name: 'Move task…', exact: true }).tap();
        await expect(picker.getByRole('button', { name: 'Grandchild', exact: true })).toHaveCount(0);
        await expect(picker.getByRole('button', { name: 'Child', exact: true })).toHaveCount(0);
        await picker.getByRole('button', { name: 'Move out · top-level task', exact: true }).tap();
        await expect.poll(() => parentOf(page, 'Child')).toBeNull();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath('hierarchy-phone.png'), fullPage: true });
    });
    test('long-press handle supports touch nesting without making the entire card unscrollable', async ({ page }) => {
        await openApp(page, [task('Parent'), task('Child')]); await inbox(page);
        const handle = page.getByRole('button', { name: 'Drag or move task: Child', exact: true });
        await handle.scrollIntoViewIfNeeded();
        const from = await handle.boundingBox(), to = await page.locator('[data-task-id="Parent"]').boundingBox();
        if (!from || !to) throw new Error('Missing touch targets');
        expect(await handle.evaluate(node => getComputedStyle(node).touchAction)).toBe('none');
        expect(await page.locator('[data-task-id="Child"]').evaluate(node => getComputedStyle(node).touchAction)).not.toBe('none');
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + 20, y: from.y + 20 }] });
        await page.waitForTimeout(240); // Exercise TouchSensor's deliberate long-press threshold.
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x + 90, y: to.y + 35 }] });
        await expect(page.getByText('Release to make an independent subtask here')).toBeVisible();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => parentOf(page, 'Child')).toBe('Parent');
        await expect(page.getByRole('dialog', { name: 'Move task', exact: true })).toHaveCount(0);
    });
    test('unfinished child title survives close and reload; its own reservation appears in Calendar', async ({ page }) => {
        await page.clock.install({ time: new Date('2026-09-22T14:00:00Z') });
        await openApp(page, [task('Parent')]);
        const detail = await openTask(page, 'Parent');
        await detail.getByRole('button', { name: 'Add subtask', exact: true }).tap();
        await detail.getByLabel('Subtask name', { exact: true }).fill('Independently scheduled child');
        await detail.getByRole('button', { name: 'Back', exact: true }).tap();
        await page.reload(); await openTask(page, 'Parent');
        await expect(detail.getByLabel('Subtask name', { exact: true })).toHaveValue('Independently scheduled child');
        await detail.getByRole('button', { name: 'Add and open', exact: true }).tap();
        await expect(detail.getByRole('heading', { name: 'Independently scheduled child', exact: true })).toBeVisible();
        await detail.getByRole('button', { name: 'Reserve a work block', exact: true }).tap();
        await detail.getByLabel('Start time', { exact: true }).fill('2026-09-22T16:00');
        await detail.getByLabel('Minutes for this block', { exact: true }).fill('45');
        await detail.getByRole('button', { name: 'Activate and reserve', exact: true }).tap();
        await expect(detail.locator('[data-block-id]')).toHaveCount(1);
        await detail.getByRole('button', { name: 'Back', exact: true }).tap();
        await expect(detail.getByRole('heading', { name: 'Parent', exact: true })).toBeVisible();
        await detail.getByRole('button', { name: 'Back', exact: true }).tap();
        await page.getByTestId('workspace-actions').getByRole('button', { name: 'Calendar', exact: true }).tap();
        await expect(page.locator('[data-calendar-block]')).toHaveCount(1);
        await expect(page.locator('[data-calendar-block]')).toContainText('Independently scheduled child');
        const tasks = await readTasks(page);
        expect(tasks.find((item: { id: string }) => item.id === 'Parent').planner?.blocks ?? []).toHaveLength(0);
        expect(tasks.find((item: { title: string }) => item.title === 'Independently scheduled child').parentTaskId).toBe('Parent');
    });
});
