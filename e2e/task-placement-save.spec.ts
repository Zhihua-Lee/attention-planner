import { expect, test, type Page } from '@playwright/test';
import { capture, inbox, openApp, openTask, readTasks } from './planner-helpers';

const task = (id: string, extra: Record<string, unknown> = {}) => ({
    id, title: id, status: 'inbox', tags: [], contexts: [],
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...extra,
});
const visibleOrder = (page: Page) => page.locator('[data-task-tree="inbox"] > [data-tree-task]')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tree-task')));
async function dragTo(page: Page, sourceId: string, targetId: string, position: 'before' | 'inside' | 'after') {
    const handle = page.getByRole('button', { name: `Drag or move task: ${sourceId}`, exact: true });
    const target = page.locator(`[data-task-id="${targetId}"]`);
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox(), to = await target.boundingBox();
    if (!from || !to) throw new Error('Missing drag target');
    await page.mouse.move(from.x + 20, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height * ({ before: 0.1, inside: 0.5, after: 0.9 }[position]), { steps: 15 });
    await expect(page.getByText({ before: 'Insert before', inside: 'Link to this task', after: 'Insert after' }[position], { exact: true })).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('[data-task-placement-saving]')).toHaveCount(0);
}

test('pointer edges insert before/after, centre nests, and order survives reload', async ({ page }) => {
    await openApp(page, [task('Alpha'), task('Beta'), task('Gamma', { description: 'Keep the body', dueDate: '2040-01-01' })]);
    await inbox(page);
    await dragTo(page, 'Gamma', 'Alpha', 'before');
    await expect.poll(() => visibleOrder(page)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect((await readTasks(page)).find((t: { id: string }) => t.id === 'Gamma').parentTaskId).toBeUndefined();
    await page.reload(); await inbox(page);
    await expect.poll(() => visibleOrder(page)).toEqual(['Gamma', 'Alpha', 'Beta']);
    await dragTo(page, 'Gamma', 'Beta', 'after');
    await expect.poll(() => visibleOrder(page)).toEqual(['Alpha', 'Beta', 'Gamma']);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => visibleOrder(page)).toEqual(['Gamma', 'Alpha', 'Beta']);
    await dragTo(page, 'Gamma', 'Alpha', 'inside');
    await expect(page.locator('[data-tree-task="Gamma"]')).toHaveAttribute('data-tree-depth', '1');
    await expect.poll(async () => (await readTasks(page)).find((t: { id: string }) => t.id === 'Gamma')).toMatchObject({
        parentTaskId: 'Alpha', description: 'Keep the body', dueDate: '2040-01-01', status: 'inbox',
    });
});

test('keyboard move menu reorders siblings without changing parent', async ({ page }) => {
    await openApp(page, [task('Alpha'), task('Beta')]); await inbox(page);
    await page.getByRole('button', { name: 'Drag or move task: Beta', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Move task', exact: true }).getByRole('button', { name: 'Move up', exact: true }).click();
    await expect.poll(() => visibleOrder(page)).toEqual(['Beta', 'Alpha']);
    expect((await readTasks(page)).every((t: { parentTaskId?: string }) => !t.parentTaskId)).toBe(true);
});

for (const width of [1280, 390]) {
    test(`saving blank checklist removes it, preserves the task, and stays readable at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await openApp(page, [task('Checklist task', { checklist: [{ id: 'step', title: 'Milk', isCompleted: true }] })]);
        const detail = await openTask(page, 'Checklist task');
        const input = detail.getByRole('textbox', { name: 'Step', exact: true });
        await input.fill('   ');
        await expect(input).toBeVisible(); // A step emptied while typing stays editable; it is not written.
        expect((await readTasks(page))[0].checklist).toHaveLength(1);
        await input.blur();
        await expect(detail.getByRole('textbox', { name: 'Task name', exact: true })).toHaveValue('Checklist task');
        await expect.poll(async () => (await readTasks(page))[0].checklist ?? null).toBeNull();
        expect((await readTasks(page))[0].deletedAt).toBeUndefined();
        await detail.getByRole('button', { name: 'Back', exact: true }).click();
        await page.reload(); await inbox(page);
        await expect(page.locator('[data-task-id="Checklist task"]')).toBeVisible();
        await expect(page.locator('[data-task-id="Checklist task"]')).not.toContainText('Steps');
        const sheet = await capture(page, 'Empty checklist capture');
        await sheet.getByText('Content and steps', { exact: true }).click();
        await sheet.locator('summary').filter({ hasText: 'Checklist' }).click();
        await sheet.getByRole('button', { name: 'Add Item', exact: true }).click();
        await sheet.getByPlaceholder('Item name', { exact: true }).fill(' ');
        await sheet.getByRole('button', { name: 'Add to Inbox', exact: true }).click();
        await expect(sheet).toHaveCount(0);
        await expect.poll(async () => (await readTasks(page)).find((t: { title: string }) => t.title === 'Empty checklist capture')?.checklist ?? null).toBeNull();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const font = await page.locator('html').evaluate(node => getComputedStyle(node).fontFamily);
        expect(font).toContain('Segoe UI');
        await page.screenshot({ path: info.outputPath(`planner-${width}.png`), fullPage: true });
    });
}

test.describe('touch placement', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    test('long-press at an edge reorders instead of nesting', async ({ page }) => {
        await openApp(page, [task('Alpha'), task('Beta')]); await inbox(page);
        const handle = page.getByRole('button', { name: 'Drag or move task: Beta', exact: true });
        const from = await handle.boundingBox(), to = await page.locator('[data-task-id="Alpha"]').boundingBox();
        if (!from || !to) throw new Error('Missing touch targets');
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + 20, y: from.y + 20 }] });
        await page.waitForTimeout(240);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x + to.width / 2, y: to.y + 8 }] });
        await expect(page.getByText('Insert before', { exact: true })).toBeVisible();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => visibleOrder(page)).toEqual(['Beta', 'Alpha']);
        expect((await readTasks(page)).every((t: { parentTaskId?: string }) => !t.parentTaskId)).toBe(true);
    });
});
