import { RESTORABLE_VIEWS } from './session-restore';
import { isQuickAddWindowLocation } from './quick-add-window';

// The current view lives in the URL — not just localStorage — so a link to a
// view opens it and a refresh keeps your place, including inside Settings,
// which the localStorage snapshot deliberately excludes as transient (#931).
// One name here, matching the calendar's own params (calendar-view-params.ts),
// so the reader and writer can never drift apart.
export const VIEW_URL_PARAM = 'view';

// Superset of the localStorage-restorable views: Settings and Obsidian are
// excluded from that snapshot as transient destinations, but a direct link to
// them must still work — the URL is a separate, explicit signal.
const URL_KNOWN_VIEWS = new Set([...RESTORABLE_VIEWS, 'settings', 'obsidian']);

const isKnownView = (view: string): boolean =>
    URL_KNOWN_VIEWS.has(view) || view.startsWith('savedSearch:');

export function readViewFromUrl(
    search: string = typeof window === 'undefined' ? '' : window.location.search,
): string | null {
    const view = new URLSearchParams(search).get(VIEW_URL_PARAM);
    if (!view || !isKnownView(view)) return null;
    return view;
}

export function writeViewToUrl(view: string, push = false): void {
    if (typeof window === 'undefined') return;
    // The quick-add window is its own small process, identified by its own
    // URL param (quickAddWindow) — it never renders the main view switcher
    // this is called from, but skip explicitly rather than rely on that.
    if (isQuickAddWindowLocation()) return;
    const url = new URL(window.location.href);
    url.searchParams.set(VIEW_URL_PARAM, view);
    if (push && readViewFromUrl() !== view) window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    else window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
