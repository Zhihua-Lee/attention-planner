import { checkReservation, ensurePlannerBackup, plannerClock } from '../../lib/lifecycle-actions';
import { useDialogHistory } from '../planner/useDialogHistory';
import { CaptureContentFields } from '../Task/CaptureContentFields';
import { usePlannerEnvironment } from '../planner/usePlannerEnvironment';
import { RepeatPicker } from '../planner/RepeatPicker';
import type { CaptureRequest } from './PwaCaptureHost';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronDown, Repeat2, X } from 'lucide-react';
import { commitToDay, flushPendingSave, generateUUID, localPlanDate, localPlanInput, plannerTimeZone, scheduleWork, shallow, useTaskStore, type Task } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { emptyPlainCapture, preparePlainCapture, type PlainCaptureDraft, type PlainCaptureError } from '../../lib/plain-capture';
import { dispatchNavigateEvent } from '../../lib/navigation-events';
import { useUiStore } from '../../store/ui-store';
import { ModalPortal } from '../ModalPortal';
import { useVisibleViewport } from '../../hooks/use-visible-viewport';
import { isInputComposition } from '../../lib/input-method';

export type PlainCaptureSheetProps = {
    isOpen: boolean;
    onClose: () => void;
    onAdvanced?: () => void;
    initialRequest?: CaptureRequest;
};

export function PlainCaptureSheet({ isOpen, onClose, onAdvanced, initialRequest }: PlainCaptureSheetProps) {
    const viewport = useVisibleViewport(isOpen);
    const { language, t } = useLanguage();
    const {events,loaded,calendarError,showDate} = usePlannerEnvironment();
    useEffect(()=>{if(isOpen&&draftDate.current)showDate(draftDate.current);},[isOpen,showDate]);
    const draftDate=useRef<string>('');
    const zh = language.startsWith('zh');
    const text = (en: string, cn: string) => zh ? cn : en;
    const id = useId();
    const titleRef = useRef<HTMLTextAreaElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const savingRef = useRef(false);
    const [saving, setSaving] = useState(false);
    const [contentExpanded, setContentExpanded] = useState<boolean | undefined>();
    useEffect(() => { if (!isOpen) setContentExpanded(undefined); }, [isOpen]);
    // The host stays mounted while closed, so closing never discards a draft or
    // creates a half-filled task. Only a successful capture resets this state.
    const draftKey = 'attention-planner:capture-draft:v2';
    const [draft, setDraft] = useState<PlainCaptureDraft>(()=>{
        try { const stored=JSON.parse(localStorage.getItem(draftKey)||'null'); return stored?.draft?.title!==undefined?{...emptyPlainCapture(),...stored.draft}:emptyPlainCapture(); }
        catch { return emptyPlainCapture(); }
    });
    const pendingId=useRef<string|null>((()=>{try{return JSON.parse(localStorage.getItem(draftKey)||'null')?.pendingId??null;}catch{return null;}})());
    const blockId=useRef(generateUUID());
    const [draftChoice,setDraftChoice]=useState<CaptureRequest|null>(null);
    useEffect(()=>{try{localStorage.setItem(draftKey,JSON.stringify({draft,pendingId:pendingId.current}));}catch{setError(text('Draft could not be backed up in this browser. Keep this window open.','浏览器无法备份草稿，请不要关闭页面。'));}},[draft]);
    const applyRequest=(request:CaptureRequest)=>{
        const props = request.initialProps;
        setDraft(current => ({ ...current,
            ...(request.initialValue ? {title:request.initialValue} : {}),
            ...(props?.status === 'next' ? {destination:'next' as const} : {}),
            ...(props?.description !== undefined ? {description:props.description} : {}),
            ...(props?.checklist ? {checklist:props.checklist} : {}),
            ...(props?.recurrence ? {recurrence:props.recurrence} : {}),
            ...(props?.availableAt ? {availableAt:props.availableAt.slice(0,10)} : {}),
            ...(props?.dueDate ? {dueDate:props.dueDate.slice(0,10)} : {}),
            ...(props?.isFocusedToday ? {plannedDay:localPlanDate(new Date())} : {}),
            ...(props?.scheduledAt || props?.startTime?.includes('T') ? {scheduledAt:localPlanInput(new Date(props.scheduledAt || props.startTime!)),destination:'next' as const} : {}),
            ...(props?.projectId ? {container:`project:${props.projectId}`} : props?.areaId ? {container:`area:${props.areaId}`} : {}),
        }));
    };
    useEffect(()=>{
        if (!isOpen || !initialRequest) return;
        const meaningful = initialRequest.initialValue || initialRequest.initialProps && Object.keys(initialRequest.initialProps).length;
        if (meaningful && (draft.title.trim() || pendingId.current)) { setDraftChoice(initialRequest); return; }
        applyRequest(initialRequest);
    },[isOpen,initialRequest]);

    const [error, setError] = useState<string | null>(null);
    draftDate.current=draft.scheduledAt.slice(0,10);
    useEffect(()=>{if(isOpen&&draft.scheduledAt)showDate(draft.scheduledAt.slice(0,10));},[draft.scheduledAt,isOpen,showDate]);
    const { addTask, projects, areas } = useTaskStore((state) => ({
        addTask: state.addTask, projects: state.projects, areas: state.areas,
    }), shallow);
    const showToast = useUiStore((state) => state.showToast);
    const hasDraft = JSON.stringify(draft) !== JSON.stringify(emptyPlainCapture());
    const set = <K extends keyof PlainCaptureDraft>(key: K, value: PlainCaptureDraft[K]) => {
        // Once created, this sheet only retries persistence. Edit the task after
        // that succeeds; never accept changes which the retry would not save.
        if (pendingId.current || savingRef.current) return;
        setDraft(current => ({ ...current, [key]: value }));
        setError(null);
    };
    useEffect(() => {
        if (!isOpen) return;
        const previous = document.activeElement as HTMLElement | null;
        titleRef.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, [isOpen]);

    const close = useDialogHistory(isOpen, () => { if (savingRef.current) return false; onClose(); return true; });
    const errorText = (code: PlainCaptureError) => ({
        title: text('Write a task name first.', '先写下要做的事情。'),
        schedule: text('Choose a valid date and time.', '请选择有效的日期和时间。'),
        due: text('Choose a valid deadline date.', '请选择有效的截止日期。'),
        availability: text('This time is before the task becomes available.', '安排时间早于任务最早可执行时间。'),
        duration: text('Use a duration from 1 to 1440 minutes.','时长需为1至1440分钟。'),
        interval: text('Use a whole number from 1 to 999.', '重复间隔请输入1至999的整数。'),
    })[code];
    const save = async () => {
        if (savingRef.current) return;
        const prepared = preparePlainCapture(draft);
        if (!prepared.ok) { setError(errorText(prepared.error)); return; }
        // Re-check the selected container at save time: another device may have
        // archived it since the picker opened. Do not silently drop its identity.
        const current = useTaskStore.getState();
        if ((prepared.props.projectId && !current.projects.some(p => p.id === prepared.props.projectId && !p.deletedAt && p.status === 'active'))
            || (prepared.props.areaId && !current.areas.some(a => a.id === prepared.props.areaId && !a.deletedAt))) {
            setError(text('That destination is no longer available. Choose another one.', '这个归属已不可用，请重新选择。'));
            return;
        }
        savingRef.current = true;
        setSaving(true);
        setError(null);
        try {
            await ensurePlannerBackup();
            const clock=plannerClock();
            const existing=pendingId.current&&useTaskStore.getState()._allTasks.some(t=>t.id===pendingId.current&&!t.deletedAt);
            if (pendingId.current && !existing) {
                throw new Error(text('The pending task is no longer available. Your draft is kept; clear it explicitly before creating a replacement.', '待保存任务已不可用。草稿仍然保留；如需重新创建，请先明确清除草稿。'));
            }
            let props:Partial<Task>={...prepared.props,planner:{version:1,blocks:[],days:[]},scheduledAt:undefined};
            let temporary={id:'new-capture',createdAt:clock.now.toISOString(),updatedAt:clock.now.toISOString(),title:prepared.title,status:prepared.props.status??'inbox',tags:[],contexts:[],...props} as Task;
            if(prepared.props.scheduledAt&&!existing){checkReservation(pendingId.current??'new-capture',blockId.current,prepared.props.scheduledAt,draft.durationMinutes??30,events,loaded&&!calendarError);props={...props,...scheduleWork(temporary,{id:blockId.current,startAt:prepared.props.scheduledAt,durationMinutes:draft.durationMinutes??30,timeZone:plannerTimeZone()},clock)};temporary={...temporary,...props};}
            if(draft.plannedDay)props={...props,...commitToDay(temporary,draft.plannedDay,true,clock)};
            const result = existing ? {success:true as const,id:pendingId.current!} : await addTask(prepared.title, props);
            if(result.success&&result.id){pendingId.current=result.id;localStorage.setItem(draftKey,JSON.stringify({draft,pendingId:result.id}));}
            if (!result.success) {
                setError(result.error || text('Could not save. Your draft is still here.', '保存失败，草稿仍然保留。'));
                return;
            }
            await flushPendingSave();
            pendingId.current=null;blockId.current=generateUUID();
            localStorage.removeItem(draftKey);
            const target = prepared.props.scheduledAt ? 'calendar' : prepared.props.status === 'inbox' ? 'inbox' : 'plan';
            setDraft(emptyPlainCapture());
            savingRef.current=false;close();
            showToast(text('Task added.', '已添加任务。'), 'success', 5000, {
                label: text('View', '查看'),
                onClick: () => {
                    if (result.id) useTaskStore.getState().setHighlightTask(result.id);
                    dispatchNavigateEvent(target);
                },
            });
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : text('Could not save. Your draft is still here.', '保存失败，草稿仍然保留。'));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || isInputComposition(event.nativeEvent)) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault(); event.stopPropagation(); void save();
        }
        if (event.key !== 'Tab') return;
        const elements = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary') ?? [])
            .filter(element => !element.closest('[hidden]')
                && !Array.from(element.closest('details') ? [element.closest('details')!] : [])
                    .some(details => !details.open && element !== details.querySelector('summary')));
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
            event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
    };
    if (!isOpen) return null;
    const inputClass = 'mt-1 min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-primary';
    const savedDraftKeys=Object.keys(localStorage).filter(key=>key.startsWith(`${draftKey}:saved:`));
    const activeProjects = projects.filter(project => !project.deletedAt && project.status === 'active');
    const activeAreas = areas.filter(area => !area.deletedAt).sort((a, b) => a.order - b.order);
    return <ModalPortal>
        <div style={viewport} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2 sm:p-4" onClick={event => { if (event.target === event.currentTarget) close(); }}>
            <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-heading`} data-testid="plain-capture-sheet"
                data-planner-form className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-xl" onKeyDown={keyDown}>
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
                    <h2 id={`${id}-heading`} className="font-semibold">{text('Capture a task', '记一件事')}</h2>
                    <button type="button" onClick={()=>close()} disabled={saving} aria-label={t('common.close')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"><X className="h-5 w-5" /></button>
                </header>
                {!!savedDraftKeys.length&&!draft.title&&<label className="p-4 text-sm">{text('Saved drafts','暂存草稿')}<select className="min-h-11 border border-border bg-card px-2" defaultValue="" onChange={e=>{try{const saved=JSON.parse(localStorage.getItem(e.target.value)||'null');if(saved?.draft){setDraft({...emptyPlainCapture(),...saved.draft});localStorage.removeItem(e.target.value);}}catch{setError(text('Could not restore that draft.','无法恢复这份草稿。'));}}}><option value="">{text('Restore a draft…','恢复草稿…')}</option>{savedDraftKeys.map(key=><option key={key} value={key}>{JSON.parse(localStorage.getItem(key)||'{}').draft?.title||text('Untitled draft','未命名草稿')}</option>)}</select></label>}
                {draftChoice&&<section className="space-y-2 border-b border-border p-4" aria-label={text('Unfinished draft','有未完成的草稿')}><p className="text-sm">{text('Keep the current draft, or save it aside and start this new capture?','继续当前草稿，还是保留它并另起一条？')}</p><button type="button" className="min-h-11 px-3 underline" onClick={()=>setDraftChoice(null)}>{text('Continue draft','继续草稿')}</button><button type="button" className="min-h-11 px-3 underline" disabled={!!pendingId.current} onClick={()=>{try{localStorage.setItem(`${draftKey}:saved:${generateUUID()}`,JSON.stringify({draft}));const request=draftChoice;setDraft(emptyPlainCapture());setDraftChoice(null);applyRequest(request);}catch{setError(text('Could not save the old draft aside. It has been kept.','无法另存旧草稿，原内容已保留。'));}}}>{text('Save aside and start new','另存草稿并新建')}</button></section>}
                {pendingId.current&&<p role="status" className="px-4 py-2 text-sm">{text('This task was created. Retry Save to finish writing it safely; do not create another copy.','任务已创建，请重试保存完成写入，不会重复创建。')}</p>}
                <form onSubmit={event => { event.preventDefault(); void save(); }} className="flex min-h-0 flex-col overflow-hidden">
                    <div className="min-h-0 overflow-y-auto overscroll-contain">
                    <fieldset disabled={saving||!!pendingId.current} className="min-w-0 px-4 py-4 space-y-4">
                        <div>
                            <label htmlFor={`${id}-title`} className="text-sm font-medium">{text('What do you need to do?', '要做什么？')}</label>
                            <textarea ref={titleRef} id={`${id}-title`} value={draft.title} onChange={event => set('title', event.target.value)} rows={2}
                                placeholder={text('For example: do the laundry', '例如：洗衣服')} className={`${inputClass} resize-y text-base`}
                                onKeyDown={event => {
                                    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && !isInputComposition(event.nativeEvent)) {
                                        event.preventDefault(); void save();
                                    }
                                }} />
                            <p className="mt-1 text-xs text-muted-foreground">{text('A name is enough. Dates and organization are optional; no special syntax is needed.', '只写一句话就能保存。时间和归属都可稍后补，不需要特殊语法。')}</p>
                        </div>
                        <div className="flex flex-wrap gap-2" role="group" aria-label={text('Save destination', '保存去向')}>
                            {(['inbox', 'next'] as const).map(destination => <button key={destination} type="button" aria-pressed={draft.destination === destination}
                                onClick={() => set('destination', destination)} disabled={Boolean(draft.scheduledAt)}
                                className={`min-h-11 rounded-md border px-3 text-sm disabled:opacity-50 ${draft.destination === destination ? 'border-primary bg-primary/10' : 'border-border'}`}>
                                {destination === 'inbox' ? text('Just capture', '先记下来') : text('Ready to plan', '已想清楚，加入待办')}
                            </button>)}
                        </div>
                        <details open={Boolean(draft.scheduledAt||draft.plannedDay)} className="rounded-lg border border-border p-3">
                            <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"><CalendarDays className="h-4 w-4" />{text('When?', '时间安排（可选）')}<ChevronDown className="ml-auto h-4 w-4" /></summary>
                            <div className="mt-3 space-y-3">
                                <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded border border-border px-3 text-sm" onClick={()=>set('plannedDay',localPlanDate(new Date()))}>{text('Choose today (no time reserved)','今天想做（不预留时段）')}</button><input aria-label={text('Choose a day','哪天想做')} type="date" value={draft.plannedDay??''} onChange={e=>set('plannedDay',e.target.value)} className={inputClass}/></div>
                                <label className="block text-sm">{text('Reserve a time', '准备什么时候做')}
                                    <input type="datetime-local" value={draft.scheduledAt} onChange={event => set('scheduledAt', event.target.value)} className={inputClass} />
                                </label>
                                {draft.scheduledAt&&<label className="block text-sm">{text('Minutes for this block','本次安排几分钟')}<input type="number" min={1} max={1440} value={draft.durationMinutes??30} onChange={e=>set('durationMinutes',e.target.valueAsNumber)} className={inputClass}/></label>}
                                <label className="block text-sm">{text('Available from (optional)','最早可执行日期（可选）')}<input type="date" value={draft.availableAt??''} onChange={e=>set('availableAt',e.target.value)} className={inputClass}/></label>
                                <p className="text-xs text-muted-foreground">{text('This creates a calendar reservation and makes the task Ready, not a deadline.', '填写后会加入待办并出现在日历；这不是截止时间。')}</p>
                                <label className="block text-sm">{text('Must finish by', '最晚哪天必须完成')}
                                    <input type="date" value={draft.dueDate} onChange={event => set('dueDate', event.target.value)} className={inputClass} />
                                </label>
                                <button type="button" className="min-h-11 px-2 text-sm text-primary" onClick={() => { set('scheduledAt', ''); set('dueDate', ''); set('plannedDay',''); set('availableAt',''); }}>{text('Clear dates', '清除时间')}</button>
                            </div>
                        </details>
                        <details className="rounded-lg border border-border p-3">
                            <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"><Repeat2 className="h-4 w-4" />{text('Repeat?', '重复（可选）')}<ChevronDown className="ml-auto h-4 w-4" /></summary>
                            <RepeatPicker value={draft.recurrence} onChange={value=>{set('recurrence',value);set('repeat','');}}/>
                        </details>
                        <details open={contentExpanded ?? Boolean(draft.description || draft.checklist?.length || initialRequest?.expandContent)} className="rounded-lg border border-border p-3">
                            <summary onClick={event => { event.preventDefault(); setContentExpanded(!(contentExpanded ?? Boolean(draft.description || draft.checklist?.length || initialRequest?.expandContent))); }} className="min-h-11 cursor-pointer content-center text-sm font-medium">{text('Content and steps', '正文、步骤与归属（可选）')}</summary>
                            <label className="mt-3 block text-sm">{text('Belongs to', '属于哪件事或哪个领域')}
                                <select value={draft.container} onChange={event => set('container', event.target.value)} className={inputClass}>
                                    <option value="">{text('No assignment needed', '暂不分类')}</option>
                                    {activeAreas.map(area => <optgroup key={area.id} label={area.name}>
                                        <option value={`area:${area.id}`}>{area.name} · {text('standalone task', '零散任务')}</option>
                                        {activeProjects.filter(project => project.areaId === area.id).map(project => <option key={project.id} value={`project:${project.id}`}>{project.title}</option>)}
                                    </optgroup>)}
                                    {activeProjects.filter(project => !activeAreas.some(area => area.id === project.areaId)).map(project => <option key={project.id} value={`project:${project.id}`}>{project.title}</option>)}
                                </select>
                            </label>
                            <CaptureContentFields t={t} description={draft.description} checklist={draft.checklist} onChange={patch=>setDraft(d=>({...d,...patch,description:patch.description??d.description}))}/>
                        </details>
                        {onAdvanced && !hasDraft && <button type="button" onClick={onAdvanced} className="min-h-11 text-sm text-muted-foreground underline">{text('Advanced capture: syntax, audio or text import', '高级录入：语法、语音或文本导入')}</button>}
                    </fieldset>
                    </div>
                    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                        {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
                        {hasDraft && <button type="button" disabled={saving || Boolean(pendingId.current && useTaskStore.getState()._allTasks.some(task => task.id === pendingId.current && !task.deletedAt))} className="min-h-11 text-sm underline disabled:opacity-40" onClick={() => { pendingId.current = null; setDraft(emptyPlainCapture()); setError(null); }}>{text('Clear this draft', '清空这份草稿')}</button>}
                        <button type="button" onClick={()=>close()} disabled={saving} className="min-h-11 rounded-md px-3 text-sm hover:bg-muted disabled:opacity-40">{text('Close · keep draft', '关闭，保留本次草稿')}</button>
                        <button type="submit" disabled={saving || !draft.title.trim()} className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40">
                            {saving ? text('Adding…', '正在添加…') : draft.scheduledAt ? text('Add to calendar', '添加到日历') : draft.destination === 'inbox' ? text('Add to Inbox', '存入收件箱') : text('Add task', '加入待办')}
                        </button>
                    </footer>
                </form>
            </div>
        </div>
    </ModalPortal>;
}
