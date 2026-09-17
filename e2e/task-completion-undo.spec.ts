import {test,expect} from '@playwright/test';
import {createTask,openApp,openTask} from './planner-helpers';
test.use({locale:'en-US'});
for(const width of [1280,390])test(`completion recovery works immediately and after reload at ${width}px`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:844});await openApp(page);await createTask(page,'Recover this task');
    const detail=await openTask(page,'Recover this task');await detail.getByRole('button',{name:'Complete task',exact:true}).click();
    const undo=page.getByRole('status').getByRole('button',{name:'Undo',exact:true});await expect(undo).toBeVisible();await page.waitForTimeout(5500);await expect(undo).toBeVisible();
    await detail.getByRole('button',{name:'Back',exact:true}).click();await expect(detail).toHaveCount(0);
    const box=await undo.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({path:testInfo.outputPath('completion-undo.png'),fullPage:true});await undo.click();
    await openTask(page,'Recover this task');await expect(detail.getByRole('button',{name:'Complete task',exact:true})).toBeVisible();await detail.getByRole('button',{name:'Complete task',exact:true}).click();
    await detail.getByRole('button',{name:'Back',exact:true}).click();await page.reload();
    await page.goto('/?view=done');const row=page.locator('[data-task-id]',{hasText:'Recover this task'});await expect(row).toHaveCount(1);
    await row.getByRole('button',{name:'Reopen task',exact:true}).click();await page.locator('[data-sidebar-item][data-view="agenda"]').click();await expect(page.getByTestId('now-card')).toContainText('Recover this task');
});
