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
import { toast } from './common';
import { DEFAULT_STEP_TOOLS } from './StepList';
import { useT, weekdayShort } from './text';

const ALL_CHIPS: ChipKey[] = ['due', 'plan', 'effort', 'star', 'area', 'repeat', 'note'];

export function Settings({ onClose }: { onClose: () => void }) {
  const { doc, sync, calendar, subs } = useStore();
  const fileEvents = (doc.events ?? []).filter((e) => e.source === 'file').length;
  const { t } = useT();
  const s = doc.settings;
  const panel = useRef<HTMLDivElement>(null);
  const [broker, setBroker] = useState(() => localStorage.getItem('ap:broker') ?? '/api');
  const [checking, setChecking] = useState(false);
  const [subName, setSubName] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [push, setPush] = useState<PushState | 'busy'>('off');
  useEffect(() => {
    void pushState().then(setPush);
  }, []);
  const [newGroup, setNewGroup] = useState('');
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
  const groups = [
    ...Object.values(doc.areas).map((g) => ({ kind: 'areas' as const, g })),
    ...Object.values(doc.projects).map((g) => ({ kind: 'projects' as const, g })),
  ].filter((x) => !x.g.deleted);

  return createPortal(
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="sheet"
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

        <section>
          <h3>{t('目标', 'Goal')}</h3>
          <p className="hint">
            {t(
              '最长远的方向，用你自己的话写。AI 规划和拆分任务时会参照它；不计进度，不催你。',
              'Your longest-range direction, in your own words. The AI keeps it in mind when it plans and breaks tasks down; nothing is measured or chased.',
            )}
          </p>
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
          <h3>{t('可用于做事的时间', 'Working time')}</h3>
          <p className="hint">
            {t('用来计算“截止前时间够不够”和空档。', 'Used to work out free time and whether deadlines fit.')}
          </p>
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
                    workDays: s.workDays.includes(d) ? s.workDays.filter((x) => x !== d) : [...s.workDays, d].sort(),
                  })
                }
              >
                {weekdayShort(d, s.lang)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>{t('记录时的标签', 'Capture chips')}</h3>
          <p className="hint">
            {t('前排按顺序显示，其余收在“更多”。', 'Shown up front in this order; the rest sit under “More”.')}
          </p>
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
          <h3>{t('步骤后面的按钮', 'Buttons after each step')}</h3>
          <p className="hint">
            {t(
              '拖动排序和删除一直都在；其余按需打开。已经设了的截止、用时、重复会以小标签显示在步骤后面。',
              'Dragging and deleting are always there; turn on the rest as you need them. A deadline, estimate or repeat already set shows as a small tag.',
            )}
          </p>
          <div className="checks">
            {(
              [
                ['due', t('截止', 'Deadline')],
                ['effort', t('用时', 'Effort')],
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
          <h3>{t('清单筛选', 'List filters')}</h3>
          <p className="hint">
            {t(
              '“全部”一直都在；没有内容的筛选会自动隐藏。',
              '"All" is always there; a filter with nothing in it hides itself.',
            )}
          </p>
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
          <h3>{t('区域与项目', 'Areas and projects')}</h3>
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

        <section>
          <h3>{t('提醒', 'Reminders')}</h3>
          <p className="hint">
            {t(
              '到了截止当天和预留时段开始前，在这台设备上弹通知；应用没打开也会收到。iPhone 要先把应用添加到主屏幕（iOS 16.4 及以上）。',
              'Notifications on this device on a deadline’s day and before reserved times, even when the app is closed. On iPhone, add the app to the Home Screen first (iOS 16.4+).',
            )}
          </p>
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
                        ? t('请先在下面连接同步（登录 Google）。', 'Connect sync below first (sign in to Google).')
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
          <p className="hint">
            {t('有具体时刻的截止，会提前 1 小时提醒。', 'A deadline with a time is reminded an hour before.')}
          </p>
        </section>

        <section>
          <h3>{t('日历', 'Calendar')}</h3>
          <label className="check-row">
            <input
              type="checkbox"
              checked={s.slotSuggestions !== false}
              onChange={(e) => set({ slotSuggestions: e.target.checked })}
            />
            {t('点空白时间时推荐任务', 'Suggest tasks for a tapped free time')}
          </label>
          {calendar.source === 'outlook' && (
            <div className="inline">
              <span>
                {t('Outlook（经 Google Drive）', 'Outlook (via Google Drive)')} ·{' '}
                {t(
                  `更新于 ${new Date(calendar.at!).toLocaleTimeString()}`,
                  `updated ${new Date(calendar.at!).toLocaleTimeString()}`,
                )}
              </span>
              <button className="btn" onClick={() => void store.refreshCalendar(true)}>
                {t('刷新', 'Refresh')}
              </button>
            </div>
          )}
          {calendar.error && (
            <p className="muted">{t('读取日历失败：', 'Could not read the calendar: ') + calendar.error}</p>
          )}
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
                placeholder="https://… .ics / webcal://…"
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
            <p className="hint">
              {t(
                '填日历的订阅链接（.ics 或 webcal），每 30 分钟自动更新。',
                'Paste a calendar subscription link (.ics or webcal); it refreshes every 30 minutes.',
              )}
            </p>
          </div>
          <p className="hint">
            {t(
              '导入 .ics 文件，在 NOW 的日程里显示（只存在这台设备上）。',
              'Import an .ics file to show its events in NOW (kept on this device only).',
            )}
          </p>
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
              {t('导入 .ics', 'Import .ics')}
            </button>
            {fileEvents ? (
              <button className="btn" onClick={() => store.setEvents('file', [])}>
                {t('清除导入的日程', 'Clear imported events')}
              </button>
            ) : null}
            <span className="muted">{fileEvents ? t(`${fileEvents} 个日程`, `${fileEvents} events`) : ''}</span>
          </div>
        </section>

        <section>
          <h3>{t('数据', 'Data')}</h3>
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

        <section>
          <h3>{t('同步', 'Sync')}</h3>
          <p className="hint">
            {t(
              '通过同步中转连接 Google Drive；数据存进新文件 attention-planner-v3.json，不会改动旧应用的数据。',
              'Connects Google Drive through the sync broker; data goes to a new file, attention-planner-v3.json, and the previous app’s data is never changed.',
            )}
          </p>
          <div className="inline">
            <input
              className="grow"
              value={broker}
              onChange={(e) => setBroker(e.target.value)}
              placeholder="https://…/api"
              aria-label={t('同步中转地址', 'Sync broker address')}
            />
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
                    toast(t('这个地址上没有同步中转。', 'No sync broker answers at that address.'));
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
        </section>

        <section>
          <h3>{t('AI 连接', 'AI connections')}</h3>
          <p className="hint">
            {t(
              '在 ChatGPT、Claude 等 AI 客户端里添加下面的 MCP 地址。AI 可以查看、直接新建任务；修改已有任务要你批准。',
              'Add this MCP address in an AI client such as ChatGPT or Claude. It can read and add tasks; changes to existing tasks wait for your approval.',
            )}
          </p>
          <div className="inline">
            <input
              className="grow"
              readOnly
              value={`${location.origin}/api/mcp`}
              aria-label={t('MCP 地址', 'MCP address')}
            />
            <a className="btn" href="/api/ai/connections" target="_blank" rel="noopener">
              {t('管理', 'Manage')}
            </a>
          </div>
        </section>

        <footer className="muted">Attention Planner {__APP_VERSION__}</footer>
      </div>
    </div>,
    document.body,
  );
}
