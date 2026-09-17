import { parseRRuleString, buildRRuleString, type Recurrence, type Task, type RecurrenceRule, type RecurrenceByDay } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';

/** The same structured recurrence draft is used by capture and editing. */
export function RepeatPicker({
  value,
  onChange
}: {
  value: Task['recurrence'];
  onChange: (value: Task['recurrence']) => void;
}) {
  const {
    language
  } = useLanguage();
  const zh = language.startsWith('zh');
  const l = (en: string, cn: string) => zh ? cn : en;
  const recurrence: Recurrence | undefined = typeof value === 'string' ? {
    rule: value
  } : value;
  const parsed = recurrence?.rrule ? parseRRuleString(recurrence.rrule) : undefined;
  const interval = parsed?.interval ?? recurrence?.interval ?? 1;
  const byDay = parsed?.byDay ?? recurrence?.byDay;
  const monthDays = parsed?.byMonthDay ?? recurrence?.byMonthDay;
  const count = parsed?.count ?? recurrence?.count;
  const until = parsed?.until ?? recurrence?.until;
  const endMode = count ? 'count' : until ? 'until' : 'never';
  const cls = 'mt-1 min-h-11 w-full rounded-md border border-border bg-background px-3';
  const update = (patch: Partial<Recurrence>) => {
    const next = {
      ...recurrence,
      interval,
      byDay,
      byMonthDay: monthDays,
      count,
      until,
      ...patch
    } as Recurrence;
    onChange({
      ...next,
      rrule: buildRRuleString(next.rule, next.byDay, next.interval, {
        byMonthDay: next.byMonthDay,
        count: next.count,
        until: next.until,
        weekStart: parsed?.weekStart
      })
    });
  };
  const units = {
    daily: l('day(s)', '天'),
    weekly: l('week(s)', '周'),
    monthly: l('month(s)', '个月'),
    yearly: l('year(s)', '年')
  };
  return <div className="space-y-3">
        <label className="block text-sm">{l('Repeat', '重复')}
            <select className={cls} value={recurrence?.rule ?? ''} onChange={event => {
        const rule = event.target.value as RecurrenceRule;
        if (!rule) onChange(undefined);else update({
          rule,
          byDay: undefined,
          byMonthDay: undefined
        });
      }}>
                <option value="">{l('Does not repeat', '不重复')}</option>
                {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((rule, i) => <option key={rule} value={rule}>{[l('Daily', '按天'), l('Weekly', '按周'), l('Monthly', '按月'), l('Yearly', '按年')][i]}</option>)}
            </select>
        </label>
        {recurrence && <>
            <label className="block text-sm">{l('Every (interval)', '每隔多少个单位')}
                <input className={cls} type="number" min={1} max={999} step={1} value={interval} onChange={event => {
          const n = event.target.valueAsNumber;
          if (Number.isInteger(n) && n >= 1 && n <= 999) update({
            interval: n
          });
        }} />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={recurrence.strategy === 'fluid'} onChange={event => update({
          strategy: event.target.checked ? 'fluid' : 'strict'
        })} />{l('Count from completion', '从本次完成后计时')}</label>
            {recurrence.rule === 'weekly' && recurrence.strategy !== 'fluid' && <div className="flex flex-wrap gap-1" aria-label={l('Weekdays', '星期')}>
                {(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as RecurrenceByDay[]).map((day, i) => {
          const selected = byDay?.includes(day) ?? false;
          return <button type="button" key={day} aria-pressed={selected} className={`min-h-11 min-w-11 rounded border ${selected ? 'border-primary bg-primary/10' : 'border-border'}`} onClick={() => update({
            byDay: selected ? byDay?.filter(d => d !== day) : [...(byDay ?? []), day]
          })}>{(zh ? ['一', '二', '三', '四', '五', '六', '日'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'])[i]}</button>;
        })}
            </div>}
            {recurrence.rule === 'monthly' && recurrence.strategy !== 'fluid' && <label className="block text-sm">{l('Monthly date', '每月哪天')}
                <select className={cls} value={monthDays?.length === 1 ? String(monthDays[0]) : byDay?.length || monthDays?.length ? 'custom' : ''} onChange={event => update({
          byDay: undefined,
          byMonthDay: event.target.value ? [Number(event.target.value)] : undefined
        })}>
                    <option value="">{l('Same day as the initial occurrence', '与初次任务同一天')}</option><option value="-1">{l('Last day of each month', '每月最后一天')}</option>
                    {Array.from({
            length: 31
          }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                    {byDay?.length || (monthDays?.length ?? 0) > 1 ? <option value="custom" disabled>{l('Existing custom pattern (preserved)', '原有自定义规则（保留）')}</option> : null}
                </select>
            </label>}
            <label className="block text-sm">{l('Stop repeating', '何时停止重复')}
                <select className={cls} value={endMode} onChange={event => update({
          count: event.target.value === 'count' ? 10 : undefined,
          until: event.target.value === 'until' ? new Date().toISOString().slice(0, 10) : undefined
        })}>
                    <option value="never">{l('No end date', '不设结束')}</option><option value="count">{l('After a number of occurrences', '达到指定次数')}</option><option value="until">{l('On a date', '到指定日期')}</option>
                </select>
            </label>
            {endMode === 'count' && <label className="block text-sm">{l('Total occurrences in this series', '整个系列的总次数')}<input className={cls} type="number" min={1} max={9999} value={count} onChange={event => {
          const n = event.target.valueAsNumber;
          if (Number.isInteger(n) && n > 0 && n <= 9999) update({
            count: n
          });
        }} /></label>}
            {endMode === 'until' && <label className="block text-sm">{l('Last repeat date', '最后重复日期')}<input className={cls} type="date" value={until?.slice(0, 10) ?? ''} onChange={event => update({
          until: event.target.value || undefined
        })} /></label>}
            <p className="text-xs text-muted-foreground">{l(`Every ${interval} ${units[recurrence.rule]}${recurrence.strategy === 'fluid' ? ' after completion' : ''}. This rule applies to this occurrence and future successors, not the individual work blocks.`, `每隔 ${interval} ${units[recurrence.rule]}重复${recurrence.strategy === 'fluid' ? '，从完成后计算' : ''}。用于本次及以后各次，不会重复复制本次的工作时段。`)}</p>
        </>}
    </div>;
}
