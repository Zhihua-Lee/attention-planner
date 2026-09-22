import { test, expect } from '@playwright/test';
import { capture, createTask, openApp, openTask, readTasks } from './planner-helpers';

test('IME confirmation never creates a task or a checklist row; Ctrl+Enter saves the whole edit', async ({ page }) => {
    await openApp(page);
    const sheet = await capture(page, '中文输入');
    await sheet.getByLabel('What do you need to do?').dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: false, bubbles: true });
    expect(await readTasks(page)).toHaveLength(0);
    await sheet.getByRole('button', { name: 'Add to Inbox', exact: true }).click();
    const detail = await openTask(page, '中文输入');
    await detail.getByRole('button', { name: 'Edit content', exact: true }).click();
    await expect(detail.getByLabel('Task name', { exact: true })).toBeFocused();
    await detail.locator('summary').filter({ hasText: 'Checklist' }).click();
    await detail.getByRole('button', { name: 'Add Item', exact: true }).click();
    const row = detail.getByPlaceholder('Item name', { exact: true }); await row.fill('输入步骤');
    for (const isComposing of [true, false]) await row.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing, bubbles: true });
    await expect(row).toHaveCount(1);
    await detail.getByRole('textbox', { name: 'Content', exact: true }).fill('正文独立保存');
    await detail.getByRole('textbox', { name: 'Content', exact: true }).press('Control+Enter');
    await expect(detail.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Edit content', exact: true })).toBeFocused();
    await expect.poll(async () => (await readTasks(page))[0].description).toBe('正文独立保存');
    expect((await readTasks(page))[0].checklist).toHaveLength(1);
});

test('phone edit and capture actions stay above the software keyboard viewport, with comfortable input sizes', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 }); await openApp(page); await createTask(page, 'Keyboard test');
    const detail = await openTask(page, 'Keyboard test'); await detail.getByRole('button', { name: 'Edit content', exact: true }).click();
    await detail.getByRole('textbox', { name: 'Content', exact: true }).fill('Long content\n'.repeat(30));
    // Emulate VisualViewport resize + pan, which Chrome's viewport-only mobile emulation omits.
    await page.evaluate(() => {
        const viewport = new EventTarget();
        Object.assign(viewport, { height: 410, width: 390, offsetTop: 20, offsetLeft: 0, scale: 1 });
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
        window.dispatchEvent(new Event('resize'));
    });
    const save = detail.getByRole('button', { name: 'Save changes', exact: true });
    await expect.poll(async () => (await save.boundingBox())!.y + (await save.boundingBox())!.height).toBeLessThanOrEqual(430);
    await expect(detail.getByLabel('Task name', { exact: true })).toHaveCSS('font-size', '16px');
    expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath('keyboard-edit-phone.png'), fullPage: true });
    await save.click(); await detail.getByRole('button', { name: 'Back', exact: true }).click();
    const sheet = await capture(page, 'Keyboard capture');
    const add = sheet.getByRole('button', { name: 'Add to Inbox', exact: true });
    await expect.poll(async () => (await add.boundingBox())!.y + (await add.boundingBox())!.height).toBeLessThanOrEqual(430);
    await add.click(); await expect(sheet).toHaveCount(0);
});
