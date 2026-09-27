import { useEffect, useMemo, useRef, useState } from 'react';
import { buildRRuleString, checklistDescendants, checklistEndImpact, checklistEndPreview, checklistLocalDay, checklistTargetPolicy,
    generateUUID, parseRRuleString, resolveChecklistRefresh, useTaskStore,
    type ChecklistRefreshEnd, type ChecklistRefreshPolicy, type ChecklistRefreshSchedule, type ChecklistRefreshTarget, type RecurrenceByDay, type Task } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { saveChecklistPolicy, syncChecklistEnd } from '../../lib/checklist-refresh-actions';
import { RepeatPicker } from './RepeatPicker';
import { usePlannerEnvironment } from './usePlannerEnvironment';

const weekdays: RecurrenceByDay[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const input = 'mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const button = 'min-h-11 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40';
const targetKey = (target: ChecklistRefreshTarget) => JSON.stringify([target.taskId, target.itemId ?? null]);
function EndDatePicker({ value, onChange, prefix = '' }: { value: ChecklistRefreshEnd; onChange: (end: ChecklistRefreshEnd) => void; prefix?: string }) {
    const { language } = useLanguage(), zh = language.startsWith('zh');
    const l = (en: string, cn: string) => zh ? cn : en;
    return <div className="space-y-2">
        <label className="block text-sm">{l('End date', '结束日期')}<select aria-label={`${prefix}${l('End date mode', '结束日期方式')}`} className={input} value={value.mode}
            onChange={event => onChange({ mode: event.target.value as ChecklistRefreshEnd['mode'], ...(event.target.value === 'date' ? { date: value.date ?? '' } : {}) })}>
            <option value="inherit">{l('Follow parent / checklist', '跟随父清单／当前清单')}</option>
            <option value="never">{l('No end date', '不设结束日期')}</option>
            <option value="date">{l('Set independently', '单独设置日期')}</option>
        </select></label>
        {value.mode === 'date' && <input type="date" required aria-label={`${prefix}${l('End date', '结束日期')}`} className={input} value={value.date ?? ''} onChange={event => onChange({ mode: 'date', date: event.target.value })} />}
    </div>;
}
function PolicyEditor({ task, itemId, disabled, onBusyChange, onDirtyChange, onSaved }: {
    task: Task; itemId?: string; disabled: boolean; onBusyChange?: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void; onSaved: () => void;
}) {
    const tasks = useTaskStore(state => state._allTasks), { now } = usePlannerEnvironment();
    const { language } = useLanguage(), zh = language.startsWith('zh'), l = (en: string, cn: string) => zh ? cn : en;
    // A private settings draft, with an explicit stale-write check at Save.
    const [base] = useState(() => checklistTargetPolicy(task, itemId));
    const inherited = resolveChecklistRefresh(task, itemId, tasks, true);
    const [initial] = useState(() => base?.schedule ?? inherited.schedule);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const [mode, setMode] = useState<ChecklistRefreshPolicy['mode']>(base?.mode ?? 'inherit');
    const [schedule, setSchedule] = useState<ChecklistRefreshSchedule>(() => initial ?? {
        id: '', frequency: 'weekly', interval: 1, weekdays: [2, 4], startDate: checklistLocalDay(now, zone), time: '06:00', timeZone: zone,
    });
    const [end, setEnd] = useState<ChecklistRefreshEnd>(base?.end ?? { mode: 'inherit' });
    const [paused, setPaused] = useState(!!base?.pausedAt), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const lock = useRef(false);
    const dirty = mode !== (base?.mode ?? 'inherit') || JSON.stringify(end) !== JSON.stringify(base?.end ?? { mode: 'inherit' })
        || paused !== !!base?.pausedAt || mode === 'custom' && JSON.stringify(schedule) !== JSON.stringify(initial);
    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
    const save = async () => {
        if (lock.current) return;
        lock.current = true; setBusy(true); onBusyChange?.(true); setError('');
        try {
            const sameCadence = initial && JSON.stringify({ ...initial, id: '' }) === JSON.stringify({ ...schedule, id: '' });
            await saveChecklistPolicy({ taskId: task.id, itemId }, base, { mode, schedule: mode === 'custom'
                ? { ...schedule, id: sameCadence ? initial.id : generateUUID() } : undefined, end, paused });
            onSaved();
        } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
    };
    return <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3">
        <fieldset disabled={disabled || busy} className="min-w-0 space-y-3">
            <label className="block text-sm">{l('Refresh rule', '刷新规则')}<select className={input} value={mode} onChange={event => setMode(event.target.value as ChecklistRefreshPolicy['mode'])}>
                <option value="inherit">{l('Follow parent / checklist', '跟随父清单／当前清单')}</option>
                <option value="custom">{l('Set independently', '单独设置')}</option>
                <option value="off">{l('Do not refresh', '不刷新（一次性）')}</option>
            </select></label>
            {mode === 'custom' && <>
                <RepeatPicker calendarOnly value={{ rule: schedule.frequency, strategy: 'strict', rrule: buildRRuleString(schedule.frequency,
                    schedule.weekdays?.map(day => weekdays[day - 1]), schedule.interval, { byMonthDay: schedule.monthDays }) }} onChange={value => {
                    if (!value) { setMode('off'); return; }
                    const rule = typeof value === 'string' ? { rule: value } : value;
                    const parsed = rule.rrule ? parseRRuleString(rule.rrule) : undefined;
                    setSchedule(current => ({ ...current, frequency: rule.rule, interval: parsed?.interval ?? 1,
                        weekdays: rule.rule === 'weekly' ? (parsed?.byDay ?? rule.byDay ?? []).map(day => weekdays.indexOf(day) + 1) : undefined,
                        monthDays: parsed?.byMonthDay ?? rule.byMonthDay }));
                }} />
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">{l('Start date', '开始日期')}<input required type="date" className={input} value={schedule.startDate} onChange={event => setSchedule(s => ({ ...s, startDate: event.target.value }))} /></label>
                    <label className="text-sm">{l('Refresh time', '刷新时刻')}<input required type="time" className={input} value={schedule.time} onChange={event => setSchedule(s => ({ ...s, time: event.target.value }))} /></label>
                </div>
                <label className="block text-sm">{l('Timezone', '时区')}<input required className={input} value={schedule.timeZone} placeholder="America/Chicago" onChange={event => setSchedule(s => ({ ...s, timeZone: event.target.value }))} /></label>
            </>}
            <EndDatePicker value={end} onChange={setEnd} />
            <p className="text-xs leading-5 text-muted-foreground">{l('The end date includes that whole local day. It is independent of the repeat rule: a child may inherit either setting or override it, including a later end date.', '结束日期包含当天，按刷新规则的时区计算。频率和结束日期分别继承；子清单可单独延长或取消结束日期。')}</p>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={paused} onChange={event => setPaused(event.target.checked)} />{l('Pause refreshing', '暂停刷新')}</label>
            {inherited.pausedAt && !base?.pausedAt && <p className="text-xs text-muted-foreground">{l('A parent is paused. Resume it to allow this subtree to advance.', '父清单已暂停，需要先恢复父清单，本分支才会进入新一轮。')}</p>}
            {mode === 'inherit' && <p className="text-xs text-muted-foreground">{inherited.schedule
                ? l(`Inherited: ${inherited.schedule.time} · ${inherited.schedule.timeZone}`, `当前继承：${inherited.schedule.time} · ${inherited.schedule.timeZone}`)
                : l('No parent rule: this item currently does not refresh.', '没有可继承的规则，目前不刷新。')}</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <button type="submit" className={`${button} bg-primary text-primary-foreground`}>{l('Save refresh settings', '保存刷新设置')}</button>
        </fieldset>
    </form>;
}
function BulkEndEditor({ task, disabled, onBusyChange, onSaved }: { task: Task; disabled: boolean; onBusyChange?: (busy: boolean) => void; onSaved: () => void }) {
    const tasks = useTaskStore(state => state._allTasks), { language } = useLanguage(), zh = language.startsWith('zh');
    const l = (en: string, cn: string) => zh ? cn : en;
    const targets = useMemo(() => [task, ...checklistDescendants(tasks, task.id)].flatMap(t => [
        { taskId: t.id, label: `${t.title} · ${l('list default', '清单默认')}` },
        ...(t.checklist ?? []).map(item => ({ taskId: t.id, itemId: item.id, label: `${t.title} / ${item.title}` })),
    ]), [tasks, task, zh]);
    const [selected, setSelected] = useState<Set<string>>(new Set()), [end, setEnd] = useState<ChecklistRefreshEnd>({ mode: 'date', date: '' });
    const [preview, setPreview] = useState<{ targets: ReturnType<typeof checklistEndPreview>; end: ChecklistRefreshEnd; impact: ReturnType<typeof checklistEndImpact> } | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), lock = useRef(false);
    const confirm = async () => {
        if (!preview || lock.current) return;
        lock.current = true; setBusy(true); onBusyChange?.(true); setError('');
        try { await syncChecklistEnd(preview.targets, preview.end, preview.impact); setPreview(null); onSaved(); }
        catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
    };
    const endText = (value: ChecklistRefreshEnd) => value.mode === 'date' ? value.date : value.mode === 'never' ? l('No end date', '不设结束日期') : l('Inherited', '继承');
    return <details className="rounded-lg border border-border p-3" data-testid="checklist-end-bulk">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">{l('Batch sync end dates', '批量同步结束日期')}</summary>
        <fieldset disabled={disabled || busy || !!preview} className="mt-3 min-w-0 space-y-3">
            <EndDatePicker prefix={l('Batch ', '批量')} value={end} onChange={setEnd} />
            <p className="text-xs text-muted-foreground">{l('Only selected end dates are replaced, including independent overrides. Frequencies, paused state and history are kept.', '只覆盖选中目标的结束日期，包括已有的单独设置；不改变频率、暂停状态和历史记录。')}</p>
            <div className="flex gap-2"><button type="button" className={button} onClick={() => setSelected(new Set(targets.map(targetKey)))}>{l('Select all', '全选')}</button><button type="button" className={button} onClick={() => setSelected(new Set())}>{l('Clear selection', '清除选择')}</button></div>
            <div className="max-h-64 space-y-1 overflow-y-auto">{targets.map(target => <label key={targetKey(target)} className="flex min-h-11 items-start gap-2 py-2 text-sm">
                <input className="mt-1" type="checkbox" checked={selected.has(targetKey(target))} onChange={event => setSelected(old => { const next = new Set(old); if (event.target.checked) next.add(targetKey(target)); else next.delete(targetKey(target)); return next; })} />
                <span className="min-w-0 break-words">{target.label}</span>
            </label>)}</div>
            <button type="button" className={button} disabled={!selected.size || end.mode === 'date' && !end.date} onClick={() => {
                try {
                    setError('');
                    const current = useTaskStore.getState()._allTasks;
                    const chosen = checklistEndPreview(current, targets.filter(target => selected.has(targetKey(target))));
                    setPreview({ targets: chosen, end: { ...end }, impact: checklistEndImpact(current, chosen, end) });
                }
                catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
            }}>{l('Preview sync', '预览同步')}</button>
        </fieldset>
        {preview && <section role="alertdialog" aria-label={l('Confirm end date sync', '确认结束日期同步')} className="mt-3 space-y-3 rounded-lg border border-primary/40 p-3">
            <p className="text-sm font-medium">{l(`Replace end dates for ${preview.targets.length} selected targets?`, `覆盖这 ${preview.targets.length} 个选中目标的结束日期？`)}</p>
            <div className="max-h-60 space-y-2 overflow-y-auto">{preview.targets.map(target => <p key={targetKey(target)} className="break-words text-sm">{target.title}：{endText(target.end)} → {endText(preview.end)}</p>)}</div>
            {!!preview.impact.length && <details open><summary className="min-h-11 text-sm">{l('Effective changes, including inherited children', '实际影响（含跟随父清单的子项）')}</summary>
                <div className="max-h-60 space-y-2 overflow-y-auto">{preview.impact.map(target => <p key={targetKey(target)} className="break-words text-sm">{target.title}：{target.before ?? l('No end date', '不设结束日期')} → {target.after ?? l('No end date', '不设结束日期')}</p>)}</div>
            </details>}
            <div className="flex flex-wrap gap-2"><button type="button" className={`${button} bg-primary text-primary-foreground`} disabled={busy} onClick={() => void confirm()}>{l('Confirm sync', '确认同步')}</button><button type="button" className={button} disabled={busy} onClick={() => setPreview(null)}>{l('Cancel', '取消')}</button></div>
        </section>}
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </details>;
}
export function ChecklistRefreshSettings({ task, disabled = false, onBusyChange }: { task: Task; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
    const { language } = useLanguage(), zh = language.startsWith('zh'), l = (en: string, cn: string) => zh ? cn : en;
    const [itemId, setItemId] = useState(''), [revision, setRevision] = useState(0), [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false), [policyDirty, setPolicyDirty] = useState(false);
    const busyChanged = (value: boolean) => { setBusy(value); onBusyChange?.(value); };
    const saved = () => { setMessage(l('Refresh settings saved.', '刷新设置已保存。')); setRevision(value => value + 1); };
    return <details className="space-y-3 rounded-xl border border-border p-3" data-testid="checklist-refresh-settings" data-planner-form>
        <summary className="min-h-11 cursor-pointer font-medium">{l('Checklist refresh', '清单定时刷新')}</summary>
        <p className="text-xs leading-5 text-muted-foreground">{l('Keep the list and item identities. Each scheduled round has its own completion record; missed rounds do not create extra tasks. Changing the cadence starts a new schedule version; changing only the end date keeps existing completion records.', '保留清单和条目，每轮单独记录完成情况；漏做不会堆积成新任务。改变频率或刷新时刻会开启新规则版本，仅修改结束日期不会清除已有的完成记录。')}</p>
        <label className="block text-sm">{l('Configure', '设置对象')}<select className={input} value={itemId} disabled={disabled || busy} onChange={event => { setItemId(event.target.value); setMessage(''); }}>
            <option value="">{l('This checklist default (also inherited by child lists)', '当前清单默认（子清单也可继承）')}</option>
            {task.checklist?.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        <PolicyEditor key={`${task.id}:${itemId}:${revision}`} task={task} itemId={itemId || undefined} disabled={disabled || busy} onBusyChange={busyChanged} onDirtyChange={setPolicyDirty} onSaved={saved} />
        {policyDirty && <p className="text-xs text-muted-foreground">{l('Save the rule draft before batch syncing end dates.', '先保存当前规则草稿，再批量同步结束日期。')}</p>}
        <BulkEndEditor task={task} disabled={disabled || busy || policyDirty} onBusyChange={busyChanged} onSaved={saved} />
        {message && <p role="status" className="text-sm text-primary">{message}</p>}
        <p className="text-xs leading-5 text-muted-foreground">{l('Refreshing is not a notification. While closed, no background job is required: opening the app computes the current round. An end date stops new rounds and keeps the last one; choose Do not refresh before permanently completing a list.', '刷新不等于提醒。关闭应用时不需要后台常驻，再打开直接显示当前轮。到结束日期后保留最后一轮，不再刷新；需要永久完成清单时，先将刷新规则设为“不刷新”。')}</p>
    </details>;
}
