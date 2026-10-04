import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A panel for short forms. On a phone it rises from the bottom and stays above the on-screen keyboard
 * (it follows the visual viewport); on a wide screen it is a small centred dialog.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [keyboard, setKeyboard] = useState(0);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const vv = window.visualViewport;
    const fit = () => vv && setKeyboard(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    document.addEventListener('keydown', key, true);
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    return () => {
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      document.removeEventListener('keydown', key, true);
    };
  }, []);
  return createPortal(
    <div className="scrim sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="bsheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{ marginBottom: keyboard }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
