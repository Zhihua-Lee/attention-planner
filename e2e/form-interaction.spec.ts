import { test, expect } from '@playwright/test';
import { capture, createTask, openApp, openTask, readTasks } from './planner-helpers';

test('IME confirmation never creates a task or a checklist row; Ctrl+S saves in place', async ({ page }) => {
    await openApp(page);
    const sheet = await capture(page, '中文输入');
    await sheet.getByLabel('What do you need to do?').dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: false, bubbles: true });
    expect(await readTasks(page)).toHaveLength(0);
    await sheet.getByRole('button', { name: 'Add to Inbox', exact: true }).click();
    const detail = await openTask(page, '中文输入');
    await detail.getByRole('button', { name: 'Add a step', exact: true }).click();
    const row = detail.getByRole('textbox', { name: 'Step', exact: true });
    await expect(row).toBeFocused();
    await row.fill('输入步骤');
    for (const isComposing of [true, false]) await row.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing, bubbles: true });
    await expect(row).toHaveCount(1);
    const note = detail.getByRole('textbox', { name: 'Note', exact: true });
    await note.fill('正文独立保存');
    await note.press('Control+s');
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
    await expect.poll(async () => (await readTasks(page))[0].description).toBe('正文独立保存');
    expect((await readTasks(page))[0].checklist).toMatchObject([{ title: '输入步骤' }]);
    await expect(detail.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
});

test('Ctrl+S in the capture sheet saves the capture instead of the browser page', async ({ page }) => {
    await openApp(page);
    const sheet = await capture(page, 'Saved with the shortcut');
    await sheet.getByLabel('What do you need to do?').press('Control+s');
    await expect(sheet).toHaveCount(0);
    await expect.poll(async () => (await readTasks(page)).map((t: { title: string }) => t.title)).toEqual(['Saved with the shortcut']);
});

test('phone editing keeps comfortable input sizes and capture actions above the software keyboard', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 }); await openApp(page); await createTask(page, 'Keyboard test');
    const detail = await openTask(page, 'Keyboard test');
    await detail.getByRole('button', { name: 'Add a step', exact: true }).click();
    const step = detail.getByRole('textbox', { name: 'Step', exact: true });
    await expect(step).toHaveCSS('font-size', '16px');
    await expect(detail.getByRole('textbox', { name: 'Task name', exact: true })).toHaveCSS('font-size', '24px');
    await detail.getByRole('textbox', { name: 'Note', exact: true }).fill('Long content\n'.repeat(30));
    await page.screenshot({ path: info.outputPath('keyboard-edit-phone.png'), fullPage: true });
    await detail.getByRole('button', { name: 'Back', exact: true }).click();
    await expect.poll(async () => (await readTasks(page))[0].description).toContain('Long content');
    // Emulate VisualViewport resize + pan, which Chrome's viewport-only mobile emulation omits.
    await page.evaluate(() => {
        const viewport = new EventTarget();
        Object.assign(viewport, { height: 410, width: 390, offsetTop: 20, offsetLeft: 0, scale: 1 });
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
        window.dispatchEvent(new Event('resize'));
    });
    const sheet = await capture(page, 'Keyboard capture');
    const add = sheet.getByRole('button', { name: 'Add to Inbox', exact: true });
    await expect.poll(async () => (await add.boundingBox())!.y + (await add.boundingBox())!.height).toBeLessThanOrEqual(430);
    expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await add.click(); await expect(sheet).toHaveCount(0);
});
