import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

/**
 * A small (i) next to a label: the explanation stays out of the layout until wanted.
 * Hover or focus shows it on desktop; tap toggles it on touch. Escape or an outside click closes it.
 */
export function InfoTip({ children, label = 'Info', className = '' }: { children: ReactNode; label?: string; className?: string }) {
    const [open, setOpen] = useState(false), [pinned, setPinned] = useState(false);
    const id = useId(), root = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setPinned(false); } };
        document.addEventListener('pointerdown', outside, true);
        return () => document.removeEventListener('pointerdown', outside, true);
    }, [open]);
    return <span ref={root} className={`relative inline-flex align-middle ${className}`}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!pinned) setOpen(false); }}>
        <button type="button" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
            className="inline-flex h-5 w-5 min-h-0 min-w-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            data-info-tip
            onClick={event => { event.preventDefault(); event.stopPropagation(); const next = !pinned; setPinned(next); setOpen(next); }}
            onFocus={() => setOpen(true)} onBlur={() => { if (!pinned) setOpen(false); }}
            onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); setPinned(false); } }}>
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {open && <span role="tooltip" id={id}
            className="absolute left-1/2 top-full z-50 mt-1 w-max max-w-[min(18rem,80vw)] -translate-x-1/2 whitespace-normal rounded-md border border-border bg-popover px-2.5 py-2 text-left text-xs font-normal leading-5 text-popover-foreground shadow-md">
            {children}
        </span>}
    </span>;
}
