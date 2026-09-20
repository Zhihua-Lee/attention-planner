import { useEffect, useId, useRef } from 'react';
import type { ExternalCalendarEvent } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { ModalPortal } from '../ModalPortal';
import { useDialogHistory } from './useDialogHistory';

/** External events are constraints, not editable tasks. Never render feed HTML. */
export function CalendarEventDetails({ event, onClose }: { event: ExternalCalendarEvent; onClose: () => void }) {
    const { language } = useLanguage();
    const l = (en: string, zh: string) => language.startsWith('zh') ? zh : en;
    const id = useId();
    const closeButton = useRef<HTMLButtonElement>(null);
    const close = useDialogHistory(true, () => { onClose(); return true; });
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        closeButton.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, []);
    const start = new Date(event.start);
    // All-day feed ends are exclusive. Show the last included date to readers.
    const end = new Date(Date.parse(event.end) - (event.allDay ? 1 : 0));
    return <ModalPortal>
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3" onClick={e => { if (e.target === e.currentTarget) close(); }}>
            <section role="dialog" aria-modal="true" aria-labelledby={id} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl" onKeyDown={e => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
                // The read-only sheet has one focusable control.
                if (e.key === 'Tab') { e.preventDefault(); closeButton.current?.focus(); }
            }}>
                <header className="flex items-start justify-between gap-3">
                    <h2 id={id} className="min-w-0 break-words text-xl font-semibold">{event.title}</h2>
                    <button ref={closeButton} type="button" className="min-h-11 shrink-0 rounded border border-border px-3" onClick={() => close()}>{l('Close', '关闭')}</button>
                </header>
                <p className="mt-3 text-sm text-muted-foreground">{l('External calendar · read only', '外部日历 · 只读')}</p>
                <dl className="mt-4 space-y-4 text-sm">
                    <div><dt className="font-medium">{l('Time', '时间')}</dt><dd>{event.allDay ? `${l('All day', '全天')} · ${start.toLocaleDateString(language)} – ${end.toLocaleDateString(language)}` : `${start.toLocaleString(language)} – ${end.toLocaleString(language)}`}</dd></div>
                    <div><dt className="font-medium">{l('Location', '地点')}</dt><dd className="whitespace-pre-wrap break-words">{event.location || l('No location provided', '日历未提供地点')}</dd></div>
                    {event.description && <div><dt className="font-medium">{l('Description', '说明')}</dt><dd className="whitespace-pre-wrap break-words">{event.description}</dd></div>}
                </dl>
            </section>
        </div>
    </ModalPortal>;
}
