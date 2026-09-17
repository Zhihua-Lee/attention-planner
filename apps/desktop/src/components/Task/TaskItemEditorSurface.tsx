import type { ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../contexts/language-context';
import { ModalPortal } from '../ModalPortal';

type TaskItemEditorSurfaceProps = {
    editorAriaLabel: string;
    getModalFocusableElements: () => HTMLElement[];
    isEditing: boolean;
    isModalEditor: boolean;
    modalEditorRef: RefObject<HTMLDivElement | null>;
    onCancel: () => void;
    renderDisplay: () => ReactNode;
    renderEditor: () => ReactNode;
};

export function TaskItemEditorSurface({
    editorAriaLabel,
    getModalFocusableElements,
    isEditing,
    isModalEditor,
    modalEditorRef,
    onCancel,
    renderDisplay,
    renderEditor,
}: TaskItemEditorSurfaceProps) {
    const { t } = useLanguage();
    // Closing is an intent, not a discard: the owning edit session still decides
    // whether to show its unsaved-changes confirmation. Keep this control outside
    // the scrolling form so it remains reachable with a phone keyboard open.
    const exitBar = (
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 py-1">
            <span className="min-w-0 truncate text-sm font-medium">{editorAriaLabel}</span>
            <button
                type="button"
                aria-label={t('common.close')}
                onClick={(event) => {
                    event.stopPropagation();
                    onCancel();
                }}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md px-2 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
                <X className="h-4 w-4" aria-hidden="true" />
                {t('common.close')}
            </button>
        </header>
    );
    const modal = isEditing && isModalEditor ? (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={editorAriaLabel}
            onMouseDown={(event) => {
                if (event.target !== event.currentTarget) return;
                onCancel();
            }}
        >
            <div
                ref={modalEditorRef}
                tabIndex={-1}
                className="flex max-h-[92dvh] w-full min-w-0 max-w-[1100px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.defaultPrevented) return;
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        onCancel();
                        return;
                    }
                    if (event.key !== 'Tab') return;
                    const focusable = getModalFocusableElements().filter((element) => (
                        !element.closest('[hidden], [inert]')
                        && element.getAttribute('aria-hidden') !== 'true'
                        && !element.hasAttribute('disabled')
                    ));
                    if (focusable.length === 0) {
                        event.preventDefault();
                        modalEditorRef.current?.focus();
                        return;
                    }
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    const active = document.activeElement as HTMLElement | null;
                    if (!active || !focusable.includes(active)) {
                        event.preventDefault();
                        (event.shiftKey ? last : first).focus();
                        return;
                    }
                    if (event.shiftKey && active === first) {
                        event.preventDefault();
                        last.focus();
                        return;
                    }
                    if (!event.shiftKey && active === last) {
                        event.preventDefault();
                        first.focus();
                    }
                }}
            >
                {exitBar}
                <div className="min-h-0 overflow-y-auto overscroll-contain p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
                    {renderEditor()}
                </div>
            </div>
        </div>
    ) : null;

    return (
        <>
            {isEditing && !isModalEditor ? (
                <div className="min-w-0 flex-1">
                    {exitBar}
                    <div className="pt-3">{renderEditor()}</div>
                </div>
            ) : (
                renderDisplay()
            )}
            {modal && <ModalPortal>{modal}</ModalPortal>}
        </>
    );
}
