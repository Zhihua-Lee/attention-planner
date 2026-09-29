import { useEffect, useRef } from 'react';
import { flushPendingSave } from '@mindwtr/core';

/**
 * Ctrl/Cmd+S: every editing surface commits what it holds, then storage is flushed.
 * It never falls through to the browser's "Save page".
 */
export const SAVE_EVENT = 'attention-planner:save';
/** A listener pushes its commit and sets `announced` when it shows its own feedback. `reason` tells an explicit
 * Ctrl/Cmd+S apart from leaving a page, which only commits text still being typed. */
export type SaveReason = 'shortcut' | 'leave';
export type SaveRequest = { pending: Promise<unknown>[]; announced: boolean; reason: SaveReason };
export type SaveOutcome = { ok: boolean; announced: boolean };

export function isSaveShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) {
    return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's';
}

/** Ask every registered surface to commit, then flush. */
export async function requestSave(reason: SaveReason = 'shortcut'): Promise<SaveOutcome> {
    const request: SaveRequest = { pending: [], announced: false, reason };
    window.dispatchEvent(new CustomEvent<SaveRequest>(SAVE_EVENT, { detail: request }));
    const results = await Promise.allSettled(request.pending);
    await flushPendingSave();
    return { ok: results.every(result => result.status === 'fulfilled'), announced: request.announced };
}

/** Register a commit for the save shortcut. Return `{ announced: true }` from `commit` to suppress the generic notice. */
export function useSaveListener(commit: (reason: SaveReason) => Promise<unknown> | { announced: true } | void, enabled = true) {
    const latest = useRef(commit);
    latest.current = commit;
    useEffect(() => {
        if (!enabled) return;
        const listener = (event: Event) => {
            const request = (event as CustomEvent<SaveRequest>).detail, result = latest.current(request.reason);
            if (result && 'announced' in result) request.announced = true;
            else if (result) request.pending.push(result);
        };
        window.addEventListener(SAVE_EVENT, listener);
        return () => window.removeEventListener(SAVE_EVENT, listener);
    }, [enabled]);
}

/** Installed once for the planner shell. `skip` lets another binding (e.g. Emacs-style search) keep the key. */
export function useSaveShortcut(onDone: (outcome: SaveOutcome) => void, skip: (event: KeyboardEvent) => boolean = () => false) {
    const done = useRef(onDone), skipRef = useRef(skip);
    done.current = onDone; skipRef.current = skip;
    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            if (!isSaveShortcut(event) || event.isComposing || skipRef.current(event)) return;
            event.preventDefault();
            void requestSave().then(outcome => done.current(outcome), () => done.current({ ok: false, announced: false }));
        };
        // Capture phase, so neither a focused field nor the browser handles it first.
        window.addEventListener('keydown', keydown, true);
        return () => window.removeEventListener('keydown', keydown, true);
    }, []);
}
