import {test,expect} from '@playwright/test';
import {createTask,openApp,openTask,readTasks,inbox} from './planner-helpers';
test('the task page edits note and steps in place, keeps them on Back and supports explicit step promotion',async({page},testInfo)=>{
    await openApp(page);await createTask(page,'Revise Figure 3');const detail=await openTask(page,'Revise Figure 3');
    await detail.getByRole('textbox',{name:'Note',exact:true}).fill('Background for revision\n\n- Keep SI units\n\nhttps://example.com/reference');
    await detail.getByRole('button',{name:'Add a step',exact:true}).click();
    const steps=detail.getByRole('textbox',{name:'Step',exact:true});
    await steps.first().fill('Check units');await steps.first().press('Enter');
    await expect(steps).toHaveCount(2);await expect(steps.nth(1)).toBeFocused();
    await steps.nth(1).fill('Ask colleague');
    // Shift+Enter keeps a line break inside the same step.
    await steps.first().click();await steps.first().press('End');await steps.first().press('Shift+Enter');await page.keyboard.type('in SI');
    await expect(steps).toHaveCount(2);
    // Backspace on an empty new step removes it without leaving a blank row.
    await steps.nth(1).click();await steps.nth(1).press('End');await steps.nth(1).press('Enter');await expect(steps).toHaveCount(3);await steps.nth(2).press('Backspace');await expect(steps).toHaveCount(2);
    await page.setViewportSize({width:390,height:844});await detail.getByRole('button',{name:'Back',exact:true}).click();await expect(detail).toHaveCount(0);
    await expect.poll(async()=>(await readTasks(page))[0].checklist?.map((s:{title:string})=>s.title)).toEqual(['Check units\nin SI','Ask colleague']);
    expect((await readTasks(page))[0].description).toContain('Keep SI units');
    await page.reload();await openTask(page,'Revise Figure 3');await expect(detail).toContainText('Keep SI units');
    await detail.getByRole('button',{name:'Move step to Inbox: Ask colleague',exact:true}).click();await expect(detail.getByRole('button',{name:'Move step to Inbox: Ask colleague',exact:true})).toHaveCount(0);
    // Leaving with the browser Back commits an edit still being typed.
    await detail.locator('[data-description-view]').getByText('Keep SI units').click();
    await detail.getByRole('textbox',{name:'Note',exact:true}).fill('Edited, then left with Back');
    await page.goBack();await expect(detail).toHaveCount(0);
    await expect.poll(async()=>(await readTasks(page)).find((t:{title:string})=>t.title==='Revise Figure 3').description).toBe('Edited, then left with Back');
    await openTask(page,'Revise Figure 3');await expect(detail).toContainText('Edited, then left with Back');
    await page.screenshot({path:testInfo.outputPath('content-mobile.png'),fullPage:true});await detail.getByRole('button',{name:'Back',exact:true}).click();
    await inbox(page);await expect(page.locator('[data-task-id]',{hasText:'Ask colleague'})).toHaveCount(1);
});
