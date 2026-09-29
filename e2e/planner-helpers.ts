import { expect, type Locator, type Page } from '@playwright/test';
export const DATA_KEY='attention-planner-data-v2';
export async function openApp(page: Page, tasks: unknown[] = [], gtd: Record<string,unknown> = {}) {
    await page.addInitScript(({tasks,gtd,key})=>{
        localStorage.setItem('mindwtr:desktop:first-run-onboarding:v1','dismissed');
        if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({tasks,projects:[],sections:[],areas:[],people:[],settings:{language:'en',notificationsEnabled:false,gtd}}));
    },{tasks,gtd,key:DATA_KEY});
    await page.goto('/');
}
export async function capture(page: Page, title: string) {
    await page.getByTestId('workspace-actions').getByRole('button',{name:/add task/i}).click();
    const sheet=page.getByTestId('plain-capture-sheet');
    await sheet.getByLabel('What do you need to do?').fill(title);
    return sheet;
}
export async function inbox(page:Page){await page.locator('[data-sidebar-item][data-view="inbox"]').click();}
export async function readTasks(page:Page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}').tasks??[],DATA_KEY);}
export async function openTask(page:Page,title:string){await inbox(page);await page.locator('[data-task-id]',{hasText:title}).getByRole('button',{name:title,exact:true}).click();return page.getByTestId('task-details');}
export async function createTask(page:Page,title:string){const sheet=await capture(page,title);await sheet.getByRole('button',{name:'Add to Inbox'}).click();await expect(sheet).toHaveCount(0);}
/** Task pages fold empty properties; open them so every property row can be edited. */
export async function showAllProperties(detail: Locator) {
    const more = detail.getByRole('button', { name: /^\+ \d+ more properties$/ });
    if (await more.count()) await more.click();
}
/** Set a date property that may still be folded to its "+ Set date" control. */
export async function setDateProperty(detail: Locator, property: 'dueDate' | 'availableAt', label: string, value: string) {
    const row = detail.locator(`[data-property="${property}"]`);
    const reveal = row.getByRole('button', { name: '+ Set date', exact: true });
    if (await reveal.count()) await reveal.click();
    await row.getByLabel(label, { exact: true }).fill(value);
}
