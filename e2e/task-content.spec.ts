import {test,expect} from '@playwright/test';
import {createTask,openApp,openTask,readTasks,inbox} from './planner-helpers';
test('shared details keep content and checklist edits atomic, support Back and explicit step promotion',async({page},testInfo)=>{
    await openApp(page);await createTask(page,'Revise Figure 3');const detail=await openTask(page,'Revise Figure 3');
    await detail.getByRole('button',{name:'Edit content',exact:true}).click();
    const content=detail.getByRole('textbox',{name:'Content',exact:true});await content.fill('Background for revision\n\n- Keep SI units\n\nhttps://example.com/reference');
    await detail.locator('summary').filter({hasText:'Checklist'}).click();await detail.getByRole('button',{name:'Add Item',exact:true}).click();await detail.getByPlaceholder('Item name',{exact:true}).fill('Check units');
    await detail.getByRole('button',{name:'Add Item',exact:true}).click();await detail.getByPlaceholder('Item name',{exact:true}).nth(1).fill('Ask colleague');
    expect((await readTasks(page))[0].description).toBeUndefined();expect((await readTasks(page))[0].checklist??[]).toHaveLength(0);
    await page.setViewportSize({width:390,height:844});await detail.getByRole('button',{name:'Back',exact:true}).click();await expect(detail.getByRole('alertdialog')).toBeVisible();
    await detail.getByRole('button',{name:'Save and return'}).click();await expect(detail).toHaveCount(0);
    await page.reload();await openTask(page,'Revise Figure 3');await expect(detail).toContainText('Keep SI units');
    await detail.getByRole('button',{name:'Move step to Inbox: Ask colleague',exact:true}).click();await expect(detail.getByRole('button',{name:'Move step to Inbox: Ask colleague',exact:true})).toHaveCount(0);
    await detail.getByRole('button',{name:'Edit content',exact:true}).click();await detail.getByRole('textbox',{name:'Content',exact:true}).fill('Discard this edit');
    await page.goBack();await expect(detail.getByRole('alertdialog')).toBeVisible();await detail.getByRole('button',{name:'Discard and return'}).click();await expect(detail).toHaveCount(0);
    await openTask(page,'Revise Figure 3');await expect(detail).toContainText('Keep SI units');await expect(detail).not.toContainText('Discard this edit');
    await page.screenshot({path:testInfo.outputPath('content-mobile.png'),fullPage:true});await detail.getByRole('button',{name:'Back',exact:true}).click();
    await inbox(page);await expect(page.locator('[data-task-id]',{hasText:'Ask colleague'})).toHaveCount(1);
});
