import { forwardRef, useState } from 'react';
import { dayOf } from '../model/dates';
import { addArea, addProject, addTask } from '../model/doc';
import { parseCapture } from '../model/parse';
import type { ChipKey, PlanEntry, Repeat } from '../model/types';
import { store, useStore } from '../store/store';
import { Popover, toast, usePopover } from './common';
import { DayOptions, EffortPicker, GroupPicker, PlanPicker } from './pickers';
import { duration, dueLabel, planLabel, ruleLabel, useT } from './text';

type Manual = Partial<{
  due: string | null;
  plan: Pick<PlanEntry, 'day' | 'part' | 'start' | 'minutes'> | null;
  effort: number | null;
  star: boolean;
  group: { areaId?: string; projectId?: string };
  repeat: Repeat | null;
}>;

/**
 * One input. Enter saves; nothing is required. Chips under it offer the next useful detail in order
 * (deadline, day, effort, importance), show what was recognised in the text, and clear on a second tap.
 */
export const Capture = forwardRef<HTMLInputElement>(function Capture(_, inputRef) {
  const { doc } = useStore();
  const { t, lang } = useT();
  const [text, setText] = useState('');
  const [manual, setManual] = useState<Manual>({});
  const [note, setNote] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const pop = usePopover<ChipKey>();
  const now = new Date();
  const today = dayOf(now);
  const parsed = parseCapture(text, now);
  const pick = <K extends keyof Manual>(k: K, fallback: Manual[K]) => (k in manual ? manual[k] : fallback);
  const due = pick('due', parsed.due ?? null);
  const plan = pick('plan', parsed.plan ?? null);
  const effort = pick('effort', parsed.effort ?? null);
  const star = pick('star', !!parsed.star);
  const group = manual.group ?? {};
  const repeat = manual.repeat ?? null;

  const save = () => {
    const title = parsed.title || text.trim();
    if (!title) return;
    const before = store.get().doc;
    store.commit((d, ctx) => {
      const p = plan
        ? { ...plan, ...(plan.start && !plan.minutes ? { minutes: Math.min(effort ?? 60, 120) } : {}) }
        : undefined;
      return addTask(d, ctx, {
        title,
        due: due ?? undefined,
        effort: effort ?? undefined,
        star: star || undefined,
        note: note?.trim() ? note : undefined,
        areaId: group.areaId,
        projectId: group.projectId,
        repeat: repeat ?? undefined,
        plan: p ? [p] : [],
      })[0];
    });
    if (store.get().doc !== before) toast(t(`已记下“${title}”`, `Added “${title}”`), () => store.undo());
    setText('');
    setManual({});
    setNote(null);
  };

  const groupName = group.projectId
    ? doc.projects[group.projectId]?.name
    : group.areaId
      ? doc.areas[group.areaId]?.name
      : '';
  const values: Record<ChipKey, string> = {
    due: due ? dueLabel(due, today, lang) : '',
    plan: plan ? planLabel(plan, today, lang) : '',
    effort: effort ? duration(effort, lang) : '',
    star: star ? '★' : '',
    area: groupName ?? '',
    repeat: repeat ? ruleLabel(repeat.rule, lang) : '',
    note: note !== null ? t('正文', 'Note') : '',
  };
  const names: Record<ChipKey, string> = {
    due: t('截止', 'Due'),
    plan: t('哪天做', 'When'),
    effort: t('用时', 'Effort'),
    star: '★',
    area: t('归属', 'Belongs to'),
    repeat: t('重复', 'Repeat'),
    note: t('正文', 'Note'),
  };
  const all: ChipKey[] = ['due', 'plan', 'effort', 'star', 'area', 'repeat', 'note'];
  const front = doc.settings.chips;
  const rest = all.filter((k) => !front.includes(k));
  const nudge = !!due && !effort;
  const recognised = Object.keys(parsed.tokens).length > 0;

  const tap = (k: ChipKey, el: HTMLElement) => {
    if (k === 'star') return setManual((m) => ({ ...m, star: !star }));
    if (k === 'note') return setNote((n) => (n === null ? '' : null));
    if (values[k]) {
      // A second tap clears it.
      return setManual((m) => ({ ...m, [k === 'area' ? 'group' : k]: k === 'area' ? {} : null }));
    }
    pop.toggle(k, el);
  };
  const chip = (k: ChipKey) => (
    <button
      key={k}
      type="button"
      className={`chip${values[k] ? ' set' : ''}${k === 'star' ? ' star' : ''}${k === 'effort' && nudge ? ' nudge' : ''}`}
      aria-pressed={k === 'star' ? star : undefined}
      aria-expanded={k !== 'star' && k !== 'note' ? pop.is(k) : undefined}
      aria-label={
        values[k] && k !== 'star' ? `${names[k]}：${values[k]}，${t('再点一下清除', 'tap again to clear')}` : names[k]
      }
      onClick={(e) => tap(k, e.currentTarget)}
    >
      {values[k] && k !== 'star' ? values[k] : names[k]}
      {values[k] && k !== 'star' && (
        <span className="x" aria-hidden="true">
          ×
        </span>
      )}
    </button>
  );
  const close = pop.close;
  const set = (m: Manual) => (setManual((x) => ({ ...x, ...m })), close());

  return (
    <section className="capture" aria-label={t('记下新任务', 'Add a task')}>
      <input
        ref={inputRef}
        id="capture"
        className="capture-input"
        autoComplete="off"
        enterKeyHint="done"
        value={text}
        aria-label={t('记下新任务', 'Add a task')}
        placeholder={t('记下要做的事，比如“周五交报告 3小时 !”', 'Add a task, e.g. “report due fri 3h !”')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="chips">
        {front.map(chip)}
        {more
          ? rest.map(chip)
          : rest.length > 0 && (
              <button type="button" className="more-btn" onClick={() => setMore(true)}>
                ＋{t('更多', 'More')}
              </button>
            )}
      </div>
      {note !== null && (
        <textarea
          className="capture-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('怎么做、链接……', 'How to do it, links…')}
          aria-label={t('正文', 'Note')}
        />
      )}
      <div className="hint" aria-live="polite">
        {nudge
          ? t(
              '加上用时，系统就能检查截止前时间够不够。',
              'Add the effort so the app can check there is time before the deadline.',
            )
          : recognised
            ? t('已从文字里识别，再点标签可以撤掉。', 'Recognised from the text; tap a chip to undo it.')
            : t('回车保存。标签都可以不填。', 'Enter saves. The chips are optional.')}
      </div>
      {pop.open && (
        <Popover anchor={pop.open.el} onClose={close} label={names[pop.open.key]}>
          {pop.is('due') && <DayOptions today={today} title={names.due} onPick={(d) => set({ due: d })} />}
          {pop.is('plan') && (
            <PlanPicker doc={doc} today={today} effortLeft={effort ?? undefined} onPick={(p) => set({ plan: p })} />
          )}
          {pop.is('effort') && <EffortPicker value={effort ?? undefined} onPick={(m) => set({ effort: m ?? null })} />}
          {pop.is('area') && (
            <GroupPicker
              doc={doc}
              value={group}
              onPick={(g) => set({ group: g })}
              onCreate={(kind, name) => {
                let id = '';
                store.commit((d, ctx) => {
                  const [n, i] = kind === 'area' ? addArea(d, ctx, name) : addProject(d, ctx, name);
                  id = i;
                  return n;
                });
                set({ group: kind === 'area' ? { areaId: id } : { projectId: id } });
              }}
            />
          )}
          {pop.is('repeat') && (
            <div className="menu">
              <div className="menu-title">{names.repeat}</div>
              {(
                [
                  ['daily', t('每天', 'Daily')],
                  ['weekly', t('每周', 'Weekly')],
                  ['monthly', t('每月', 'Monthly')],
                ] as const
              ).map(([f, n]) => (
                <button
                  key={f}
                  className="menu-item"
                  onClick={() =>
                    set({
                      repeat: {
                        mode: 'copy',
                        rule: { freq: f, every: 1, fromDone: false, start: due ?? plan?.day ?? today },
                      },
                    })
                  }
                >
                  <span>{n}</span>
                  <span className="sub">{t('新建一份', 'New copy')}</span>
                </button>
              ))}
              <button
                className="menu-item"
                onClick={() =>
                  set({ repeat: { mode: 'reopen', rule: { freq: 'weekly', every: 1, fromDone: false, start: today } } })
                }
              >
                <span>{t('每周', 'Weekly')}</span>
                <span className="sub">{t('原地重开', 'Reopen')}</span>
              </button>
              <p className="hint pad">{t('更细的设置在任务详情里改。', 'Fine-tune it in the task’s details.')}</p>
            </div>
          )}
        </Popover>
      )}
    </section>
  );
});
