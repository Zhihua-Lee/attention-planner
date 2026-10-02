import { useState, type ReactNode } from 'react';
import { useLanguage } from '../../contexts/language-context';
import { matchingPreset, presetRule, ruleLabel, defaultRule, type PresetId, type RepeatRule, type StepRepeat, type TaskRepeat } from '../../lib/repeat-rules';
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
 * Each choice is applied immediately through `onChange`.
 */
export function RepeatMenu({ scope, value, onChange, disabled }: {
    scope: 'task' | 'step';
    value: TaskRepeat | StepRepeat;
    onChange: (next: TaskRepeat | StepRepeat) => void;
    disabled?: boolean;
}) {
    const { language } = useLanguage(), zh = language.startsWith('zh'), l = (en: string, cn: string) => zh ? cn : en;
    const rule: RepeatRule | undefined = 'rule' in value ? value.rule : undefined;
    const [custom, setCustom] = useState(() => !!rule && !matchingPreset(rule));
    const copy = value.kind === 'copy', reopen = value.kind === 'reopen' || value.kind === 'own';
    const emit = (next: RepeatRule) => onChange(value.kind === 'reopen' ? { ...value, rule: next } : value.kind === 'copy' ? { kind: 'copy', rule: next } : { kind: 'own', rule: next });
    const patch = (fields: Partial<RepeatRule>) => rule && emit({ ...rule, ...fields });
    const fresh = () => rule ?? defaultRule();
    const modes: Array<[string, string]> = scope === 'task'
        ? [['none', l('None', '不重复')], ['reopen', l('Reopen', '原地重开')], ['copy', l('New copy', '新建一份')]]
        : [['follow', l('Follow task', '跟随任务')], ['own', l('Own rule', '单独')], ['none', l('None', '不重复')]];
    const presets: Array<[PresetId, string]> = [['daily', l('Daily', '每天')], ['weekdays', l('Weekdays', '工作日')],
        ['weekly', ruleLabel(presetRule('weekly', fresh()), zh)], ['monthly', ruleLabel(presetRule('monthly', fresh()), zh)],
        ['after-1-day', ruleLabel(presetRule('after-1-day', fresh()), zh)]];
    const preset = rule && !custom ? matchingPreset(rule) : undefined;
    const units: Array<[RepeatRule['frequency'], string]> = [
        ...(rule?.anchor === 'completion' && !copy ? [['hourly', l('hours', '小时')] as [RepeatRule['frequency'], string]] : []),
        ['daily', l('days', '天')], ['weekly', l('weeks', '周')], ['monthly', l('months', '个月')], ['yearly', l('years', '年')]];
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
        {rule && <>
            <div className="flex flex-wrap gap-1" role="group" aria-label={l('Presets', '常用')}>
                {presets.map(([id, text]) => <button key={id} type="button" disabled={disabled} aria-pressed={preset === id}
                    className={`${chip} ${preset === id ? on : off}`} onClick={() => { setCustom(false); emit(presetRule(id, rule)); }}>{text}</button>)}
                <button type="button" disabled={disabled} aria-pressed={custom || !preset} className={`${chip} ${custom || !preset ? on : off}`} onClick={() => setCustom(true)}>{l('Custom', '自定义')}</button>
            </div>
            {(custom || !preset) && <div className="space-y-2 border-t border-border/60 pt-3">
                <Line label={l('Timing', '计时')} about={l('About timing', '关于计时')} tip={l('Calendar: rounds start on fixed dates. After done: the next round starts this long after the last check.', '按日历：在固定日期开始新一轮。完成后：最后一项勾完后，再过这段时间开始新一轮。')}>
                    <Segmented label={l('Timing', '计时')} disabled={disabled} value={rule.anchor} options={[['calendar', l('Calendar', '按日历')], ['completion', l('After done', '完成后')]]}
                        onChange={anchor => patch({ anchor, frequency: anchor === 'calendar' && rule.frequency === 'hourly' ? 'daily' : rule.frequency })} />
                </Line>
                <Line label={l('Every', '每隔')}>
                    <input type="number" min={1} max={999} aria-label={l('Interval', '间隔')} className={`${field} w-20`} disabled={disabled} value={rule.interval}
                        onChange={e => { const n = e.target.valueAsNumber; if (Number.isInteger(n) && n >= 1 && n <= 999) patch({ interval: n }); }} />
                    <select aria-label={l('Unit', '单位')} className={field} disabled={disabled} value={rule.frequency} onChange={e => patch({ frequency: e.target.value as RepeatRule['frequency'] })}>
                        {units.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
                    </select>
                </Line>
                {rule.anchor === 'calendar' && rule.frequency === 'weekly' && <Line label={l('Days', '星期')}>
                    {[1, 2, 3, 4, 5, 6, 7].map(day => { const selected = rule.weekdays?.includes(day) ?? false; return <button key={day} type="button" aria-pressed={selected} disabled={disabled}
                        className={`${chip} min-w-9 px-0 ${selected ? on : off}`} onClick={() => {
                            const next = selected ? (rule.weekdays ?? []).filter(d => d !== day) : [...(rule.weekdays ?? []), day].sort();
                            if (next.length) patch({ weekdays: next });
                        }}>{(zh ? ['一', '二', '三', '四', '五', '六', '日'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'])[day - 1]}</button>; })}
                </Line>}
                {rule.anchor === 'calendar' && rule.frequency === 'monthly' && <Line label={l('Date', '日期')}>
                    <select aria-label={l('Day of month', '每月哪天')} className={field} disabled={disabled} value={String(rule.monthDays?.[0] ?? Number(rule.startDate.slice(8, 10)))}
                        onChange={e => patch({ monthDays: [Number(e.target.value)] })}>
                        {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{zh ? `${i + 1} 日` : i + 1}</option>)}
                        <option value={-1}>{l('Last day', '最后一天')}</option>
                    </select>
                </Line>}
                {reopen && rule.anchor === 'calendar' && <Line label={l('Time', '时刻')} about={l('About time', '关于时刻')} tip={l(`When a new round starts, in ${rule.timeZone}.`, `新一轮开始的时刻，按 ${rule.timeZone} 计算。`)}>
                    <input type="time" aria-label={l('Time', '时刻')} className={field} disabled={disabled} value={rule.time} onChange={e => { if (e.target.value) patch({ time: e.target.value }); }} />
                </Line>}
                {reopen && <Line label={l('Starts', '开始')}>
                    <input type="date" aria-label={l('Starts', '开始')} className={field} disabled={disabled} value={rule.startDate} onChange={e => { if (e.target.value) patch({ startDate: e.target.value }); }} />
                </Line>}
                <Line label={l('Ends', '结束')} about={l('About end date', '关于结束日期')} tip={reopen ? l('Inclusive. After it, the last round stays; no new rounds start.', '包含当天。之后保留最后一轮，不再开始新一轮。') : undefined}>
                    <input type="date" aria-label={l('Ends', '结束')} className={field} disabled={disabled} value={rule.end ?? ''} onChange={e => patch({ end: e.target.value || undefined })} />
                </Line>
                {reopen && <Line label={l('Time zone', '时区')}>
                    <input aria-label={l('Time zone', '时区')} className={`${field} w-48`} disabled={disabled} defaultValue={rule.timeZone} key={rule.timeZone}
                        onBlur={e => { const zone = e.target.value.trim(); if (zone && zone !== rule.timeZone) patch({ timeZone: zone }); }} />
                </Line>}
            </div>}
            {value.kind === 'reopen' && <label className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={value.paused} disabled={disabled} onChange={e => onChange({ ...value, paused: e.target.checked })} />{l('Paused', '暂停')}
            </label>}
        </>}
    </div>;
}
