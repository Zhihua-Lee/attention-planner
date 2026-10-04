import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDays, dayOf } from '../model/dates';
import { addArea, addProject, removeGroup, renameGroup, setSettings } from '../model/doc';
import { parseIcs } from '../model/ics';
import { importLegacy } from '../model/legacyImport';
import type { ChipKey } from '../model/types';
import { brokerTokens, DriveRemote } from '../store/drive';
import { store, useStore } from '../store/store';
import { toast } from './common';
import { useT, weekdayShort } from './text';

const ALL_CHIPS: ChipKey[] = ['due', 'plan', 'effort', 'star', 'area', 'repeat', 'note'];

export function Settings({ onClose }: { onClose: () => void }) {
  const { doc, sync } = useStore();
  const { t } = useT();
  const s = doc.settings;
  const panel = useRef<HTMLDivElement>(null);
  const [broker, setBroker] = useState(() => localStorage.getItem('ap:broker') ?? '');
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
          <h3>{t('日历', 'Calendar')}</h3>
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
                  store.commit((d) => ({ ...d, events }), { undoable: false });
                  toast(t(`导入了 ${events.length} 个日程`, `Imported ${events.length} events`));
                })
              }
            >
              {t('导入 .ics', 'Import .ics')}
            </button>
            {doc.events?.length ? (
              <button
                className="btn"
                onClick={() => store.commit((d) => ({ ...d, events: undefined }), { undoable: false })}
              >
                {t('清除日历', 'Clear calendar')}
              </button>
            ) : null}
            <span className="muted">
              {doc.events?.length ? t(`${doc.events.length} 个日程`, `${doc.events.length} events`) : ''}
            </span>
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
                disabled={!broker.trim()}
                onClick={() => {
                  localStorage.setItem('ap:broker', broker.trim());
                  store.connect(new DriveRemote(brokerTokens(broker.trim())));
                }}
              >
                {t('连接', 'Connect')}
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => void store.syncNow()}>
                  {t('立即同步', 'Sync now')}
                </button>
                <button className="btn" onClick={() => (localStorage.removeItem('ap:broker'), store.connect(null))}>
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

        <footer className="muted">Attention Planner {__APP_VERSION__}</footer>
      </div>
    </div>,
    document.body,
  );
}
