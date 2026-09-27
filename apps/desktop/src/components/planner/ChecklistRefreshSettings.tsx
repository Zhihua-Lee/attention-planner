import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildRRuleString, checklistDescendants, checklistEndImpact, checklistEndPreview, checklistLocalDay, checklistTargetPolicy,
    generateUUID, parseRRuleString, resolveChecklistRefresh, useTaskStore,
    type ChecklistRefreshEnd, type ChecklistRefreshPolicy, type ChecklistRefreshSchedule, type ChecklistRefreshTarget, type RecurrenceByDay, type Task } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { saveChecklistPolicy, syncChecklistEnd } from '../../lib/checklist-refresh-actions';
import { checklistRuleDraftDirty, checklistRuleDrafts, type ChecklistRuleDraft } from '../../lib/checklist-rule-drafts';
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
function PolicyEditor({ task, itemId, disabled, onBusyChange, onDirtyChange, onSaved, onDiscarded }: {
    task: Task; itemId?: string; disabled: boolean; onBusyChange?: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void;
    onSaved: (backupCleared: boolean) => void; onDiscarded: (backupCleared: boolean) => void;
}) {
    const tasks = useTaskStore(state => state._allTasks), { now } = usePlannerEnvironment();
    const { language } = useLanguage(), zh = language.startsWith('zh'), l = (en: string, cn: string) => zh ? cn : en;
    const ruleId = useId();
    const target = { taskId: task.id, itemId };
    const inherited = resolveChecklistRefresh(task, itemId, tasks, true);
    const [restored] = useState(() => checklistRuleDrafts.load(target));
    // Restoring keeps the original base so the existing stale-write check still protects remote edits.
    const [draft, setDraft] = useState<ChecklistRuleDraft>(() => {
        if (restored.draft) return restored.draft;
        const base = checklistTargetPolicy(task, itemId), initial = base?.schedule ?? inherited.schedule;
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        return { base, initial, mode: base?.mode ?? 'inherit', schedule: initial ?? {
            id: '', frequency: 'weekly', interval: 1, weekdays: [2, 4], startDate: checklistLocalDay(now, zone), time: '06:00', timeZone: zone,
        }, end: base?.end ?? { mode: 'inherit' }, paused: !!base?.pausedAt };
    });
    const draftRef = useRef(draft);
    const { base, initial, mode, schedule, end, paused } = draft;
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [backupError, setBackupError] = useState(restored.error);
    const lock = useRef(false), dirty = checklistRuleDraftDirty(draft);
    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
    const change = (patch: Partial<ChecklistRuleDraft>) => {
        const next = { ...draftRef.current, ...patch };
        // Write in the input event, not an effect/cleanup: a switch or close can immediately unmount us.
        draftRef.current = next;
        setBackupError(checklistRuleDrafts.save(target, next) ? undefined : 'storage');
        setDraft(next);
        setError('');
    };
    const changeSchedule = (patch: Partial<ChecklistRefreshSchedule>) => change({ schedule: { ...draftRef.current.schedule, ...patch } });
    const save = async () => {
        if (lock.current) return;
        lock.current = true; setBusy(true); onBusyChange?.(true); setError('');
        try {
            const sameCadence = initial && JSON.stringify({ ...initial, id: '' }) === JSON.stringify({ ...schedule, id: '' });
            await saveChecklistPolicy(target, base, { mode, schedule: mode === 'custom'
                ? { ...schedule, id: sameCadence ? initial.id : generateUUID() } : undefined, end, paused });
            onSaved(checklistRuleDrafts.clear(target));
        } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
    };
    return <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3">
        <fieldset disabled={disabled || busy} className="min-w-0 space-y-3">
            <div>
                <label htmlFor={ruleId} className="block text-sm">{l('Refresh rule', '刷新规则')}</label>
                <select id={ruleId} className={input} value={mode} onChange={event => change({ mode: event.target.value as ChecklistRefreshPolicy['mode'] })}>
                    <option value="inherit">{l('Follow parent / checklist', '跟随父清单／当前清单')}</option>
                    <option value="custom">{l('Set independently', '单独设置')}</option>
                    <option value="off">{l('Do not refresh', '不刷新（一次性）')}</option>
                </select>
            </div>
            {mode === 'custom' && <>
                <RepeatPicker calendarOnly value={{ rule: schedule.frequency, strategy: 'strict', rrule: buildRRuleString(schedule.frequency,
                    schedule.weekdays?.map(day => weekdays[day - 1]), schedule.interval, { byMonthDay: schedule.monthDays }) }} onChange={value => {
                    if (!value) { change({ mode: 'off' }); return; }
                    const rule = typeof value === 'string' ? { rule: value } : value;
                    const parsed = rule.rrule ? parseRRuleString(rule.rrule) : undefined;
                    changeSchedule({ frequency: rule.rule, interval: parsed?.interval ?? 1,
                        weekdays: rule.rule === 'weekly' ? (parsed?.byDay ?? rule.byDay ?? []).map(day => weekdays.indexOf(day) + 1) : undefined,
                        monthDays: parsed?.byMonthDay ?? rule.byMonthDay });
                }} />
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">{l('Start date', '开始日期')}<input required type="date" className={input} value={schedule.startDate} onChange={event => changeSchedule({ startDate: event.target.value })} /></label>
                    <label className="text-sm">{l('Refresh time', '刷新时刻')}<input required type="time" className={input} value={schedule.time} onChange={event => changeSchedule({ time: event.target.value })} /></label>
                </div>
                <label className="block text-sm">{l('Timezone', '时区')}<input required className={input} value={schedule.timeZone} placeholder="America/Chicago" onChange={event => changeSchedule({ timeZone: event.target.value })} /></label>
            </>}
            <EndDatePicker value={end} onChange={value => change({ end: value })} />
            <p className="text-xs leading-5 text-muted-foreground">{l('The end date includes that whole local day. It is independent of the repeat rule: a child may inherit either setting or override it, including a later end date.', '结束日期包含当天，按刷新规则的时区计算。频率和结束日期分别继承；子清单可单独延长或取消结束日期。')}</p>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={paused} onChange={event => change({ paused: event.target.checked })} />{l('Pause refreshing', '暂停刷新')}</label>
            {inherited.pausedAt && !base?.pausedAt && <p className="text-xs text-muted-foreground">{l('A parent is paused. Resume it to allow this subtree to advance.', '父清单已暂停，需要先恢复父清单，本分支才会进入新一轮。')}</p>}
            {mode === 'inherit' && <p className="text-xs text-muted-foreground">{inherited.schedule
                ? l(`Inherited: ${inherited.schedule.time} · ${inherited.schedule.timeZone}`, `当前继承：${inherited.schedule.time} · ${inherited.schedule.timeZone}`)
                : l('No parent rule: this item currently does not refresh.', '没有可继承的规则，目前不刷新。')}</p>}
            {dirty && <p className="text-xs leading-5 text-muted-foreground">{l('This target has an unapplied draft. Switching targets or closing details keeps it; Save applies it and Discard reloads the latest saved settings.', '当前对象有未应用的草稿。切换对象或关闭详情会保留；保存后才生效，放弃草稿会读取最新已保存设置。')}</p>}
            {backupError && <p role="alert" className="text-sm text-destructive">{backupError === 'invalid'
                ? l('The saved rule draft could not be restored. It has not been applied. Discard it explicitly to clear this backup.', '无法恢复这份规则草稿，未应用任何修改。可明确放弃草稿以清除此备份。')
                : l('Browser storage is unavailable. Drafts stay in memory when switching or closing details; keep this page open.', '浏览器无法备份草稿。切换对象或关闭详情仍会在内存保留，但请不要刷新或关闭页面。')}</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-2">
                <button type="submit" className={`${button} bg-primary text-primary-foreground`}>{l('Save refresh settings', '保存刷新设置')}</button>
                {(dirty || backupError === 'invalid') && <button type="button" className={button} onClick={() => onDiscarded(checklistRuleDrafts.clear(target))}>{l('Discard rule draft', '放弃规则草稿')}</button>}
            </div>
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
    const tasks = useTaskStore(state => state._allTasks);
    const configureId = useId();
    const [itemId, setItemId] = useState(''), [revision, setRevision] = useState(0), [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false), [policyDirty, setPolicyDirty] = useState(false), [cleanupFailed, setCleanupFailed] = useState(false);
    const busyChanged = (value: boolean) => { setBusy(value); onBusyChange?.(value); };
    const reset = (backupCleared: boolean, discarded = false) => {
        setCleanupFailed(!backupCleared);
        setMessage(discarded ? l('Rule draft discarded.', '规则草稿已放弃。') : l('Refresh settings saved.', '刷新设置已保存。'));
        setPolicyDirty(false); setRevision(value => value + 1);
    };
    const subtreeTargets = [task, ...checklistDescendants(tasks, task.id)].flatMap(t => [
        { taskId: t.id }, ...(t.checklist ?? []).map(item => ({ taskId: t.id, itemId: item.id })),
    ]);
    const pendingDrafts = policyDirty || checklistRuleDrafts.hasDrafts(subtreeTargets);
    return <details className="space-y-3 rounded-xl border border-border p-3" data-testid="checklist-refresh-settings" data-planner-form>
        <summary className="min-h-11 cursor-pointer font-medium">{l('Checklist refresh', '清单定时刷新')}</summary>
        <p className="text-xs leading-5 text-muted-foreground">{l('Keep the list and item identities. Each scheduled round has its own completion record; missed rounds do not create extra tasks. Changing the cadence starts a new schedule version; changing only the end date keeps existing completion records.', '保留清单和条目，每轮单独记录完成情况；漏做不会堆积成新任务。改变频率或刷新时刻会开启新规则版本，仅修改结束日期不会清除已有的完成记录。')}</p>
        <div>
            <label htmlFor={configureId} className="block text-sm">{l('Configure', '设置对象')}</label>
            <select id={configureId} className={input} value={itemId} disabled={disabled || busy} onChange={event => { setItemId(event.target.value); setMessage(''); }}>
                <option value="">{l('This checklist default (also inherited by child lists)', '当前清单默认（子清单也可继承）')}</option>
                {task.checklist?.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
        </div>
        <PolicyEditor key={`${task.id}:${itemId}:${revision}`} task={task} itemId={itemId || undefined} disabled={disabled || busy} onBusyChange={busyChanged} onDirtyChange={setPolicyDirty} onSaved={cleared => reset(cleared)} onDiscarded={cleared => reset(cleared, true)} />
        {pendingDrafts && <p className="text-xs text-muted-foreground">{l('Save or discard pending rule drafts in this checklist and its children before batch syncing end dates.', '请先保存或放弃当前清单及子清单中的规则草稿，再批量同步结束日期。')}</p>}
        <BulkEndEditor task={task} disabled={disabled || busy || pendingDrafts} onBusyChange={busyChanged} onSaved={() => reset(true)} />
        {message && <p role="status" className="text-sm text-primary">{message}</p>}
        {cleanupFailed && <p role="alert" className="text-sm text-destructive">{l('The old draft backup could not be removed from browser storage. It is cleared in this session, but may return after reload.', '无法清除浏览器中的旧草稿备份。本次会话已清除，但刷新后可能再次出现。')}</p>}
        <p className="text-xs leading-5 text-muted-foreground">{l('Refreshing is not a notification. While closed, no background job is required: opening the app computes the current round. An end date stops new rounds and keeps the last one; choose Do not refresh before permanently completing a list.', '刷新不等于提醒。关闭应用时不需要后台常驻，再打开直接显示当前轮。到结束日期后保留最后一轮，不再刷新；需要永久完成清单时，先将刷新规则设为“不刷新”。')}</p>
    </details>;
}
