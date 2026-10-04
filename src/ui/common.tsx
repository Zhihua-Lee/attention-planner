import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ---------- toast ----------
type Toast = { id: number; text: string; undo?: () => void };
let toastState: Toast | null = null;
const toastListeners = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, undo?: () => void) {
  toastState = { id: Date.now(), text, undo };
  toastListeners.forEach((f) => f());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastState = null;
    toastListeners.forEach((f) => f());
  }, 5000);
}
export function ToastHost({ undoLabel }: { undoLabel: string }) {
  const t = useSyncExternalStore(
    (f) => (toastListeners.add(f), () => toastListeners.delete(f)),
    () => toastState,
  );
  if (!t) return null;
  return (
    <div className="toast" role="status" key={t.id}>
      <span>{t.text}</span>
      {t.undo && (
        <button
          onClick={() => {
            t.undo!();
            toastState = null;
            toastListeners.forEach((f) => f());
          }}
        >
          {undoLabel}
        </button>
      )}
    </div>
  );
}

// ---------- now ----------
/** The current time, refreshed every 30 seconds (and on focus). */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', tick);
    };
  }, []);
  return now;
}

// ---------- popover ----------
/** A small panel anchored to a control. Closes on Escape or a press outside, and returns focus to the anchor. */
export function Popover({
  anchor,
  onClose,
  children,
  label,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = a.bottom + 6;
      const top =
        below + h > window.innerHeight - 8 && a.top - h - 6 > 8
          ? a.top - h - 6
          : Math.min(below, Math.max(8, window.innerHeight - h - 8));
      setPos({ top, left: Math.max(8, Math.min(a.left, window.innerWidth - w - 8)) });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor]);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
        anchor.focus();
      }
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [anchor]);
  // Move focus in when it opens, and back in when its content changes (a second step) — never away from a field in use.
  useEffect(() => {
    if (ref.current && !ref.current.contains(document.activeElement)) {
      ref.current.querySelector<HTMLElement>('[data-autofocus], button, input, select')?.focus({ preventScroll: true });
    }
  });
  return createPortal(
    <div
      ref={ref}
      className="pop"
      role="dialog"
      aria-label={label}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Track which control opened a popover. */
export function usePopover<K extends string>() {
  const [open, setOpen] = useState<{ key: K; el: HTMLElement } | null>(null);
  return {
    open,
    toggle: (key: K, el: HTMLElement) => setOpen((o) => (o?.key === key ? null : { key, el })),
    close: () => setOpen(null),
    is: (key: K) => open?.key === key,
  };
}

export const Icon = {
  search: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  settings: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  ),
  undo: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  ),
  cloud: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9H7z" />
    </svg>
  ),
};
