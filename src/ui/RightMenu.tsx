import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';

export type MenuItem = { label: string; run: () => void; danger?: boolean } | 'sep';

/** A line on top of a menu saying what it is about (a calendar event: what, when, and where it comes from). */
export type MenuHead = { title: string; note?: string };

/** Where a menu opens and what is in it; `from` gets the focus back when it closes. */
export type MenuState = { x: number; y: number; items: MenuItem[]; label: string; from: HTMLElement; head?: MenuHead };

/**
 * The state of one right-click menu. `openAt` takes the right-click (or a long press) and the element it belongs to;
 * the context-menu key opens it at that element.
 */
export function useMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  return {
    menu,
    close: () => setMenu(null),
    openAt: (
      at: { clientX: number; clientY: number },
      from: HTMLElement,
      label: string,
      items: MenuItem[],
      head?: MenuHead,
    ) => {
      // The context-menu key gives no position: open below the element instead.
      const r = from.getBoundingClientRect();
      const keyed = !at.clientX && !at.clientY;
      setMenu({ x: keyed ? r.left + 8 : at.clientX, y: keyed ? r.bottom : at.clientY, items, label, from, head });
    },
  };
}

/** Whether a right-click should be left to the browser: over selected text in a field, or on a link in the note. */
export function leaveToBrowser(e: MouseEvent) {
  const el = e.target as HTMLElement;
  if (el.closest('a[href]')) return true;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.selectionStart !== el.selectionEnd;
  return !!document.getSelection()?.toString().trim();
}

/**
 * A long press on a touch screen, for phones that do not turn one into a right-click (iPhone). It fires after half a
 * second without moving, and the tap that ends it does nothing else.
 */
export function useLongPress(onLong: (at: { clientX: number; clientY: number }, el: HTMLElement) => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const stop = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      fired.current = false;
      if (e.pointerType !== 'touch') return;
      const el = e.currentTarget;
      const at = { clientX: e.clientX, clientY: e.clientY };
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        start.current = null;
        onLong(at, el);
      }, 500);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    /** True once, right after a long press, so the click it ends can be ignored. */
    fired: () => {
      const f = fired.current;
      fired.current = false;
      return f;
    },
  };
}

/** A right-click menu: arrows move, Enter chooses, Escape or a press outside closes it. */
export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - w - 8)),
      top: Math.max(8, menu.y + h > window.innerHeight - 8 ? menu.y - h : menu.y),
    });
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [menu]);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const down = (e: globalThis.PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const away = () => close.current();
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
    };
  }, []);
  const done = (back = true) => {
    onClose();
    if (back && menu.from.isConnected) menu.from.focus({ preventScroll: true });
  };
  return createPortal(
    <div
      ref={ref}
      className="pop ctx-menu"
      role="menu"
      aria-label={menu.label}
      style={pos ?? { top: -9999, left: -9999 }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const items = [...ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
        } else if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          done();
        }
      }}
    >
      {menu.head && (
        <div className="ctx-head">
          <div className="ctx-title">{menu.head.title}</div>
          {menu.head.note && <div className="ctx-note">{menu.head.note}</div>}
        </div>
      )}
      {menu.items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item${it.danger ? ' danger' : ''}`}
            onClick={() => {
              done(false);
              it.run();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
