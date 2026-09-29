import {test,expect} from '@playwright/test';
import {openApp,createTask,openTask,readTasks,setDateProperty,showAllProperties} from './planner-helpers';
test.use({timezoneId:'America/Chicago',locale:'en-US'});
test('reserve two blocks, record partial work, resume only the remainder, and finish without changing the deadline',async({page},testInfo)=>{
    test.setTimeout(60000);await page.clock.install({time:new Date('2026-09-17T14:00:00Z')});
    await openApp(page,[],{planningWindows:[{days:[0,1,2,3,4,5,6],start:'08:00',end:'20:00'}]});await createTask(page,'Prepare paper');const detail=await openTask(page,'Prepare paper');
    await showAllProperties(detail);
    await setDateProperty(detail,'dueDate','Must finish by','2026-09-20');
    const estimate=detail.getByLabel('Total estimated minutes (not this reservation)');await estimate.fill('180');await estimate.press('Enter');
    await expect.poll(async()=>(await readTasks(page))[0].timeEstimate).toBe('custom:180');
    const reserve=async(start:string)=>{await detail.getByRole('button',{name:'Reserve a work block',exact:true}).click();await detail.getByLabel('Start time',{exact:true}).fill(start);await detail.getByLabel('Minutes for this block',{exact:true}).fill('30');await expect(page.getByText('Calendar constraints loaded',{exact:true})).toBeAttached();await detail.getByRole('button',{name:/^(Activate and reserve|Save reservation)$/}).click();await expect(detail.getByLabel('Start time',{exact:true})).toHaveCount(0);};
    await reserve('2026-09-17T10:00');await reserve('2026-09-17T11:00');await expect(detail.locator('[data-block-id]')).toHaveCount(2);
    const all=detail.locator('[data-block-id]');
    const firstId=await all.first().getAttribute('data-block-id');const block=detail.locator(`[data-block-id="${firstId}"]`);
    await block.locator('button[aria-expanded]').click();
    await block.getByLabel('Total minutes actually done in this block').fill('10');await block.getByRole('button',{name:'Pause and reschedule remainder'}).click();await expect(block).toContainText('Automatically moved');await expect(block).toContainText('20 min');
    await block.getByRole('button',{name:'Complete this block',exact:true}).click();await expect(block).toContainText('Block complete');await expect(detail.getByRole('button',{name:'Complete task',exact:true})).toBeVisible();
    await detail.getByRole('button',{name:'Back',exact:true}).click();await page.getByTestId('workspace-actions').getByRole('button',{name:'Calendar',exact:true}).click();await expect(page.locator('[data-calendar-block]')).toHaveCount(1);
    await page.screenshot({path:testInfo.outputPath('calendar.png'),fullPage:true});await page.locator('[data-calendar-block]').click();await detail.getByRole('button',{name:'Complete task',exact:true}).click();
    await expect.poll(async()=>{const task=(await readTasks(page)).find((t:any)=>t.title==='Prepare paper');return {status:task.status,due:task.dueDate,estimate:task.timeEstimate,blocks:task.planner.blocks.length};}).toEqual({status:'done',due:'2026-09-20',estimate:'custom:180',blocks:2});
    await page.reload();expect((await readTasks(page)).find((t:any)=>t.title==='Prepare paper').planner.blocks.some((b:any)=>b.state==='scheduled')).toBe(false);
});
test('a future available task can be planned today but is not recommended now',async({page})=>{
    await page.clock.install({time:new Date('2026-09-17T14:00:00Z')});await openApp(page);await createTask(page,'Future experiment');const detail=await openTask(page,'Future experiment');
    await showAllProperties(detail);await setDateProperty(detail,'availableAt','Available from','2026-09-20');
    await expect.poll(async()=>(await readTasks(page))[0].availableAt).toBe('2026-09-20');
    await detail.getByRole('button',{name:'+ Today',exact:true}).click();await expect(detail.locator('[data-property="days"]')).toContainText('Today');
    await detail.getByRole('button',{name:'Back',exact:true}).click();
    await page.locator('[data-sidebar-item][data-view="plan"]').click();await expect(page.getByTestId('planner-day')).toContainText('Future experiment');await page.locator('[data-sidebar-item][data-view="agenda"]').click();await expect(page.getByTestId('now-card')).not.toContainText('Future experiment');
});
test('repeat skip is not completion and stopping repetition keeps the current occurrence',async({page})=>{
    await openApp(page);await createTask(page,'Wash sheets');const detail=await openTask(page,'Wash sheets');
    await showAllProperties(detail);await detail.getByRole('button',{name:'Does not repeat',exact:true}).click();await detail.getByRole('combobox',{name:'Repeat',exact:true}).selectOption('weekly');
    await expect.poll(async()=>(await readTasks(page))[0].recurrence).toBeTruthy();
    await detail.getByRole('button',{name:'Skip this occurrence'}).click();
    await expect.poll(async()=>(await readTasks(page)).filter((t:any)=>t.title==='Wash sheets').length).toBe(2);const tasks=await readTasks(page);const skipped=tasks.find((t:any)=>t.planner?.skippedAt);expect(skipped.status).toBe('archived');expect(skipped.completedAt).toBeUndefined();await detail.getByRole('button',{name:'Back',exact:true}).click();
    await page.goto(`/?view=plan&task=${tasks.find((t:any)=>!t.planner?.skippedAt).id}`);await detail.getByRole('button',{name:'Stop repeating'}).click();await expect.poll(async()=>(await readTasks(page)).find((t:any)=>!t.planner?.skippedAt)?.recurrence).toBeUndefined();
});
