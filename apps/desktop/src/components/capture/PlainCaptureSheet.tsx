import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronDown, Repeat2, X } from 'lucide-react';
import { shallow, useTaskStore } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { emptyPlainCapture, preparePlainCapture, type PlainCaptureDraft, type PlainCaptureError } from '../../lib/plain-capture';
import { dispatchNavigateEvent } from '../../lib/navigation-events';
import { useUiStore } from '../../store/ui-store';
import { ModalPortal } from '../ModalPortal';

export type PlainCaptureSheetProps = {
    isOpen: boolean;
    onClose: () => void;
    onAdvanced?: () => void;
};

export function PlainCaptureSheet({ isOpen, onClose, onAdvanced }: PlainCaptureSheetProps) {
    const { language, t } = useLanguage();
    const zh = language.startsWith('zh');
    const text = (en: string, cn: string) => zh ? cn : en;
    const id = useId();
    const titleRef = useRef<HTMLTextAreaElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const savingRef = useRef(false);
    const [saving, setSaving] = useState(false);
    // The host stays mounted while closed, so closing never discards a draft or
    // creates a half-filled task. Only a successful capture resets this state.
    const [draft, setDraft] = useState<PlainCaptureDraft>(emptyPlainCapture);
    const [error, setError] = useState<string | null>(null);
    const { addTask, projects, areas } = useTaskStore((state) => ({
        addTask: state.addTask, projects: state.projects, areas: state.areas,
    }), shallow);
    const showToast = useUiStore((state) => state.showToast);
    const hasDraft = JSON.stringify(draft) !== JSON.stringify(emptyPlainCapture());
    const set = <K extends keyof PlainCaptureDraft>(key: K, value: PlainCaptureDraft[K]) => {
        setDraft(current => ({ ...current, [key]: value }));
        setError(null);
    };
    useEffect(() => {
        if (!isOpen) return;
        const previous = document.activeElement as HTMLElement | null;
        titleRef.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, [isOpen]);

    const close = () => { if (!savingRef.current) onClose(); };
    const errorText = (code: PlainCaptureError) => ({
        title: text('Write a task name first.', '先写下要做的事情。'),
        schedule: text('Choose a valid date and time.', '请选择有效的日期和时间。'),
        due: text('Choose a valid deadline date.', '请选择有效的截止日期。'),
        availability: text('This time is before the task becomes available.', '安排时间早于任务最早可执行时间。'),
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
            const result = await addTask(prepared.title, prepared.props);
            if (!result.success) {
                setError(result.error || text('Could not save. Your draft is still here.', '保存失败，草稿仍然保留。'));
                return;
            }
            const target = prepared.props.scheduledAt ? 'calendar' : prepared.props.status === 'inbox' ? 'inbox' : 'plan';
            setDraft(emptyPlainCapture());
            onClose();
            showToast(text('Task added.', '已添加任务。'), 'success', 5000, {
                label: text('View', '查看'),
                onClick: () => {
                    if (result.id) useTaskStore.getState().setHighlightTask(result.id);
                    dispatchNavigateEvent(target);
                },
            });
        } catch {
            setError(text('Could not save. Your draft is still here.', '保存失败，草稿仍然保留。'));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
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
    const activeProjects = projects.filter(project => !project.deletedAt && project.status === 'active');
    const activeAreas = areas.filter(area => !area.deletedAt).sort((a, b) => a.order - b.order);
    return <ModalPortal>
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2 sm:p-4" onClick={event => { if (event.target === event.currentTarget) close(); }}>
            <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-heading`} data-testid="plain-capture-sheet"
                className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-xl" onKeyDown={keyDown}>
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
                    <h2 id={`${id}-heading`} className="font-semibold">{text('Capture a task', '记一件事')}</h2>
                    <button type="button" onClick={close} disabled={saving} aria-label={t('common.close')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"><X className="h-5 w-5" /></button>
                </header>
                <form onSubmit={event => { event.preventDefault(); void save(); }} className="flex min-h-0 flex-col">
                    <fieldset disabled={saving} className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
                        <div>
                            <label htmlFor={`${id}-title`} className="text-sm font-medium">{text('What do you need to do?', '要做什么？')}</label>
                            <textarea ref={titleRef} id={`${id}-title`} value={draft.title} onChange={event => set('title', event.target.value)} rows={2}
                                placeholder={text('For example: do the laundry', '例如：洗衣服')} className={`${inputClass} resize-y text-base`}
                                onKeyDown={event => {
                                    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && !event.nativeEvent.isComposing) {
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
                        <details className="rounded-lg border border-border p-3">
                            <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"><CalendarDays className="h-4 w-4" />{text('When?', '时间安排（可选）')}<ChevronDown className="ml-auto h-4 w-4" /></summary>
                            <div className="mt-3 space-y-3">
                                <label className="block text-sm">{text('Reserve a time', '准备什么时候做')}
                                    <input type="datetime-local" value={draft.scheduledAt} onChange={event => set('scheduledAt', event.target.value)} className={inputClass} />
                                </label>
                                <p className="text-xs text-muted-foreground">{text('This creates a calendar reservation and makes the task Ready, not a deadline.', '填写后会加入待办并出现在日历；这不是截止时间。')}</p>
                                <label className="block text-sm">{text('Must finish by', '最晚哪天必须完成')}
                                    <input type="date" value={draft.dueDate} onChange={event => set('dueDate', event.target.value)} className={inputClass} />
                                </label>
                                <button type="button" className="min-h-11 px-2 text-sm text-primary" onClick={() => { set('scheduledAt', ''); set('dueDate', ''); }}>{text('Clear dates', '清除时间')}</button>
                            </div>
                        </details>
                        <details className="rounded-lg border border-border p-3">
                            <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"><Repeat2 className="h-4 w-4" />{text('Repeat?', '重复（可选）')}<ChevronDown className="ml-auto h-4 w-4" /></summary>
                            <div className="mt-3 space-y-3">
                                <label className="block text-sm">{text('Frequency', '重复单位')}
                                    <select value={draft.repeat} onChange={event => set('repeat', event.target.value as PlainCaptureDraft['repeat'])} className={inputClass}>
                                        <option value="">{text('Does not repeat', '不重复')}</option>
                                        <option value="daily">{text('Days', '天')}</option><option value="weekly">{text('Weeks', '周')}</option>
                                        <option value="monthly">{text('Months', '月')}</option><option value="yearly">{text('Years', '年')}</option>
                                    </select>
                                </label>
                                {draft.repeat && <>
                                    <label className="block text-sm">{text('Every', '每隔多少个单位')}
                                        <input type="number" min={1} max={999} step={1} value={Number.isNaN(draft.interval) ? '' : draft.interval} onChange={event => set('interval', event.target.valueAsNumber)} className={inputClass} />
                                    </label>
                                    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.afterCompletion} onChange={event => set('afterCompletion', event.target.checked)} />{text('Count from completion instead of a fixed schedule', '从完成后开始计时，而不是固定日程')}</label>
                                </>}
                            </div>
                        </details>
                        <details className="rounded-lg border border-border p-3">
                            <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">{text('Context and notes', '归属与补充说明（可选）')}</summary>
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
                            <label className="mt-3 block text-sm">{text('Notes', '说明')}
                                <textarea value={draft.description} onChange={event => set('description', event.target.value)} rows={3} className={inputClass} />
                            </label>
                        </details>
                        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                        {onAdvanced && !hasDraft && <button type="button" onClick={onAdvanced} className="min-h-11 text-sm text-muted-foreground underline">{text('Advanced capture: syntax, audio or text import', '高级录入：语法、语音或文本导入')}</button>}
                    </fieldset>
                    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                        <button type="button" onClick={close} disabled={saving} className="min-h-11 rounded-md px-3 text-sm hover:bg-muted disabled:opacity-40">{text('Close · keep draft', '关闭，保留本次草稿')}</button>
                        <button type="submit" disabled={saving || !draft.title.trim()} className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40">
                            {saving ? text('Adding…', '正在添加…') : draft.scheduledAt ? text('Add to calendar', '添加到日历') : draft.destination === 'inbox' ? text('Add to Inbox', '存入收件箱') : text('Add task', '加入待办')}
                        </button>
                    </footer>
                </form>
            </div>
        </div>
    </ModalPortal>;
}
