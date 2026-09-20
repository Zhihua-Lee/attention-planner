import {test,expect} from '@playwright/test';
import {capture,openApp,openTask,readTasks} from './planner-helpers';
for(const width of [1280,390]){
 test(`captures literal title, content and steps atomically at ${width}px and retains a closed draft across reload`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});await openApp(page);
    const title=`Capture report ${width}`;const sheet=await capture(page,title);
    await sheet.getByText('Content and steps',{exact:true}).click();
    const body=sheet.getByRole('textbox',{name:'Content',exact:true});
    const text='Background\n- First thought\n  - Nested thought\nMore context';await body.fill(text);
    await sheet.locator('summary').filter({hasText:'Checklist'}).click();
    await sheet.getByRole('button',{name:'Add Item',exact:true}).click();
    await sheet.getByPlaceholder('Item name',{exact:true}).fill('Review figures');
    await expect(sheet.getByRole('button',{name:/Move step to Inbox/})).toHaveCount(0);
    expect(await readTasks(page)).toHaveLength(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('capture.png'),fullPage:true});
    await sheet.getByRole('button',{name:'Add to Inbox'}).click();await expect(sheet).toHaveCount(0);
    await page.reload();const detail=await openTask(page,title);await expect(detail).toContainText('Nested thought');await expect(detail).toContainText('Review figures');
    await detail.getByRole('button',{name:'Back',exact:true}).click();await expect(detail).toHaveCount(0);
    const draft=await capture(page,'Unfinished draft');await draft.getByText('Content and steps',{exact:true}).click();await draft.getByRole('textbox',{name:'Content',exact:true}).fill('Do not lose this thought');
    await draft.getByRole('button',{name:'Close',exact:true}).click();await page.reload();
    await page.getByTestId('workspace-actions').getByRole('button',{name:/add task/i}).click();
    await expect(draft.getByLabel('What do you need to do?')).toHaveValue('Unfinished draft');
    await draft.getByText('Content and steps',{exact:true}).click();await expect(draft.getByRole('textbox',{name:'Content',exact:true})).toHaveValue('Do not lose this thought');
    expect(await readTasks(page)).toHaveLength(1);
 });
}
