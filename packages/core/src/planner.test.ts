import { describe, it, expect } from 'vitest';
import { activeWorkBlocks, assertReservationFree, restoreCompletedWork, planDateValue, planDatePart, planTimePart, blockEnd, changeWork, closeTaskWork, commitToDay, contentDraftPatch, localPlanDate, mergeTaskPlanners, plannerContentWinner, plannerPatch, readTaskPlanner, rolloverWork, scheduleWork, skipRecurringWork, stampPlannerContent, taskPlanner, type PlannerClock, type WorkBlock } from './planner';
import { createPlanningPolicy } from './planning-policy';
import { getTaskReminderPlan, getNextScheduledAt } from './schedule-utils';
import { createNextRecurringTask } from './recurrence';
import { applyTaskUpdates, completeTaskForProjectArchive } from './store-helpers';
import { getTaskScheduledAt, isTaskReadyForNow } from './task-time-semantics';
import { mergeAppData } from './sync';
import type { AppData, Task } from './types';
const at=(h:number,m=0)=>new Date(2026,8,17,h,m,0);
const clock=(h=9,m=0,deviceId='a'):PlannerClock=>({now:at(h,m),deviceId});
const task=(patch:Partial<Task>={}):Task=>({id:'t',title:'Figure 3',status:'next',contexts:[],tags:[],createdAt:at(8).toISOString(),updatedAt:at(8).toISOString(),...patch});
const scheduled=(patch:Partial<Task>={}):Task=>{const t=task({timeEstimate:'3hr',...patch});return {...t,...scheduleWork(t,{id:'block-a',startAt:at(9).toISOString(),durationMinutes:30,timeZone:'UTC'},clock())};};
const advance=(t:Task,patch:Partial<Task>,c=clock(10)):Task=>stampPlannerContent(t,{...t,...patch,rev:(t.rev??0)+1,updatedAt:c.now.toISOString()},c);
const block=(t:Task)=>t.planner!.blocks[0];
const windows=[{days:[4],start:'09:00',end:'18:00'}];
const data=(t:Task):AppData=>({tasks:[t],projects:[],sections:[],areas:[],settings:{}});

describe('task lifecycle planner contract',()=>{
    it('separates a three-hour estimate from independent half-hour reservations',()=>{
        const a=scheduled();const b={...a,...scheduleWork(a,{id:'block-b',startAt:at(14).toISOString(),durationMinutes:30,timeZone:'UTC'},clock())};
        expect(b.timeEstimate).toBe('3hr');expect(activeWorkBlocks(b)).toHaveLength(2);expect(b.scheduledAt).toBeUndefined();
    });
    it('migrates an old exact start with a stable identity but never invents an old focus date',()=>{
        const a=task({startTime:at(9).toISOString(),isFocusedToday:true});
        expect(taskPlanner(a)).toEqual(taskPlanner(a));expect(taskPlanner(a).blocks[0].id).toBe('legacy:t');
        expect(taskPlanner(a).days).toEqual([]);expect(taskPlanner(a).legacyFocus).toBe(true);
    });
    it('allows advance planning but not premature execution',()=>{
        const t=task({availableAt:at(14).toISOString()});const planned={...t,...scheduleWork(t,{id:'b',startAt:at(15).toISOString(),durationMinutes:30,timeZone:'UTC'},clock())};
        expect(createPlanningPolicy([planned],[],at(9)).isCandidate(planned)).toBe(true);expect(isTaskReadyForNow(planned,at(9))).toBe(false);
        expect(()=>scheduleWork(t,{id:'b',startAt:at(13).toISOString(),durationMinutes:30,timeZone:'UTC'},clock())).toThrow();
    });
    it('commits to an explicit local day without assigning midnight or a deadline',()=>{
        const a=task();const p=commitToDay(a,localPlanDate(at(9)),true,clock());expect(p.planner!.days[0].selected).toBe(true);expect(p.dueDate).toBeUndefined();expect(p.planner!.blocks).toEqual([]);
    });
    it('retains a waiting task in planning and suppresses execution',()=>{
        const t=scheduled({status:'waiting'});const p=createPlanningPolicy([t],[],at(9,10));expect(p.isVisible(t)).toBe(true);expect(p.executionBlock(t)).toBe('workflow');
    });
    it('finishes a block without completing the task',()=>{
        const t=scheduled();const result={...t,...changeWork(t,'block-a','complete',clock(9,30))};expect(result.status).toBe('next');expect(block(result).state).toBe('done');expect(activeWorkBlocks(result)).toHaveLength(0);
    });
    it('does not treat elapsed time as completed work',()=>{
        const t=scheduled();const moved=rolloverWork(t,block(t),{...clock(10),windows,busy:[],calendarTrusted:true});expect(moved.completedMinutes).toBe(0);expect(moved.durationMinutes).toBe(30);
    });
    it('reschedules only the remaining 20 minutes, avoiding a fixed meeting',()=>{
        const a=scheduled({dueDate:'2026-09-18'});const t={...a,...changeWork(a,'block-a','progress',clock(9,10),10)};
        const moved=rolloverWork(t,block(t),{...clock(9,10),windows,busy:[{start:at(9,10).toISOString(),end:at(10).toISOString()}],calendarTrusted:true});
        expect(moved.durationMinutes).toBe(20);expect(moved.startAt).toBe(at(10).toISOString());expect(moved.id).toBe('block-a');expect(t.dueDate).toBe('2026-09-18');
    });
    it('is idempotent while the next allocation is in the future',()=>{
        const t=scheduled();const options={...clock(10),windows,busy:[],calendarTrusted:true};const one=rolloverWork(t,block(t),options);expect(rolloverWork(t,one,options)).toBe(one);
    });
    it.each([['calendar-unavailable',false,windows],['configure-hours',true,[]]] as const)('shows %s instead of guessing sleep hours or meeting gaps',(reason,trusted,allowed)=>{
        const t=scheduled();const b=rolloverWork(t,block(t),{...clock(10),windows:[...allowed],busy:[],calendarTrusted:trusted});expect(b.state).toBe('pending');expect(b.reason).toBe(reason);
    });
    it('keeps blocked tasks pending and can undo automatic movement without immediate repetition',()=>{
        const t=scheduled();expect(rolloverWork(t,block(t),{...clock(10),windows,busy:[],calendarTrusted:true,blocked:'project'}).reason).toBe('project');
        const moved=rolloverWork(t,block(t),{...clock(10),windows,busy:[],calendarTrusted:true});const changed={...t,...plannerPatch(t,{...t.planner!,blocks:[moved]})};
        const undone={...changed,...changeWork(changed,'block-a','undo-rollover',clock(10,1))};expect(rolloverWork(undone,block(undone),{...clock(10,2),windows,busy:[],calendarTrusted:true})).toBe(block(undone));
    });
    it('merges concurrent edits to different block identities',()=>{
        const a=scheduled();const b={...a,...scheduleWork(a,{id:'block-b',startAt:at(14).toISOString(),durationMinutes:45,timeZone:'UTC'},clock(8,30,'b'))};
        const c={...a,...changeWork(a,'block-a','cancel',clock(8,31,'a'))};
        const p=mergeTaskPlanners(b.planner,c.planner)!;expect(p.blocks).toHaveLength(2);expect(p.blocks.find(x=>x.id==='block-a')!.state).toBe('cancelled');expect(mergeTaskPlanners(c.planner,b.planner)).toEqual(p);
    });
    it('prefers a newer manual edit to a stale automatic rollover',()=>{
        const a=scheduled();const automatic=rolloverWork(a,block(a),{...clock(15,0,'a'),windows,busy:[],calendarTrusted:true});
        const manual={...a,...scheduleWork(a,{id:'block-a',startAt:at(16).toISOString(),durationMinutes:45,timeZone:'UTC'},clock(11,0,'b'))};
        const merged=mergeTaskPlanners({...a.planner!,blocks:[automatic]},manual.planner)!;expect(merged.blocks[0].startAt).toBe(at(16).toISOString());
    });
    it('does not let automatic task revisions overwrite manual title or completion facts',()=>{
        const base=advance(task(),scheduled(),clock());
        const completed=applyTaskUpdates(base,{status:'done',rev:3,revBy:'b'},at(10).toISOString()).updatedTask;
        const moved=rolloverWork(base,block(base),{...clock(11),windows,busy:[],calendarTrusted:true});
        const auto=advance(base,plannerPatch(base,{...base.planner!,blocks:[moved]}),clock(11));auto.rev=50;
        expect(plannerContentWinner(completed,auto,auto).status).toBe('done');
        const merged=mergeAppData(data(completed),data(auto));expect(merged.tasks[0].status).toBe('done');expect(activeWorkBlocks(merged.tasks[0])).toEqual([]);
    });
    it('never revives an explicitly cancelled reservation during sync',()=>{
        const t=scheduled();const cancelled={...t,...changeWork(t,'block-a','cancel',clock(11))};const p=mergeTaskPlanners(t.planner,cancelled.planner)!;expect(p.blocks[0].state).toBe('cancelled');
    });
    it('creates one reminder identity per future block',()=>{
        const a=scheduled({dueDate:at(16).toISOString()});const b={...a,...scheduleWork(a,{id:'b',startAt:at(14).toISOString(),durationMinutes:30,timeZone:'UTC'},clock())};
        const plan=getTaskReminderPlan(b,at(8));expect(plan.blocks).toHaveLength(2);expect(new Set(plan.blocks!.map(b=>b.key)).size).toBe(2);expect(plan.next?.kind).toBe('due');
        const closed={...b,status:'done' as const,planner:closeTaskWork(b,clock(9))};expect(getTaskReminderPlan(closed,at(8)).blocks).toEqual([]);
    });
    it('retires the legacy schedule fallback when cancelling migrated work',()=>{
        const old=task({startTime:at(9).toISOString()});const p=taskPlanner(old);const t={...old,...plannerPatch(old,p)};const cancelled={...t,...changeWork(t,p.blocks[0].id,'cancel',clock())};expect(getTaskScheduledAt(cancelled)).toBeUndefined();
    });
    it('keeps completed occurrence history separate from the next recurring task',()=>{
        const t=scheduled({recurrence:{rule:'weekly',strategy:'fluid'}});const next=createNextRecurringTask(t,at(10).toISOString(),'next')!;expect(next).not.toBeNull();expect(next.planner).toBeUndefined();expect(next.isFocusedToday).toBe(false);
    });
    it('skips a recurring occurrence without fabricating completion',()=>{
        const t=scheduled({recurrence:{rule:'weekly'}});const patch=skipRecurringWork(t,clock(10));const result=applyTaskUpdates(t,patch,at(10).toISOString());expect(result.updatedTask.status).toBe('archived');expect(result.updatedTask.completedAt).toBeUndefined();expect(result.nextRecurringTask).not.toBeNull();
        expect(applyTaskUpdates(result.updatedTask,patch,at(10).toISOString()).nextRecurringTask).toBeNull();
    });
    it('archives a project without marking unfinished work complete',()=>{
        const t=task();const result=completeTaskForProjectArchive(t,at(10).toISOString());expect(result.status).toBe('archived');expect(result.completedAt).toBeUndefined();
    });
    it('submits content and steps as one draft, with field-specific concurrent-edit checks',()=>{
        const t=task({description:'a',checklist:[{id:'s',title:'old',isCompleted:false}]});const draft={...t,description:'new',checklist:[{id:'s',title:'new step',isCompleted:false}]};
        expect(contentDraftPatch(t,t,t)).toEqual({});expect(Object.keys(contentDraftPatch(t,draft,{...t,scheduledAt:at(15).toISOString()}))).toEqual(['description','checklist']);
        expect(()=>contentDraftPatch(t,draft,{...t,description:'remote'})).toThrow(/changed on another device/);
    });
    it('fails closed on future or malformed planner formats',()=>{
        expect(()=>readTaskPlanner({version:999,blocks:[],days:[]})).toThrow();expect(()=>readTaskPlanner({...scheduled().planner,blocks:[{...block(scheduled()),allocatedMinutes:-1}]})).toThrow();
    });
    it('tracks elapsed instants across a DST transition rather than adding clock strings',()=>{
        const b={...block(scheduled()),startAt:'2026-11-01T06:30:00Z',durationMinutes:60} as WorkBlock;expect(new Date(blockEnd(b)).toISOString()).toBe('2026-11-01T07:30:00.000Z');
    });
});


describe('planner boundary safety', () => {
    it('rejects unknown calendars, invalid busy intervals and collisions without writing', () => {
        const input={startAt:at(10).toISOString(),durationMinutes:30};
        expect(()=>assertReservationFree(input,[],false)).toThrow('Calendar');
        expect(()=>assertReservationFree(input,[{start:'invalid',end:at(11).toISOString()}],true)).toThrow('invalid');
        expect(()=>assertReservationFree(input,[{start:at(10,15).toISOString(),end:at(11).toISOString()}],true)).toThrow('overlaps');
        expect(()=>assertReservationFree(input,[{start:at(9).toISOString(),end:at(10).toISOString()}],true)).not.toThrow();
    });
    it('preserves a local calendar day and clock across timed edits', () => {
        const value=planDateValue('2026-09-17','23:30')!;
        expect(planDatePart(value)).toBe('2026-09-17');expect(planTimePart(value)).toBe('23:30');
        expect(planDateValue('2026-09-18')).toBe('2026-09-18');
        expect(()=>planDateValue('2026-02-30')).toThrow();
        expect(()=>readTaskPlanner({...taskPlanner(scheduled()),blocks:[{...block(scheduled()),startAt:'2026-09-17T10:00:00'}]})).toThrow();
    });
    it('finds a second future reminder after the first work block has ended', () => {
        const t=scheduled();const next={...t,...scheduleWork(t,{id:'second',startAt:at(14).toISOString(),durationMinutes:30,timeZone:'UTC'},clock())};
        expect(getNextScheduledAt(next,at(11))).toEqual(at(14));
    });
    it('undoes only this completion cancellation and does not reactivate historical work', () => {
        const t=scheduled();const done={...t,status:'done' as const,planner:closeTaskWork(t,clock(10))};
        const restored=restoreCompletedWork(t,done,clock(10,1));
        expect(restored.planner!.blocks[0].state).toBe('pending');expect(restored.planner!.blocks[0].reason).toBe('manual-hold');
        const changed={...done,...scheduleWork({...done,status:'next'}, {id:'block-a',startAt:at(16).toISOString(),durationMinutes:20,timeZone:'UTC'},clock(11))};
        expect(restoreCompletedWork(t,changed,clock(12)).planner!.blocks[0].startAt).toBe(at(16).toISOString());
    });
});


describe('legacy commitment adoption', () => {
    it('does not resurrect an undated star after another device adopted a dated plan', () => {
        const old = task({ isFocusedToday: true });
        const migrated = taskPlanner(old);
        const adopted = commitToDay({ ...old, planner: migrated }, '2026-09-17', true, clock()).planner!;
        const merged = mergeTaskPlanners(migrated, adopted)!;
        expect(merged.legacyFocus).toBeUndefined();
        expect(merged.days).toEqual(adopted.days);
        expect(mergeTaskPlanners(adopted, migrated)).toEqual(merged);
        const cleared = commitToDay({ ...old, planner: adopted }, '2026-09-17', false, clock(10)).planner!;
        expect(mergeTaskPlanners(migrated, cleared)!.legacyFocus).toBeUndefined();
    });
});
