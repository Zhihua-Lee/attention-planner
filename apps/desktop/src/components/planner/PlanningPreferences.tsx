import { useState } from 'react';
import { flushPendingSave, useTaskStore, validPlanningWindows, type PlanningWindow, type AttentionFrame } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
export function PlanningPreferences() {
  const {
      language
    } = useLanguage(),
    zh = language.startsWith('zh'),
    l = (a: string, b: string) => zh ? b : a;
  const gtd = useTaskStore(s => s.settings.gtd),
    areas = useTaskStore(s => s.areas),
    projects = useTaskStore(s => s.projects);
  const [windows, setWindows] = useState<PlanningWindow[]>(() => gtd?.planningWindows ?? []);
  const [frames, setFrames] = useState<AttentionFrame[]>(() => gtd?.attentionFrames ?? []);
  const [message, setMessage] = useState('');
  const button = 'min-h-11 rounded border border-border px-3 text-sm hover:bg-muted';
  const input = 'min-h-11 rounded border border-border bg-background px-2 text-sm';
  const days = (selected: number[], onChange: (n: number[]) => void) => <div className="flex flex-wrap gap-1">{[0, 1, 2, 3, 4, 5, 6].map(d => <button type="button" key={d} className={`${button} ${selected.includes(d) ? 'bg-primary/15 border-primary' : ''}`} aria-pressed={selected.includes(d)} onClick={() => onChange(selected.includes(d) ? selected.filter(x => x !== d) : [...selected, d])}>{(zh ? ['日', '一', '二', '三', '四', '五', '六'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])[d]}</button>)}</div>;
  return <details className="rounded-lg border border-border bg-card p-3"><summary className="min-h-11 cursor-pointer content-center text-sm font-medium">{l('Rescheduling hours and attention preferences', '自动顺延时段与注意力偏好')}</summary>
        <div className="space-y-4 pt-3"><p className="text-sm text-muted-foreground">{l('Nothing is automatically placed until you save allowed hours. Meetings and existing reservations are protected. Closed PWA apps catch up when reopened.', '保存允许时段后才会自动安排；会议和已有预留不会被挤走。PWA关闭期间不运行，重新打开后补算。')}</p>
        {windows.map((w, i) => <fieldset key={i} className="space-y-2 rounded border border-border p-3"><legend className="text-xs">{l('Allowed hours', '允许安排的时段')} {i + 1}</legend>{days(w.days, v => setWindows(ws => ws.map((x, j) => j === i ? {
          ...x,
          days: v
        } : x)))}<div className="flex flex-wrap gap-2"><input aria-label={l('Allowed start', '允许开始')} type="time" className={input} value={w.start} onChange={e => setWindows(ws => ws.map((x, j) => j === i ? {
            ...x,
            start: e.target.value
          } : x))} /><span>–</span><input aria-label={l('Allowed end', '允许结束')} type="time" className={input} value={w.end} onChange={e => setWindows(ws => ws.map((x, j) => j === i ? {
            ...x,
            end: e.target.value
          } : x))} /><button className={button} onClick={() => setWindows(ws => ws.filter((_, j) => j !== i))}>{l('Remove', '移除')}</button></div></fieldset>)}
        <button className={button} onClick={() => setWindows(ws => [...ws, {
        days: [1, 2, 3, 4, 5],
        start: '09:00',
        end: '18:00'
      }])}>{l('Add allowed hours (review before saving)', '添加允许时段（确认后保存）')}</button>
        <p className="text-sm">{l('Optional: prefer a domain or project during a time window. This never blocks other planning.', '可选：某段时间优先推荐某个领域或项目；不会限制其他规划。')}</p>
        {frames.map((f, i) => <fieldset key={f.id} className="space-y-2 rounded border border-border p-3"><input aria-label={l('Frame name', '偏好名称')} className={`${input} w-full`} value={f.name} onChange={e => setFrames(fs => fs.map((x, j) => j === i ? {
          ...x,
          name: e.target.value
        } : x))} />{days(f.days, v => setFrames(fs => fs.map((x, j) => j === i ? {
          ...x,
          days: v as AttentionFrame['days']
        } : x)))}<div className="flex flex-wrap gap-2"><input aria-label={l('Preference start', '偏好开始')} type="time" className={input} value={f.startTime} onChange={e => setFrames(fs => fs.map((x, j) => j === i ? {
            ...x,
            startTime: e.target.value
          } : x))} /><input aria-label={l('Preference end', '偏好结束')} type="time" className={input} value={f.endTime} onChange={e => setFrames(fs => fs.map((x, j) => j === i ? {
            ...x,
            endTime: e.target.value
          } : x))} /><select aria-label={l('Prefer tasks from', '优先选择')} className={input} value={f.projectIds?.[0] ? `p:${f.projectIds[0]}` : f.areaIds?.[0] ? `a:${f.areaIds[0]}` : ''} onChange={e => {
            const [k, id] = e.target.value.split(':');
            setFrames(fs => fs.map((x, j) => j === i ? {
              ...x,
              areaIds: k === 'a' ? [id] : [],
              projectIds: k === 'p' ? [id] : [],
              matchTokens: []
            } : x));
          }}><option value="">{l('Any task', '不限任务')}</option>{areas.map(a => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}{projects.map(p => <option key={p.id} value={`p:${p.id}`}>{p.title}</option>)}</select><button className={button} onClick={() => setFrames(fs => fs.filter((_, j) => j !== i))}>{l('Remove preference', '移除偏好')}</button></div></fieldset>)}
        <button className={button} onClick={() => setFrames(fs => [...fs, {
        id: crypto.randomUUID(),
        name: l('Research', '研究'),
        startTime: '09:00',
        endTime: '12:00',
        days: [1, 2, 3, 4, 5]
      }])}>{l('Add preference', '添加偏好')}</button>
        <div><button className={`${button} bg-primary text-primary-foreground`} onClick={async () => {
          if (!validPlanningWindows(windows) || frames.some(f => !f.name.trim() || !f.days.length || f.startTime === f.endTime)) {
            setMessage(l('Check the days and times first.', '请检查日期选择和时间范围。'));
            return;
          }
          try {
            const state = useTaskStore.getState();
            await state.updateSettings({
              gtd: {
                ...state.settings.gtd,
                planningWindows: windows,
                attentionFrames: frames
              }
            });
            await flushPendingSave();
            setMessage(l('Preferences saved.', '偏好已保存。'));
          } catch (e) {
            setMessage(String(e));
          }
        }}>{l('Save preferences', '保存偏好')}</button></div>{message && <p role="status" className="text-sm">{message}</p>}
        </div></details>;
}
