import { useCallback, useEffect, useRef } from 'react';
let pendingBack: Promise<void> | null = null;
function goBack(): void {
  pendingBack = new Promise(resolve => {
    const done = () => {
      clearTimeout(timeout);
      window.removeEventListener('popstate', done);
      pendingBack = null;
      resolve();
    };
    const timeout = window.setTimeout(done, 500);
    window.addEventListener('popstate', done);
    window.history.back();
  });
}
/** A modal owns one history entry; rapid reopen waits for the previous pop to settle. */
export function useDialogHistory(open: boolean, tryClose: (force?: boolean) => boolean, taskId?: string) {
  const closeRef = useRef(tryClose);
  closeRef.current = tryClose;
  const marker = useRef<string | null>(null),
    leaving = useRef(false);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    leaving.current = false;
    const id = crypto.randomUUID();
    marker.current = id;
    let url: URL;
    let state: Record<string, unknown>;
    const pop = () => {
      if (window.history.state?.apSurface === id || leaving.current) return;
      if (closeRef.current()) leaving.current = true;else window.history.pushState(state, '', url);
    };
    const start = () => {
      if (disposed) return;
      const source = new URL(window.location.href);
      source.searchParams.delete('task');
      // Direct task links get a genuine parent URL for their first Back.
      if (!window.history.state?.apSurface && new URL(location.href).searchParams.has('task')) window.history.replaceState(window.history.state, '', source);
      url = new URL(source);
      if (taskId) url.searchParams.set('task', taskId);
      state = {
        ...window.history.state,
        apSurface: id
      };
      window.history.pushState(state, '', url);
      window.addEventListener('popstate', pop);
    };
    if (pendingBack) void pendingBack.then(start);else start();
    return () => {
      disposed = true;
      window.removeEventListener('popstate', pop);
      if (!leaving.current && window.history.state?.apSurface === id) {
        leaving.current = true;
        goBack();
      }
    };
  }, [open, taskId]);
  return useCallback((force = false) => {
    if (!closeRef.current(force)) return;
    leaving.current = true;
    if (window.history.state?.apSurface === marker.current) goBack();
  }, []);
}
