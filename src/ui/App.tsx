import { MotionConfig } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { store, useStore } from '../store/store';
import { Icon, ToastHost, toast, useNow } from './common';
import { NowView } from './NowView';
import { Search } from './Search';
import { Settings } from './Settings';
import { TaskList } from './TaskList';
import { useT } from './text';

type Tab = 'now' | 'list';

export function App() {
  const { ready, doc, canUndo, sync, saveError, imported } = useStore();
  const { t } = useT();
  const now = useNow();
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#list' ? 'list' : 'now'));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [settings, setSettings] = useState(false);
  // Full width for reading on a large screen; remembered on this device only.
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem('ap:wide') === '1';
    } catch {
      return false;
    }
  });
  const toggleWide = () => {
    setWide(!wide);
    try {
      localStorage.setItem('ap:wide', wide ? '0' : '1');
    } catch {
      /* not remembered */
    }
  };
  const capture = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const theme = doc.settings.theme;
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.lang = doc.settings.lang === 'zh' ? 'zh-CN' : 'en';
  }, [doc.settings.theme, doc.settings.lang]);

  useEffect(() => {
    if (!imported) return;
    toast(t(`已导入旧应用的 ${imported.tasks} 个任务`, `Imported ${imported.tasks} tasks from the previous app`), () =>
      store.undo(),
    );
    store.clearImported();
  }, [imported, t]);

  // A tapped reminder opens the app at its task (`/?open=<id>`).
  useEffect(() => {
    if (!ready) return;
    const id = new URLSearchParams(location.search).get('open');
    if (!id) return;
    history.replaceState(null, '', location.pathname);
    if (store.get().doc.tasks[id]) open(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const open = (id: string) => {
    setTab('list');
    setExpanded(id);
    requestAnimationFrame(() =>
      document.querySelector(`[data-task="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing =
        /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName) ||
        (e.target as HTMLElement).isContentEditable;
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      const k = e.key.toLowerCase();
      if (mod && (k === 'k' || (k === 'f' && !e.shiftKey))) {
        // Ctrl+F searches the tasks rather than the page.
        e.preventDefault();
        setSearching(true);
      } else if (mod && !e.shiftKey && k === 's') {
        // Everything is saved as it is typed; Ctrl+S syncs instead of saving the web page.
        e.preventDefault();
        void store.syncNow();
        toast(t('已自动保存', 'Saved automatically'));
      } else if (mod && !e.shiftKey && ['p', 'o', 'u', 'd', 'g'].includes(k)) {
        // Print, open file, view source, bookmark and find-next belong to web pages, not to this app.
        e.preventDefault();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'z' &&
        !e.shiftKey &&
        (!typing || ((e.target as HTMLInputElement).id === 'capture' && !(e.target as HTMLInputElement).value))
      ) {
        // In an empty capture box there is no text to undo, so Ctrl+Z undoes the last change instead.
        e.preventDefault();
        if (store.undo()) toast(t('已撤销', 'Undone'));
      } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === '/') {
          e.preventDefault();
          setSearching(true);
        } else if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          setTab('list');
          requestAnimationFrame(() => capture.current?.focus());
        } else if (e.key === 'Escape' && expanded) setExpanded(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [expanded, t]);

  if (!ready) return <div className="app loading" aria-busy="true" />;
  return (
    <MotionConfig reducedMotion="user">
      <div className={`app${wide ? ' wide' : ''}`}>
        <header className="top">
          <div className="tabs" role="tablist" aria-label={t('主菜单', 'Main')}>
            <button role="tab" className="tab" aria-selected={tab === 'now'} onClick={() => setTab('now')}>
              NOW
            </button>
            <button role="tab" className="tab" aria-selected={tab === 'list'} onClick={() => setTab('list')}>
              {t('清单', 'List')}
            </button>
          </div>
          <div className="top-right">
            {sync.status !== 'off' && (
              <span
                className={`sync-dot ${sync.status}`}
                title={sync.status === 'error' ? sync.error : t('同步', 'Sync')}
                aria-label={
                  sync.status === 'error'
                    ? `${t('同步失败', 'Sync failed')}: ${sync.error}`
                    : t('已连接同步', 'Sync connected')
                }
              >
                {Icon.cloud}
              </span>
            )}
            <button
              className="icon-btn"
              disabled={!canUndo}
              aria-label={t('撤销（Ctrl+Z）', 'Undo (Ctrl+Z)')}
              title={t('撤销（Ctrl+Z）', 'Undo (Ctrl+Z)')}
              onClick={() => store.undo() && toast(t('已撤销', 'Undone'))}
            >
              {Icon.undo}
            </button>
            <button
              className="icon-btn"
              aria-label={t('搜索（/ 或 Ctrl+K）', 'Search (/ or Ctrl+K)')}
              title={t('搜索（/ 或 Ctrl+K）', 'Search (/ or Ctrl+K)')}
              onClick={() => setSearching(true)}
            >
              {Icon.search}
            </button>
            <button
              className="icon-btn wide-btn"
              aria-pressed={wide}
              aria-label={t('全宽', 'Full width')}
              title={t('全宽', 'Full width')}
              onClick={toggleWide}
            >
              {wide ? Icon.narrow : Icon.wide}
            </button>
            <button
              className="icon-btn"
              aria-label={t('设置', 'Settings')}
              title={t('设置', 'Settings')}
              onClick={() => setSettings(true)}
            >
              {Icon.settings}
            </button>
          </div>
        </header>
        {saveError && (
          <p className="banner" role="alert">
            {t(
              '这个浏览器不让保存数据，关掉页面前请先导出备份。',
              'This browser will not store data; export a backup before closing the page.',
            )}
          </p>
        )}
        <main>
          {tab === 'now' ? (
            <NowView now={now} open={open} />
          ) : (
            <TaskList ref={capture} now={now} expanded={expanded} setExpanded={setExpanded} />
          )}
        </main>
        <ToastHost undoLabel={t('撤销', 'Undo')} />
        {searching && <Search onClose={() => setSearching(false)} onOpen={open} />}
        {settings && <Settings onClose={() => setSettings(false)} />}
      </div>
    </MotionConfig>
  );
}
