import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLanguage } from '../../contexts/language-context';
import { isInputComposition } from '../../lib/input-method';
import { FieldConflict } from '../../lib/task-field-edits';
import { useSaveListener } from '../../lib/save-shortcut';
import { AutosizeTextarea } from '../ui/AutosizeTextarea';

/** Page-level save status: every in-place commit reports here. */
export type SaveTracker = { track: (work: Promise<unknown>) => Promise<unknown> };
export const SaveTrackerContext = createContext<SaveTracker>({ track: work => work });

export type InlineTextHandle = { focus: (at?: 'start' | 'end') => void; commit: () => Promise<void>; element: () => HTMLTextAreaElement | null };
export type InlineTextKeyApi = { text: string; caret: number; commit: () => Promise<void> };

/**
 * Text that is always editable in place (no separate edit mode). It commits after a pause, on blur,
 * on Enter when `singleLine`, and with Ctrl/Cmd+S. While focused, it keeps the user's text even if
 * the stored value changes; a conflicting remote edit is surfaced instead of overwritten.
 */
export const InlineText = forwardRef<InlineTextHandle, {
    value: string;
    onCommit: (next: string, base: string, force: boolean) => Promise<void>;
    ariaLabel: string;
    placeholder?: string;
    className?: string;
    singleLine?: boolean;
    disabled?: boolean;
    /** Return true when handled (the default Enter/Backspace behavior is then skipped). */
    onKey?: (event: KeyboardEvent<HTMLTextAreaElement>, api: InlineTextKeyApi) => boolean | void;
    onBlurEmpty?: () => void;
    dataAttributes?: Record<string, string>;
    after?: ReactNode;
    /** 'title' keeps its heading size on touch devices. */
    kind?: 'title' | 'text';
}>(function InlineText({ value, onCommit, ariaLabel, placeholder, className = '', singleLine = false, disabled = false, onKey, onBlurEmpty, dataAttributes, after, kind = 'text' }, ref) {
    const { language } = useLanguage(), zh = language.startsWith('zh'), l = (en: string, cn: string) => zh ? cn : en;
    const { track } = useContext(SaveTrackerContext);
    const [text, setText] = useState(value), [conflict, setConflict] = useState<string | null>(null), [error, setError] = useState('');
    const base = useRef(value), textRef = useRef(value), focused = useRef(false), timer = useRef<number | undefined>(undefined);
    const element = useRef<HTMLTextAreaElement | null>(null), inFlight = useRef<Promise<void> | null>(null);
    // Follow the stored value unless the user holds unsaved text.
    useEffect(() => {
        if (!focused.current && textRef.current === base.current) { base.current = value; textRef.current = value; setText(value); }
    }, [value]);
    const commit = async (force = false): Promise<void> => {
        window.clearTimeout(timer.current);
        if (inFlight.current) await inFlight.current.catch(() => undefined);
        const next = textRef.current;
        if (next === base.current && !force) return;
        // Fields that handle emptiness on blur never write a blank value mid-edit.
        if (!next.trim() && onBlurEmpty) return;
        const work = (async () => {
            try {
                await onCommit(next, base.current, force);
                base.current = next; setConflict(null); setError('');
            } catch (failure) {
                if (failure instanceof FieldConflict) setConflict(failure.latest);
                else setError(failure instanceof Error ? failure.message : String(failure));
                throw failure;
            }
        })();
        inFlight.current = work;
        try { await track(work); } finally { if (inFlight.current === work) inFlight.current = null; }
    };
    const quietCommit = () => commit().catch(() => undefined);
    useSaveListener(() => textRef.current !== base.current ? commit() : undefined);
    useEffect(() => () => { window.clearTimeout(timer.current); if (textRef.current !== base.current) void quietCommit(); }, []);
    useImperativeHandle(ref, () => ({
        focus: (at = 'end') => {
            const node = element.current;
            if (!node) return;
            node.focus();
            const position = at === 'start' ? 0 : node.value.length;
            node.setSelectionRange(position, position);
        },
        commit: () => commit(),
        element: () => element.current,
    }));
    const change = (next: string) => {
        const clean = singleLine ? next.replace(/\s*\n+\s*/g, ' ') : next;
        textRef.current = clean; setText(clean); setError('');
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void quietCommit(), 800);
    };
    return <div className="min-w-0 flex-1">
        <AutosizeTextarea ref={element} rows={1} minHeight={0} maxHeight={100000} value={text} disabled={disabled}
            aria-label={ariaLabel} placeholder={placeholder} spellCheck data-inline-edit={kind} {...dataAttributes}
            className={`block w-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent outline-none placeholder:text-muted-foreground/60 focus-visible:outline-none ${className}`}
            onFocus={() => { focused.current = true; }}
            onBlur={() => {
                focused.current = false;
                if (!textRef.current.trim() && onBlurEmpty) { window.clearTimeout(timer.current); onBlurEmpty(); return; }
                void quietCommit();
            }}
            onChange={event => change(event.target.value)}
            onKeyDown={event => {
                if (isInputComposition(event.nativeEvent)) return;
                const node = event.currentTarget;
                if (onKey?.(event, { text: node.value, caret: node.selectionStart === node.selectionEnd ? node.selectionStart : -1, commit: () => commit() })) return;
                if (event.key === 'Escape') { event.stopPropagation(); node.blur(); return; }
                if (singleLine && event.key === 'Enter') { event.preventDefault(); void quietCommit(); }
            }} />
        {after}
        {conflict !== null && <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs">
            <span className="min-w-0 break-words">{l('Changed on another device to', '其他设备已改为')}：{conflict || l('(empty)', '（空）')}</span>
            <button type="button" className="min-h-9 rounded px-2 underline" onClick={() => void commit(true).catch(() => undefined)}>{l('Keep mine', '保留我的')}</button>
            <button type="button" className="min-h-9 rounded px-2 underline" onClick={() => { base.current = conflict; textRef.current = conflict; setText(conflict); setConflict(null); }}>{l('Use theirs', '改用最新的')}</button>
        </div>}
        {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
    </div>;
});
