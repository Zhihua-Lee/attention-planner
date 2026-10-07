import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDays, dayOf } from '../model/dates';
import { addArea, addProject, removeGroup, renameGroup, setSettings, updateProject } from '../model/doc';
import { parseIcs } from '../model/ics';
import { importLegacy } from '../model/legacyImport';
import { FILTER_CHIPS, type ChipKey } from '../model/types';
import { brokerStatus, trimSlash } from '../store/drive';
import { disablePush, enablePush, pushState, testPush, type PushState } from '../store/push';
import { reminderPrefs } from '../model/reminders';
import { store, useStore } from '../store/store';
import { Info, toast } from './common';
import { DEFAULT_STEP_TOOLS } from './StepList';
import { useT, weekdayShort } from './text';

const ALL_CHIPS: ChipKey[] = ['due', 'plan', 'effort', 'star', 'area', 'repeat', 'note'];

/** The settings, in groups: id, Chinese title, English title. */
const SETTINGS_GROUPS: [string, string, string][] = [
  ['general', '常用', 'General'],
  ['capture', '记录与清单', 'Capture and list'],
  ['reminders', '提醒', 'Reminders'],
  ['calendar', '日历', 'Calendar'],
  ['sync', '同步与数据', 'Sync and data'],
  ['ai', 'AI 连接', 'AI connections'],
];

export function Settings({ onClose }: { onClose: () => void }) {
  const { doc, sync, calendar, subs } = useStore();
  const fileEvents = (doc.events ?? []).filter((e) => e.source === 'file').length;
  const { t } = useT();
  const s = doc.settings;
  const panel = useRef<HTMLDivElement>(null);
  const [broker, setBroker] = useState(() => localStorage.getItem('ap:broker') ?? '/api');
  const [checking, setChecking] = useState(false);
  // The personal capture link is shown on the device that made it (the server keeps only a hash of it).
  const [captureUrl, setCaptureUrl] = useState<string | null>(() => {
    try {
      return localStorage.getItem('ap:capture-link');
    } catch {
      return null;
    }
  });
  const makeCaptureLink = async (off: boolean) => {
    try {
      const res = await fetch('/api/ai/capture-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ off }),
      });
      const body = (await res.json()) as { url?: string | null; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setCaptureUrl(body.url ?? null);
      if (body.url) localStorage.setItem('ap:capture-link', body.url);
      else localStorage.removeItem('ap:capture-link');
    } catch (e) {
      toast(t('没能生成：', 'Could not make it: ') + (e instanceof Error ? e.message : String(e)));
    }
  };
  // A time the way the reader says it: 10/6 15:30.
  const when = (iso: string) =>
    new Date(iso).toLocaleString(s.lang === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });
  const copy = (text: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => toast(t('已复制', 'Copied')),
      () => toast(text),
    );
  const [subName, setSubName] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [push, setPush] = useState<PushState | 'busy'>('off');
  useEffect(() => {
    void pushState().then(setPush);
  }, []);
  const [newGroup, setNewGroup] = useState('');
  // The Drive file for the Outlook export is made when its setup steps are opened, not before.
  const [outlookFile, setOutlookFile] = useState<'busy' | 'no-sync' | 'ready' | 'created' | { error: string } | null>(
    null,
  );
  const prepareOutlook = async () => {
    if (sync.status === 'off') return setOutlookFile('no-sync');
    setOutlookFile('busy');
    try {
      const r = await store.prepareOutlook();
      setOutlookFile(!r ? 'no-sync' : r.created ? 'created' : 'ready');
    } catch (e) {
      setOutlookFile({ error: e instanceof Error ? e.message : String(e) });
    }
  };
  useEffect(() => {
    panel.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const set = (patch: Parameters<typeof setSettings>[2]) => store.commit((d, c) => setSettings(d, c, patch));
  const chipName: Record<ChipKey, string> = {
    due: t('截止', 'Due'),
    plan: t('哪天做', 'When'),
    effort: t('用时', 'Effort'),
    star: '★ ' + t('重要', 'Important'),
    area: t('归属', 'Belongs to'),
    repeat: t('重复', 'Repeat'),
    note: t('正文', 'Note'),
  };
  const front = s.chips;
  const back = ALL_CHIPS.filter((k) => !front.includes(k));
  const moveChip = (k: ChipKey, dir: -1 | 1) => {
    const i = front.indexOf(k);
    const j = i + dir;
    if (j < 0 || j >= front.length) return;
    const next = front.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set({ chips: next });
  };
  const readFile = (accept: string, fn: (text: string) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) fn(await file.text());
    };
    input.click();
  };
  const pane = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<string>(SETTINGS_GROUPS[0][0]);
  const go = (id: string) => {
    const el = pane.current?.querySelector<HTMLElement>(`[data-group="${id}"]`);
    if (!el || !pane.current) return;
    // The chosen group stays marked while the pane scrolls to it (a short last group may never reach the top).
    chosen.current = Date.now();
    pane.current.scrollTo({
      top: el.offsetTop - 4,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    setCurrent(id);
  };
  const chosen = useRef(0);
  // The group marked in the navigation follows the scrolling: the last one whose title has reached the top.
  const spy = () => {
    const el = pane.current;
    if (!el || Date.now() - chosen.current < 800) return;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    let id = SETTINGS_GROUPS[0][0];
    for (const g of el.querySelectorAll<HTMLElement>('[data-group]'))
      if (g.offsetTop - el.scrollTop <= 48) id = g.dataset.group!;
    setCurrent(atEnd ? SETTINGS_GROUPS[SETTINGS_GROUPS.length - 1][0] : id);
  };
  const groups = [
    ...Object.values(doc.areas).map((g) => ({ kind: 'areas' as const, g })),
    ...Object.values(doc.projects).map((g) => ({ kind: 'projects' as const, g })),
  ].filter((x) => !x.g.deleted);

  return createPortal(
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="sheet settings"
        role="dialog"
        aria-modal="true"
        aria-label={t('设置', 'Settings')}
        tabIndex={-1}
        ref={panel}
      >
        <header className="sheet-head">
          <h2>{t('设置', 'Settings')}</h2>
          <button className="btn" onClick={onClose}>
            {t('完成', 'Done')}
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" aria-label={t('设置分组', 'Settings sections')}>
            {SETTINGS_GROUPS.map(([id, zh, en]) => (
              <button key={id} aria-current={current === id} onClick={() => go(id)}>
                {t(zh, en)}
              </button>
            ))}
          </nav>
          <div className="settings-pane" ref={pane} onScroll={spy}>
            <div className="settings-group" id="settings-general" data-group="general">
              <h2 className="group-title">{t('常用', 'General')}</h2>
              <section>
                <div className="sec-title">
                  <h3>{t('目标', 'Goal')}</h3>
                  <Info label={t('目标是什么', 'What the goal is for')}>
                    <p>
                      {t(
                        '写下你最长远的方向，比如这几年最想做成的事、想成为什么样的人。',
                        'Write down where you are heading in the long run: what you most want to get done in the next few years, or who you want to become.',
                      )}
                    </p>
                    <p>
                      {t(
                        'AI 帮你排计划、拆任务时会参考它。它只是方向：不打分、不统计进度，也不会催你。',
                        'An AI keeps it in mind when it plans or breaks tasks down for you. It is only a direction: nothing is scored, counted or chased.',
                      )}
                    </p>
                  </Info>
                </div>
                <textarea
                  className="goal-input"
                  rows={3}
                  defaultValue={s.goal ?? ''}
                  aria-label={t('目标', 'Goal')}
                  placeholder={t(
                    '比如：做出能被用起来的科研；身体健康地读完博士',
                    'e.g. Research that gets used; finish the PhD in good health',
                  )}
                  onBlur={(e) => {
                    const goal = e.target.value.trim() ? e.target.value : undefined;
                    if (goal !== s.goal) set({ goal });
                  }}
                />
                <label className="check-row">
                  <input type="checkbox" checked={!!s.showGoal} onChange={(e) => set({ showGoal: e.target.checked })} />
                  {t('在 NOW 顶部显示', 'Show at the top of NOW')}
                </label>
              </section>
              <section>
                <h3>{t('外观与语言', 'Look and language')}</h3>
                <div className="seg" role="radiogroup" aria-label={t('主题', 'Theme')}>
                  {(['system', 'light', 'dark'] as const).map((k) => (
                    <button key={k} role="radio" aria-checked={s.theme === k} onClick={() => set({ theme: k })}>
                      {{ system: t('跟随系统', 'System'), light: t('浅色', 'Light'), dark: t('深色', 'Dark') }[k]}
                    </button>
                  ))}
                </div>
                <div className="seg" role="radiogroup" aria-label={t('语言', 'Language')}>
                  <button role="radio" aria-checked={s.lang === 'zh'} onClick={() => set({ lang: 'zh' })}>
                    中文
                  </button>
                  <button role="radio" aria-checked={s.lang === 'en'} onClick={() => set({ lang: 'en' })}>
                    English
                  </button>
                </div>
              </section>
              <section>
                <div className="sec-title">
                  <h3>{t('可用于做事的时间', 'Working time')}</h3>
                  <Info label={t('这段时间用来做什么', 'What working time is for')}>
                    <p>{t('你一般在哪几天、几点到几点做事。', 'The days and hours you usually work.')}</p>
                    <p>
                      {t(
                        '找空闲时间（“找时间”、日历空白处的推荐）只在这段时间里找；判断“截止前时间还够不够”也只算这段时间。',
                        'Free time is only looked for inside it (Find time, suggestions in an empty slot), and only these hours count when the app checks whether a deadline still fits.',
                      )}
                    </p>
                  </Info>
                </div>
                <div className="inline">
                  <input
                    type="time"
                    value={s.workStart}
                    aria-label={t('开始', 'From')}
                    onChange={(e) => e.target.value && set({ workStart: e.target.value })}
                  />
                  –
                  <input
                    type="time"
                    value={s.workEnd}
                    aria-label={t('结束', 'To')}
                    onChange={(e) => e.target.value && set({ workEnd: e.target.value })}
                  />
                </div>
                <div className="weekdays" role="group" aria-label={t('哪几天', 'Days')}>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <button
                      key={d}
                      aria-pressed={s.workDays.includes(d)}
                      onClick={() =>
                        set({
                          workDays: s.workDays.includes(d)
                            ? s.workDays.filter((x) => x !== d)
                            : [...s.workDays, d].sort(),
                        })
                      }
                    >
                      {weekdayShort(d, s.lang)}
                    </button>
                  ))}
                </div>
              </section>
            </div>
            <div className="settings-group" id="settings-capture" data-group="capture">
              <h2 className="group-title">{t('记录与清单', 'Capture and list')}</h2>
              <section>
                <div className="sec-title">
                  <h3>{t('记录时的标签', 'Capture chips')}</h3>
                  <Info label={t('记录时的标签是什么', 'What capture chips are')}>
                    <p>
                      {t(
                        '输入框下面那排小按钮，比如截止、哪天做、用时，点一下就能给新任务设上。',
                        'The small buttons under the capture box, such as Due, When and Effort: a tap sets that for the new task.',
                      )}
                    </p>
                    <p>
                      {t(
                        '这里排在前面的直接显示，按这个顺序；其余的收在“更多”里。',
                        'The ones listed first here show directly, in this order; the rest sit under “More”.',
                      )}
                    </p>
                  </Info>
                </div>
                <ul className="chip-order">
                  {front.map((k, i) => (
                    <li key={k}>
                      <span>{chipName[k]}</span>
                      <button
                        className="mini"
                        disabled={i === 0}
                        aria-label={`${t('上移', 'Move up')}: ${chipName[k]}`}
                        onClick={() => moveChip(k, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="mini"
                        disabled={i === front.length - 1}
                        aria-label={`${t('下移', 'Move down')}: ${chipName[k]}`}
                        onClick={() => moveChip(k, 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="mini"
                        disabled={front.length === 1}
                        aria-label={`${t('收进更多', 'Move to More')}: ${chipName[k]}`}
                        onClick={() => set({ chips: front.filter((x) => x !== k) })}
                      >
                        −
                      </button>
                    </li>
                  ))}
                  {back.map((k) => (
                    <li key={k} className="muted">
                      <span>{chipName[k]}</span>
                      <button
                        className="mini"
                        aria-label={`${t('放到前排', 'Show up front')}: ${chipName[k]}`}
                        onClick={() => set({ chips: [...front, k] })}
                      >
                        +
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <div className="sec-title">
                  <h3>{t('快捷记录', 'Quick capture')}</h3>
                  <Info label={t('快捷记录怎么用', 'How quick capture works')}>
                    <p>
                      {t(
                        '不打开应用也能记下一件事，写法和输入框一样，比如“周五交报告 2小时”。三种方式：',
                        'Write something down without opening the app, the same way as in the capture box, e.g. “report due fri 2h”. Three ways:',
                      )}
                    </p>
                    <ul>
                      <li>
                        {t(
                          '网址：复制下面的网址，在末尾接上要记的话，比如 …/?add=周五交报告，可以存成书签。',
                          'An address: copy the one below and add the words at its end, e.g. …/?add=report due fri; it can be a bookmark.',
                        )}
                      </li>
                      <li>
                        {t(
                          '安卓：在任何应用里点“分享”，选 Attention Planner。',
                          'Android: in any app, tap Share and choose Attention Planner.',
                        )}
                      </li>
                      <li>
                        {t(
                          'iPhone：生成专属链接，配合快捷指令或 Siri 用。这个链接只能新增任务，看不到你的清单；换新链接或停用后，旧的马上失效。',
                          'iPhone: make a personal link and use it with Shortcuts or Siri. It can only add tasks and cannot see your list; a new link, or turning it off, ends the old one at once.',
                        )}
                      </li>
                    </ul>
                  </Info>
                </div>
                <div className="inline">
                  <input
                    className="grow"
                    readOnly
                    value={`${location.origin}/?add=`}
                    aria-label={t('记下一句的网址', 'Address that adds a line')}
                  />
                  <button className="btn" onClick={() => copy(`${location.origin}/?add=`)}>
                    {t('复制', 'Copy')}
                  </button>
                </div>
                {captureUrl ? (
                  <>
                    <div className="inline">
                      <input
                        className="grow"
                        readOnly
                        value={captureUrl}
                        aria-label={t('专属记录链接', 'Personal capture link')}
                      />
                      <button className="btn" onClick={() => copy(captureUrl)}>
                        {t('复制', 'Copy')}
                      </button>
                      <button className="btn" onClick={() => void makeCaptureLink(true)}>
                        {t('停用', 'Turn off')}
                      </button>
                    </div>
                    <details className="howto">
                      <summary>{t('iPhone 快捷指令 / Siri 怎么设', 'Set it up in iPhone Shortcuts / Siri')}</summary>
                      <ol>
                        <li>{t('快捷指令 App → 右上角 +。', 'Shortcuts app → + at the top right.')}</li>
                        <li>
                          {t(
                            '搜“要求输入”并添加，类型保持“文本”（不是 URL）。',
                            'Search “Ask for Input” and add it; keep the type “Text” (not URL).',
                          )}
                        </li>
                        <li>
                          {t(
                            '搜“URL内容”，添加“获取 URL 内容”，网址粘贴上面的专属链接。',
                            'Search “Contents of URL”, add “Get Contents of URL”, paste the link above.',
                          )}
                        </li>
                        <li>
                          {t(
                            '点它的 › 展开：方法 POST；请求体“表单”；添加新字段 → 文本，键 text，值选“提供的输入”。',
                            'Tap its › : Method POST; Request Body “Form”; Add new field → Text, key text, value “Provided Input”.',
                          )}
                        </li>
                        <li>{t('命名为“记一下”，对 Siri 说即可。', 'Name it “Note it” and say it to Siri.')}</li>
                        <li>
                          {t(
                            '链接只能新增任务；换新链接或停用后旧的立即失效。',
                            'The link can only add tasks; a new link, or turning it off, ends the old one.',
                          )}
                        </li>
                      </ol>
                    </details>
                  </>
                ) : (
                  <button className="btn" onClick={() => void makeCaptureLink(false)}>
                    {t('生成专属链接（给快捷指令、Siri 用）', 'Make a personal link (for Shortcuts and Siri)')}
                  </button>
                )}
              </section>
              <section>
                <div className="sec-title">
                  <h3>{t('步骤后面的按钮', 'Buttons after each step')}</h3>
                  <Info label={t('步骤后面的按钮是什么', 'What the step buttons are')}>
                    <p>
                      {t(
                        '任务里每个步骤后面的小按钮：今天做这一步（整个任务也进入今天，NOW 先给这一步）、给步骤设截止、用时（里面可以给这一步找时间预留）、重复，或者把步骤变成单独的任务。',
                        'The small buttons after each step of a task: do this step today (the task comes into today and NOW offers this step first), give the step a deadline, an estimate (where you can also find time for it) or a repeat, or turn it into a task of its own.',
                      )}
                    </p>
                    <p>
                      {t(
                        '只显示勾上的；电脑上鼠标移到步骤上才出现。拖动排序和删除一直都有；已经设好的今天、截止、用时、重复，不勾也会以小标签显示在步骤后面。',
                        'Only the ticked ones show, and on a computer only while the pointer is over the step. Dragging and deleting are always there, and today, a deadline, estimate or repeat already set shows as a small tag even when its button is off.',
                      )}
                    </p>
                  </Info>
                </div>
                <div className="checks">
                  {(
                    [
                      ['today', t('今日', 'Today')],
                      ['due', t('截止', 'Deadline')],
                      ['effort', t('用时与找时间', 'Effort and Find time')],
                      ['repeat', t('重复', 'Repeat')],
                      ['promote', t('独立成任务', 'Make it a task')],
                    ] as const
                  ).map(([k, n]) => {
                    const tools = s.stepTools ?? DEFAULT_STEP_TOOLS;
                    return (
                      <label key={k} className="check-row">
                        <input
                          type="checkbox"
                          checked={tools.includes(k)}
                          onChange={(e) =>
                            set({ stepTools: e.target.checked ? [...tools, k] : tools.filter((x) => x !== k) })
                          }
                        />
                        {n}
                      </label>
                    );
                  })}
                </div>
              </section>
              <section>
                <div className="sec-title">
                  <h3>{t('清单筛选', 'List filters')}</h3>
                  <Info label={t('清单筛选是什么', 'What list filters are')}>
                    <p>
                      {t(
                        '清单上方那排筛选按钮，勾上的才显示。“全部”一直都在；某个筛选里暂时没有任务时，它会自动隐藏。',
                        'The row of filters above the list; only the ticked ones show. “All” is always there, and a filter with nothing in it hides itself for now.',
                      )}
                    </p>
                  </Info>
                </div>
                <div className="checks">
                  {(
                    [
                      ['today', t('今天', 'Today')],
                      ['soon', t('7 天内截止', 'Due this week')],
                      ['due', t('有截止', 'With a deadline')],
                      ['star', t('重要', 'Important')],
                      ['new', t('新加的', 'New')],
                      ['unplanned', t('未安排', 'Unplanned')],
                      ['snoozed', t('暂缓', 'Snoozed')],
                      ['areas', t('各区域', 'Each area')],
                      ['projects', t('各项目', 'Each project')],
                    ] as const
                  ).map(([k, n]) => {
                    const on = s.filters ?? FILTER_CHIPS;
                    return (
                      <label key={k} className="check-row">
                        <input
                          type="checkbox"
                          checked={on.includes(k)}
                          onChange={(e) =>
                            set({
                              filters: e.target.checked
                                ? FILTER_CHIPS.filter((x) => x === k || on.includes(x))
                                : on.filter((x) => x !== k),
                            })
                          }
                        />
                        {n}
                      </label>
                    );
                  })}
                </div>
              </section>
              <section>
                <div className="sec-title">
                  <h3>{t('区域与项目', 'Areas and projects')}</h3>
                  <Info label={t('区域和项目有什么不同', 'Areas and projects')}>
                    <ul>
                      <li>
                        {t(
                          '区域：生活或工作里长期存在的一块，没有终点，比如“科研”“教学”“家务”。',
                          'An area is a lasting part of life or work with no end, such as Research, Teaching or Home.',
                        )}
                      </li>
                      <li>
                        {t(
                          '项目：有终点的一件大事，做完就结束，比如“投一篇论文”。',
                          'A project is a larger piece of work that ends when it is done, such as submitting a paper.',
                        )}
                      </li>
                    </ul>
                    <p>
                      {t(
                        '勾上“按顺序”，这个项目一次只推荐最前面那件没做完的任务，后面的先排队（重复的任务不排队）。删除区域或项目不会删掉里面的任务。',
                        'With “In order”, a project offers only its earliest unfinished task and the rest wait their turn (repeating tasks never wait). Deleting an area or a project keeps its tasks.',
                      )}
                    </p>
                  </Info>
                </div>
                <ul className="groups">
                  {groups.map(({ kind, g }) => (
                    <li key={g.id}>
                      <span className="muted">{kind === 'areas' ? t('区域', 'Area') : t('项目', 'Project')}</span>
                      <input
                        defaultValue={g.name}
                        aria-label={t('名称', 'Name')}
                        onBlur={(e) =>
                          e.target.value.trim() &&
                          e.target.value !== g.name &&
                          store.commit((d, c) => renameGroup(d, c, kind, g.id, e.target.value))
                        }
                      />
                      {kind === 'projects' && (
                        <label className="check-row small">
                          <input
                            type="checkbox"
                            checked={!!(g as { sequential?: boolean }).sequential}
                            onChange={(e) =>
                              store.commit((d, c) => updateProject(d, c, g.id, { sequential: e.target.checked }))
                            }
                          />
                          {t('按顺序', 'In order')}
                        </label>
                      )}
                      <button
                        className="mini"
                        aria-label={`${t('删除', 'Delete')}: ${g.name}`}
                        onClick={() => store.commit((d, c) => removeGroup(d, c, kind, g.id))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="inline">
                  <input
                    value={newGroup}
                    onChange={(e) => setNewGroup(e.target.value)}
                    placeholder={t('新的区域或项目', 'New area or project')}
                    aria-label={t('新的区域或项目', 'New area or project')}
                  />
                  <button
                    className="btn"
                    disabled={!newGroup.trim()}
                    onClick={() => (store.commit((d, c) => addArea(d, c, newGroup)[0]), setNewGroup(''))}
                  >
                    {t('加区域', 'Add area')}
                  </button>
                  <button
                    className="btn"
                    disabled={!newGroup.trim()}
                    onClick={() => (store.commit((d, c) => addProject(d, c, newGroup)[0]), setNewGroup(''))}
                  >
                    {t('加项目', 'Add project')}
                  </button>
                </div>
              </section>
            </div>
            <div className="settings-group" id="settings-reminders" data-group="reminders">
              <h2 className="group-title">{t('提醒', 'Reminders')}</h2>
              <section>
                <div className="sec-title">
                  <h3>{t('这台设备的通知', 'Notifications on this device')}</h3>
                  <Info label={t('提醒怎么工作', 'How reminders work')}>
                    <p>
                      {t(
                        '到了截止当天、预留时段开始前，这台设备会弹通知，应用关着也能收到。截止设了具体时刻的，提前 1 小时提醒。AI 有新提议时也会通知。',
                        'This device shows a notification on a deadline’s day and before a reserved time, even with the app closed. A deadline with a time is reminded an hour before. A new AI proposal is announced too.',
                      )}
                    </p>
                    <ul>
                      <li>{t('要先连接同步（登录 Google）。', 'Connect sync (sign in to Google) first.')}</li>
                      <li>{t('每台设备分别开启。', 'Turn it on on each device.')}</li>
                      <li>
                        {t(
                          'iPhone 要先把应用添加到主屏幕（iOS 16.4 及以上），再从主屏幕打开。',
                          'On iPhone, add the app to the Home Screen first (iOS 16.4 or later) and open it from there.',
                        )}
                      </li>
                    </ul>
                  </Info>
                </div>
                <div className="inline">
                  {push === 'on' ? (
                    <>
                      <span>{t('已开启', 'On')}</span>
                      <button
                        className="btn"
                        onClick={() =>
                          void testPush().then(
                            () => toast(t('测试通知已发送', 'Test sent')),
                            (e) => toast(String(e.message ?? e)),
                          )
                        }
                      >
                        {t('发送测试通知', 'Send a test')}
                      </button>
                      <button className="btn" onClick={() => void disablePush().then(() => setPush('off'))}>
                        {t('关闭', 'Turn off')}
                      </button>
                    </>
                  ) : push === 'unsupported' ? (
                    <span className="muted">
                      {t('这个浏览器不支持推送通知。', 'This browser cannot show push notifications.')}
                    </span>
                  ) : push === 'denied' ? (
                    <span className="muted">
                      {t(
                        '通知被浏览器禁止了，需要在浏览器或系统设置里允许。',
                        'Notifications are blocked; allow them in the browser or system settings.',
                      )}
                    </span>
                  ) : (
                    <button
                      className="btn primary"
                      disabled={push === 'busy'}
                      onClick={async () => {
                        setPush('busy');
                        try {
                          setPush(await enablePush(store.get().doc));
                        } catch (e) {
                          setPush('off');
                          toast(
                            e instanceof Error && e.message === 'signed-out'
                              ? t(
                                  '请先在下面连接同步（登录 Google）。',
                                  'Connect sync below first (sign in to Google).',
                                )
                              : t('没能开启提醒：', 'Could not turn on reminders: ') +
                                  (e instanceof Error ? e.message : String(e)),
                          );
                        }
                      }}
                    >
                      {t('开启提醒', 'Turn on reminders')}
                    </button>
                  )}
                </div>
                <div className="inline">
                  <label className="inline">
                    {t('截止当天', 'On a deadline’s day at')}
                    <input
                      type="time"
                      value={reminderPrefs(s).dueAt}
                      aria-label={t('截止当天提醒时间', 'Deadline reminder time')}
                      onChange={(e) => e.target.value && set({ remind: { ...s.remind, dueAt: e.target.value } })}
                    />
                  </label>
                  <label className="inline">
                    {t('预留时段提前', 'Before reserved times')}
                    <select
                      value={reminderPrefs(s).slotLead}
                      aria-label={t('预留时段提前几分钟', 'Minutes before reserved times')}
                      onChange={(e) => set({ remind: { ...s.remind, slotLead: Number(e.target.value) } })}
                    >
                      {[0, 5, 10, 15, 30].map((m) => (
                        <option key={m} value={m}>
                          {m ? t(`${m} 分钟`, `${m} min`) : t('准时', 'on time')}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
            </div>
            <div className="settings-group" id="settings-calendar" data-group="calendar">
              <h2 className="group-title">{t('日历', 'Calendar')}</h2>
              <section>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={s.slotSuggestions !== false}
                    onChange={(e) => set({ slotSuggestions: e.target.checked })}
                  />
                  {t('点空白时间时推荐任务', 'Suggest tasks for a tapped free time')}
                </label>
              </section>
              <section>
                <div className="sec-title">
                  <h3>{t('Outlook 日历', 'Outlook calendar')}</h3>
                  <Info label={t('Outlook 日历怎么来的', 'Where the Outlook calendar comes from')}>
                    <p>
                      {t(
                        'Outlook 里的日程由 Power Automate 定时导出到你的 Google Drive（一个叫 outlook-calendar.json 的文件），连上同步后应用会自动读取，最多 10 分钟更新一次。',
                        'A Power Automate flow copies your Outlook events into your Google Drive (a file called outlook-calendar.json); once sync is connected the app reads it, at most every 10 minutes.',
                      )}
                    </p>
                    <p>
                      {t(
                        '只读：应用不会改动你的 Outlook。只读取标题、时间、地点，不读正文和参会人。',
                        'Read only: the app never changes your Outlook. Only titles, times and places are read, not descriptions or attendees.',
                      )}
                    </p>
                  </Info>
                </div>
                {calendar.source === 'outlook' ? (
                  <>
                    <div className="inline">
                      <span>
                        {calendar.fileAt
                          ? t(
                              `Power Automate 最近写入：${when(calendar.fileAt)}`,
                              `Power Automate last wrote it: ${when(calendar.fileAt)}`,
                            )
                          : t(`读取于 ${when(calendar.at!)}`, `Read ${when(calendar.at!)}`)}
                      </span>
                      <button className="btn" onClick={() => void store.refreshCalendar(true)}>
                        {t('刷新', 'Refresh')}
                      </button>
                    </div>
                    {calendar.fileAt && Date.now() - Date.parse(calendar.fileAt) > 2 * 36e5 && (
                      <p className="warn-text">
                        {t(
                          '超过 2 小时没有更新了（流程每 30 分钟写一次）。去 Power Automate 看看这个流是否开着、最近一次运行是否成功。',
                          'Not updated for over 2 hours (the flow writes every 30 minutes). Check in Power Automate that the flow is on and its last run succeeded.',
                        )}
                      </p>
                    )}
                  </>
                ) : sync.status === 'off' ? (
                  <p className="muted">{t('连接同步后自动读取。', 'Read once sync is connected.')}</p>
                ) : (
                  <div className="inline">
                    <span className="muted">
                      {t('Google Drive 里还没有 Outlook 导出。', 'No Outlook export in Google Drive yet.')}
                    </span>
                    <button className="btn" onClick={() => void store.refreshCalendar(true)}>
                      {t('刷新', 'Refresh')}
                    </button>
                  </div>
                )}
                {calendar.error && (
                  <p className="muted">{t('读取日历失败：', 'Could not read the calendar: ') + calendar.error}</p>
                )}
                <details
                  className="howto"
                  onToggle={(e) => {
                    if (e.currentTarget.open) void prepareOutlook();
                  }}
                >
                  <summary>{t('怎么设置 Outlook', 'Set up Outlook')}</summary>
                  <p role="status">
                    {outlookFile === 'busy'
                      ? t('正在检查 Google Drive…', 'Checking Google Drive…')
                      : outlookFile === 'no-sync'
                        ? t(
                            '先在“同步与数据”里连接同步，再回来打开这里。',
                            'Connect sync under “Sync and data” first, then open this again.',
                          )
                        : outlookFile === 'created'
                          ? t(
                              '已在你的 Google Drive（我的云端硬盘）里新建 outlook-calendar.json，第 4 步选它。',
                              'outlook-calendar.json has been made in your Google Drive (My Drive); choose it in step 4.',
                            )
                          : outlookFile === 'ready'
                            ? t(
                                '你的 Google Drive 里已经有 outlook-calendar.json，第 4 步选它。',
                                'Your Google Drive already has outlook-calendar.json; choose it in step 4.',
                              )
                            : outlookFile
                              ? t('没能准备文件：', 'Could not prepare the file: ') + outlookFile.error
                              : ''}
                  </p>
                  <ol>
                    <li>
                      {t(
                        '打开 Power Automate（make.powerautomate.com），用学校账号登录，新建“计划的云端流”，每 30 分钟运行一次。',
                        'Open Power Automate (make.powerautomate.com) with your school account and make a scheduled cloud flow that runs every 30 minutes.',
                      )}
                    </li>
                    <li>
                      {t(
                        '加 Office 365 Outlook 的“获取事件的日历视图 (V3)”，读前 30 天到后 365 天。它一次最多读 256 条，要分页读完，完整步骤里有现成的写法。',
                        'Add Office 365 Outlook’s “Get calendar view of events (V3)” for 30 days back to 365 ahead. It returns at most 256 at a time, so read it page by page; the full steps show how.',
                      )}
                    </li>
                    <li>
                      {t(
                        '加“选择”，每个日程只留 6 项：id、title、start、end、location、allDay。',
                        'Add “Select” and keep six fields per event: id, title, start, end, location, allDay.',
                      )}
                    </li>
                    <li>
                      {t(
                        '加 Google Drive 的“更新文件”：文件选 outlook-calendar.json，内容选“选择”的输出。不要用“创建文件”。',
                        'Add Google Drive’s “Update file”: the file is outlook-calendar.json, the content is the output of Select. Do not use “Create file”.',
                      )}
                    </li>
                    <li>
                      {t(
                        '保存，点“测试”跑一次，回到这里点“刷新”。',
                        'Save, run a test, then come back and press Refresh.',
                      )}
                    </li>
                  </ol>
                  <a
                    href="https://github.com/Zhihua-Lee/attention-planner/blob/main/docs/outlook-setup.md"
                    target="_blank"
                    rel="noopener"
                  >
                    {t('完整步骤（每一步填什么）', 'Full steps, with what to fill in')}
                  </a>
                </details>
              </section>
              <section>
                <div className="sec-title">
                  <h3>{t('订阅日历', 'Subscribed calendars')}</h3>
                  <Info label={t('订阅日历是什么', 'What a subscribed calendar is')}>
                    <p>
                      {t(
                        '很多日历（课表、节假日、别的日历应用）能给出一个“订阅链接”：以 .ics 结尾，或以 webcal:// 开头的网址。粘贴到这里，日程就会显示在 NOW 的日程里。',
                        'Many calendars (class timetables, holidays, other calendar apps) offer a subscription link: an address ending in .ics or starting with webcal://. Paste it here and its events show in NOW.',
                      )}
                    </p>
                    <p>
                      {t(
                        '每 30 分钟自动更新；订阅会同步，每台设备都能看到。',
                        'It refreshes every 30 minutes, and the subscription syncs to all your devices.',
                      )}
                    </p>
                  </Info>
                </div>
                <div className="subs">
                  {(s.calendars ?? []).map((c) => (
                    <div key={c.id} className="sub-row">
                      <span className="sub-name">{c.name}</span>
                      <span className="muted">
                        {subs[c.id]?.error
                          ? t('读取失败：', 'Failed: ') + subs[c.id].error
                          : subs[c.id]?.at
                            ? t(
                                `${subs[c.id].count} 个日程 · ${new Date(subs[c.id].at!).toLocaleTimeString()}`,
                                `${subs[c.id].count} events · ${new Date(subs[c.id].at!).toLocaleTimeString()}`,
                              )
                            : t('读取中…', 'Reading…')}
                      </span>
                      <button
                        className="mini"
                        aria-label={`${t('取消订阅', 'Unsubscribe')}: ${c.name}`}
                        onClick={() => {
                          set({ calendars: (s.calendars ?? []).filter((x) => x.id !== c.id) });
                          store.setEvents(`sub:${c.id}`, []);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <div className="inline">
                    <input
                      value={subName}
                      onChange={(e) => setSubName(e.target.value)}
                      placeholder={t('名称，如“课表”', 'Name, e.g. Classes')}
                      aria-label={t('订阅名称', 'Subscription name')}
                    />
                    <input
                      className="grow"
                      value={subUrl}
                      onChange={(e) => setSubUrl(e.target.value)}
                      placeholder={t('订阅链接：https://….ics 或 webcal://…', 'Link: https://….ics or webcal://…')}
                      aria-label={t('日历订阅地址', 'Calendar address')}
                    />
                    <button
                      className="btn"
                      disabled={!subUrl.trim()}
                      onClick={() => {
                        const id = Math.random().toString(36).slice(2, 10);
                        set({
                          calendars: [
                            ...(s.calendars ?? []),
                            { id, name: subName.trim() || t('订阅的日历', 'Subscribed calendar'), url: subUrl.trim() },
                          ],
                        });
                        setSubName('');
                        setSubUrl('');
                        setTimeout(() => void store.refreshSubscriptions(true), 0);
                      }}
                    >
                      {t('订阅', 'Subscribe')}
                    </button>
                    {(s.calendars ?? []).length > 0 && (
                      <button className="btn" onClick={() => void store.refreshSubscriptions(true)}>
                        {t('全部刷新', 'Refresh all')}
                      </button>
                    )}
                  </div>
                </div>
              </section>
              <section>
                <div className="sec-title">
                  <h3>{t('日历文件', 'Calendar file')}</h3>
                  <Info label={t('导入日历文件是什么', 'What importing a calendar file does')}>
                    <p>
                      {t(
                        '从这台设备选一个日历文件（.ics，日历应用“导出”得到的），里面的日程会显示在 NOW 的日程里。',
                        'Choose a calendar file (.ics, what a calendar app’s Export gives you) from this device; its events show in NOW.',
                      )}
                    </p>
                    <p>
                      {t(
                        '只存在这台设备上：不同步，也不会自动更新。要一直更新的日历，用上面的订阅。',
                        'It stays on this device: it does not sync or refresh. For a calendar that keeps up to date, subscribe above.',
                      )}
                    </p>
                  </Info>
                </div>
                <div className="inline">
                  <button
                    className="btn"
                    onClick={() =>
                      readFile('.ics,text/calendar', (text) => {
                        const today = dayOf(new Date());
                        const events = parseIcs(text, addDays(today, -14), addDays(today, 120));
                        store.setEvents('file', events);
                        toast(t(`导入了 ${events.length} 个日程`, `Imported ${events.length} events`));
                      })
                    }
                  >
                    {t('导入日历文件', 'Import a calendar file')}
                  </button>
                  {fileEvents ? (
                    <button className="btn" onClick={() => store.setEvents('file', [])}>
                      {t('清除导入的日程', 'Clear imported events')}
                    </button>
                  ) : null}
                  <span className="muted">{fileEvents ? t(`${fileEvents} 个日程`, `${fileEvents} events`) : ''}</span>
                </div>
              </section>
            </div>
            <div className="settings-group" id="settings-sync" data-group="sync">
              <h2 className="group-title">{t('同步与数据', 'Sync and data')}</h2>
              <section>
                <div className="sec-title">
                  <h3>{t('同步', 'Sync')}</h3>
                  <Info label={t('同步怎么工作', 'How sync works')}>
                    <p>
                      {t(
                        '用你自己的 Google Drive 在手机、电脑之间同步任务。点“连接”会跳到 Google 登录，登录后回到这里。',
                        'Your own Google Drive keeps your phone and computers in step. Connect takes you to Google’s sign-in and back here.',
                      )}
                    </p>
                    <p>
                      {t(
                        '任务存在 Drive 里一个隐藏的应用文件夹，别人看不到，你在 Drive 网页上也看不到。应用只能读写它自己建的文件，看不到你 Drive 里的其他东西。',
                        'Tasks live in a hidden app folder in Drive that nobody else can see, nor can you on the Drive website. The app can only read and write files it made itself, nothing else in your Drive.',
                      )}
                    </p>
                    <p>
                      {t(
                        '两台设备改了同一个任务的不同地方，两边的改动都会保留；同时改了同一段文字，会让你选留哪个。',
                        'Edits to different parts of the same task on two devices are both kept; if both changed the same text, you choose which to keep.',
                      )}
                    </p>
                  </Info>
                </div>
                <div className="inline">
                  {sync.status === 'off' ? (
                    <button
                      className="btn"
                      disabled={!broker.trim() || checking}
                      onClick={async () => {
                        const base = broker.trim();
                        setChecking(true);
                        const status = await brokerStatus(base);
                        setChecking(false);
                        if (status === 'signed-out' || status === 'not-connected') {
                          // The broker's own Google sign-in; it returns here afterwards.
                          location.href = `${trimSlash(base)}/google/connect?return=${encodeURIComponent(location.pathname)}`;
                          return;
                        }
                        if (status === 'unavailable') {
                          toast(t('这个地址上没有同步服务。', 'No sync service answers at that address.'));
                          return;
                        }
                        localStorage.setItem('ap:broker', base);
                        localStorage.removeItem('ap:broker-off');
                        store.connectBroker(base);
                      }}
                    >
                      {t('连接', 'Connect')}
                    </button>
                  ) : (
                    <>
                      <button className="btn" onClick={() => void store.syncNow()}>
                        {t('立即同步', 'Sync now')}
                      </button>
                      <button
                        className="btn"
                        onClick={() => (
                          localStorage.removeItem('ap:broker'),
                          localStorage.setItem('ap:broker-off', '1'),
                          store.connect(null)
                        )}
                      >
                        {t('断开', 'Disconnect')}
                      </button>
                    </>
                  )}
                </div>
                <p className="muted" role="status">
                  {sync.status === 'off'
                    ? t('未连接', 'Not connected')
                    : sync.status === 'syncing'
                      ? t('同步中…', 'Syncing…')
                      : sync.status === 'error'
                        ? `${t('同步失败：', 'Sync failed: ')}${sync.error}`
                        : sync.lastAt
                          ? t(
                              `已同步 ${new Date(sync.lastAt).toLocaleTimeString()}`,
                              `Synced ${new Date(sync.lastAt).toLocaleTimeString()}`,
                            )
                          : t('已连接', 'Connected')}
                </p>
                {sync.status === 'off' && (
                  <details className="advanced">
                    <summary>{t('高级：同步服务地址', 'Advanced: sync service address')}</summary>
                    <input
                      className="grow"
                      value={broker}
                      onChange={(e) => setBroker(e.target.value)}
                      placeholder="https://…/api"
                      aria-label={t('同步服务地址', 'Sync service address')}
                    />
                    <p className="muted">
                      {t(
                        '一般不用改。只有自己部署了同步服务，才填它的地址。',
                        'Leave it as it is, unless you run your own sync service; then put its address here.',
                      )}
                    </p>
                  </details>
                )}
              </section>
              <section>
                <div className="sec-title">
                  <h3>{t('数据', 'Data')}</h3>
                  <Info label={t('导出和导入', 'Export and import')}>
                    <ul>
                      <li>
                        {t(
                          '导出备份：把全部任务、区域、项目和设置存成一个文件（.json），自己留着以防万一。',
                          'Export a backup: saves all tasks, areas, projects and settings in one file (.json) for you to keep.',
                        )}
                      </li>
                      <li>
                        {t(
                          '导入旧应用数据：把以前那版 Attention Planner 导出的文件搬进来，和现有任务放在一起；导入后可以撤销。',
                          'Import from the previous app: brings in a file exported from the earlier Attention Planner, next to what is here; it can be undone.',
                        )}
                      </li>
                    </ul>
                  </Info>
                </div>
                <div className="inline">
                  <button
                    className="btn"
                    onClick={() =>
                      readFile('.json,application/json', (text) => {
                        try {
                          let report = null as ReturnType<typeof importLegacy>[1] | null;
                          store.commit((d, c) => {
                            const [n, r] = importLegacy(d, c, JSON.parse(text));
                            report = r;
                            return n;
                          });
                          const r = report!;
                          toast(
                            t(
                              `导入了 ${r.tasks} 个任务（已完成 ${r.done}，暂缓 ${r.snoozed}），${r.areas} 个区域，${r.projects} 个项目`,
                              `Imported ${r.tasks} tasks (${r.done} done, ${r.snoozed} snoozed), ${r.areas} areas, ${r.projects} projects`,
                            ),
                            () => store.undo(),
                          );
                        } catch {
                          toast(
                            t(
                              '这个文件读不了：需要旧应用导出的 JSON。',
                              'Could not read that file: choose a JSON export from the previous app.',
                            ),
                          );
                        }
                      })
                    }
                  >
                    {t('导入旧应用数据', 'Import from the previous app')}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(store.get().doc, null, 2)], { type: 'application/json' });
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = `attention-planner-${dayOf(new Date())}.json`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                    }}
                  >
                    {t('导出备份', 'Export a backup')}
                  </button>
                </div>
              </section>
            </div>
            <div className="settings-group" id="settings-ai" data-group="ai">
              <h2 className="group-title">{t('AI 连接', 'AI connections')}</h2>
              <section>
                <div className="sec-title">
                  <h3>{t('连接地址', 'Connection address')}</h3>
                  <Info label={t('怎么连接 AI 助手', 'How to connect an AI assistant')}>
                    <p>
                      {t(
                        '让 ChatGPT、Claude 等 AI 助手查看你的清单和日程，帮你安排、拆分任务。',
                        'Lets an AI assistant such as ChatGPT or Claude see your list and agenda, and help you plan and break tasks down.',
                      )}
                    </p>
                    <ol>
                      <li>
                        {t(
                          '在 AI 应用里找到“添加连接器”或“MCP 服务器”，填下面的地址。',
                          'In the AI app, find “Add connector” or “MCP server” and enter the address below.',
                        )}
                      </li>
                      <li>
                        {t(
                          '它会打开一个网页，登录 Google 后点“允许”。',
                          'It opens a page; sign in to Google and choose Allow.',
                        )}
                      </li>
                    </ol>
                    <p>
                      {t(
                        'AI 新建或修改任务，都会先变成“提议”出现在清单顶部，你批准后才生效（可以撤销）。“管理”里能看到、断开已连接的 AI。',
                        'Whatever an AI adds or changes first appears as a proposal at the top of the list and only takes effect when you approve it (and can be undone). Manage shows the connected AIs and lets you disconnect them.',
                      )}
                    </p>
                  </Info>
                </div>
                <div className="inline">
                  <input
                    className="grow"
                    readOnly
                    value={`${location.origin}/api/mcp`}
                    aria-label={t('连接地址（MCP）', 'Connection address (MCP)')}
                  />
                  <a className="btn" href="/api/ai/connections" target="_blank" rel="noopener">
                    {t('管理', 'Manage')}
                  </a>
                </div>
                <div className="sec-title">
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={!!s.aiAddsDirectly}
                      onChange={(e) => set({ aiAddsDirectly: e.target.checked })}
                    />
                    {t('AI 新建任务无需批准', 'Save tasks the AI adds without approval')}
                  </label>
                  <Info label={t('无需批准是什么意思', 'What saving without approval means')}>
                    <p>
                      {t(
                        '勾上后，AI 新建的任务直接保存，不再等你批准。修改、完成或删除已有任务，仍然一定要你批准。',
                        'When ticked, tasks an AI adds are saved at once. Changing, completing or deleting an existing task always waits for your approval.',
                      )}
                    </p>
                  </Info>
                </div>
              </section>
            </div>
            <footer className="muted">Attention Planner {__APP_VERSION__}</footer>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
