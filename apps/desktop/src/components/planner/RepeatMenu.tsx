import type { ReactNode } from 'react';
import { useLanguage } from '../../contexts/language-context';
import { defaultRule, isoWeekday, type RepeatRule, type StepRepeat, type TaskRepeat } from '../../lib/repeat-rules';
import { InfoTip } from '../ui/InfoTip';

const chip = 'min-h-9 rounded-md border px-2.5 text-sm transition-colors disabled:opacity-40';
const on = 'border-primary bg-primary/10 text-foreground', off = 'border-border text-muted-foreground hover:bg-muted hover:text-foreground';
const field = 'min-h-9 rounded-md border border-border bg-background px-2 text-sm';

function Segmented<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: Array<[T, string]>; onChange: (value: T) => void; disabled?: boolean; label: string }) {
    return <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1">
        {options.map(([id, text]) => <button key={id} type="button" role="radio" aria-checked={value === id} disabled={disabled}
            className={`${chip} ${value === id ? on : off}`} onClick={() => onChange(id)}>{text}</button>)}
    </div>;
}
/** `about` names the tip button apart from the field it explains. */
function Line({ label, tip, about, children }: { label: string; tip?: ReactNode; about?: string; children: ReactNode }) {
    return <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">{label}{tip && <InfoTip label={about ?? label}>{tip}</InfoTip>}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1">{children}</div>
    </div>;
}

/**
 * One editor for every repeat: the task's own ("reopen in place" or "a new copy") and a step's.
 * Each setting appears once; each choice is applied immediately through `onChange`.
 */
export function RepeatMenu({ scope, value, onChange, disabled }: {
    scope: 'task' | 'step';
    value: TaskRepeat | StepRepeat;
    onChange: (next: TaskRepeat | StepRepeat) => void;
    disabled?: boolean;
}) {
    const { language } = useLanguage(), zh = language.startsWith('zh'), l = (en: string, cn: string) => zh ? cn : en;
    const rule: RepeatRule | undefined = 'rule' in value ? value.rule : undefined;
    const copy = value.kind === 'copy', reopen = value.kind === 'reopen' || value.kind === 'own';
    const emit = (next: RepeatRule) => onChange(value.kind === 'reopen' ? { ...value, rule: next } : value.kind === 'copy' ? { kind: 'copy', rule: next } : { kind: 'own', rule: next });
    const patch = (fields: Partial<RepeatRule>) => rule && emit({ ...rule, ...fields });
    const fresh = () => rule ?? defaultRule();
    const modes: Array<[string, string]> = scope === 'task'
        ? [['none', l('None', '不重复')], ['reopen', l('Reopen', '原地重开')], ['copy', l('New copy', '新建一份')]]
        : [['follow', l('Follow task', '跟随任务')], ['own', l('Own rule', '单独')], ['none', l('None', '不重复')]];
    const calendar = rule?.anchor === 'calendar';
    const frequencies: Array<[RepeatRule['frequency'], string]> = [
        ...(rule?.anchor === 'completion' && !copy ? [['hourly', l('Hourly', '按小时')] as [RepeatRule['frequency'], string]] : []),
        ['daily', l('Daily', '按天')], ['weekly', l('Weekly', '按周')], ['monthly', l('Monthly', '按月')], ['yearly', l('Yearly', '按年')]];
    const unit = rule && { hourly: l('hours', '小时'), daily: l('days', '天'), weekly: l('weeks', '周'), monthly: l('months', '个月'), yearly: l('years', '年') }[rule.frequency];
    const ends = rule?.end ? 'until' : rule?.count && copy ? 'count' : 'never';
    return <div className="space-y-3 rounded-lg border border-border bg-card p-3" data-repeat-menu={scope}>
        <div className="flex flex-wrap items-center gap-1">
            <Segmented label={l('Repeat', '重复')} disabled={disabled} value={value.kind} options={modes} onChange={kind => {
                if (kind === value.kind) return;
                if (kind === 'none' || kind === 'follow') onChange({ kind } as TaskRepeat | StepRepeat);
                else if (kind === 'reopen') onChange({ kind: 'reopen', rule: fresh(), paused: false });
                else onChange({ kind: kind as 'copy' | 'own', rule: fresh() } as TaskRepeat | StepRepeat);
            }} />
            <InfoTip label={l('About repeat', '关于重复')}>{scope === 'task'
                ? l('Reopen: the same task opens again each round and its checklist is cleared; past rounds stay in its history. New copy: completing it marks this one done and creates the next task, each with its own notes and blocks.',
                    '原地重开：同一个任务每轮重新打开，清单勾选清空，往期记入完成历史。新建一份：完成后这一个归档，并新建下一次的任务，各自保留正文和时段。')
                : l('Follow task: the step clears with the task\'s rounds. Own rule: it clears on its own schedule. None: a one-time step.',
                    '跟随任务：随任务每轮清空。单独：按自己的规则清空。不重复：一次性步骤。')}</InfoTip>
        </div>
        {rule && <div className="space-y-2 border-t border-border/60 pt-3">
            <Line label={l('Frequency', '频率')}>
                <select aria-label={l('Frequency', '频率')} className={field} disabled={disabled} value={rule.frequency} onChange={e => {
                    const frequency = e.target.value as RepeatRule['frequency'];
                    patch({ frequency, ...(frequency === 'weekly' && !rule.weekdays?.length ? { weekdays: [isoWeekday(rule.startDate)] } : {}) });
                }}>
                    {frequencies.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
                </select>
            </Line>
            <Line label={l('Every', '每隔')}>
                <input type="number" min={1} max={999} aria-label={l('Interval', '间隔')} className={`${field} w-20`} disabled={disabled} value={rule.interval}
                    onChange={e => { const n = e.target.valueAsNumber; if (Number.isInteger(n) && n >= 1 && n <= 999) patch({ interval: n }); }} />
                <span className="text-sm text-muted-foreground">{unit}</span>
            </Line>
            <div className="flex items-center gap-1">
                <label className="flex min-h-9 items-center gap-2 text-sm">
                    <input type="checkbox" checked={!calendar} disabled={disabled}
                        onChange={e => patch({ anchor: e.target.checked ? 'completion' : 'calendar', frequency: !e.target.checked && rule.frequency === 'hourly' ? 'daily' : rule.frequency })} />
                    {l('Count from completion', '从完成后计时')}
                </label>
                <InfoTip label={l('About counting from completion', '关于从完成后计时')}>{l('Off: rounds follow the calendar. On: the next round starts this long after the last check.', '不勾：按日历固定日期。勾选：最后一项勾完后，再过这段时间开始下一轮。')}</InfoTip>
            </div>
            {calendar && rule.frequency === 'weekly' && <Line label={l('Days', '星期')}>
                {[1, 2, 3, 4, 5, 6, 7].map(day => { const selected = rule.weekdays?.includes(day) ?? false; return <button key={day} type="button" aria-pressed={selected} disabled={disabled}
                    className={`${chip} min-w-9 px-0 ${selected ? on : off}`} onClick={() => {
                        const next = selected ? (rule.weekdays ?? []).filter(d => d !== day) : [...(rule.weekdays ?? []), day].sort();
                        if (next.length) patch({ weekdays: next });
                    }}>{(zh ? ['一', '二', '三', '四', '五', '六', '日'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'])[day - 1]}</button>; })}
            </Line>}
            {calendar && rule.frequency === 'monthly' && <Line label={l('Day', '每月哪天')}>
                <select aria-label={l('Day of month', '每月哪天')} className={field} disabled={disabled} value={rule.monthDays?.length === 1 ? String(rule.monthDays[0]) : ''}
                    onChange={e => patch({ monthDays: e.target.value ? [Number(e.target.value)] : undefined })}>
                    <option value="">{copy ? l('Same day as the first one', '与初次任务同一天') : l('Same day as the start', '与开始日期同一天')}</option>
                    <option value={-1}>{l('Last day', '最后一天')}</option>
                    {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{zh ? `${i + 1} 日` : i + 1}</option>)}
                </select>
            </Line>}
            <Line label={l('Ends', '何时停止')} about={l('About the end', '关于何时停止')} tip={reopen ? l('Inclusive. After it, the last round stays; no new rounds start.', '包含当天。之后保留最后一轮，不再开始新一轮。') : undefined}>
                <select aria-label={l('Stop repeating', '何时停止')} className={field} disabled={disabled} value={ends} onChange={e => {
                    const mode = e.target.value;
                    patch(mode === 'until' ? { end: rule.end ?? rule.startDate, count: undefined } : mode === 'count' ? { end: undefined, count: rule.count ?? 10 } : { end: undefined, count: undefined });
                }}>
                    <option value="never">{l('Never', '不设结束')}</option>
                    <option value="until">{l('On a date', '到指定日期')}</option>
                    {copy && <option value="count">{l('After a number of times', '达到指定次数')}</option>}
                </select>
                {ends === 'until' && <input type="date" aria-label={l('End date', '结束日期')} className={field} disabled={disabled} value={rule.end ?? ''}
                    onChange={e => { if (e.target.value) patch({ end: e.target.value }); }} />}
                {ends === 'count' && <><input type="number" min={1} max={9999} aria-label={l('Total times', '总次数')} className={`${field} w-20`} disabled={disabled} value={rule.count}
                    onChange={e => { const n = e.target.valueAsNumber; if (Number.isInteger(n) && n >= 1 && n <= 9999) patch({ count: n }); }} />
                    <span className="text-sm text-muted-foreground">{l('times', '次')}</span></>}
            </Line>
            {reopen && <details className="group">
                <summary className="flex min-h-9 cursor-pointer items-center text-xs text-muted-foreground">{l('More', '更多')}</summary>
                <div className="mt-2 space-y-2">
                    <Line label={l('Starts', '开始日期')}>
                        <input type="date" aria-label={l('Starts', '开始日期')} className={field} disabled={disabled} value={rule.startDate} onChange={e => { if (e.target.value) patch({ startDate: e.target.value }); }} />
                    </Line>
                    <Line label={l('Time', '刷新时刻')} about={l('About time', '关于刷新时刻')} tip={calendar ? l(`When a new round starts, in ${rule.timeZone}.`, `新一轮开始的时刻，按 ${rule.timeZone} 计算。`) : l('When the first round starts.', '首轮开始的时刻。')}>
                        <input type="time" aria-label={l('Time', '刷新时刻')} className={field} disabled={disabled} value={rule.time} onChange={e => { if (e.target.value) patch({ time: e.target.value }); }} />
                    </Line>
                    <Line label={l('Time zone', '时区')}>
                        <input aria-label={l('Time zone', '时区')} className={`${field} w-48`} disabled={disabled} defaultValue={rule.timeZone} key={rule.timeZone}
                            onBlur={e => { const zone = e.target.value.trim(); if (zone && zone !== rule.timeZone) patch({ timeZone: zone }); }} />
                    </Line>
                    {value.kind === 'reopen' && <label className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
                        <input type="checkbox" checked={value.paused} disabled={disabled} onChange={e => onChange({ ...value, paused: e.target.checked })} />{l('Paused', '暂停')}
                    </label>}
                </div>
            </details>}
        </div>}
    </div>;
}
