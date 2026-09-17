import { useEffect, useState } from 'react';
import { PlainCaptureSheet } from './PlainCaptureSheet';

export const QUICK_CAPTURE_EVENT = 'attention-planner:plain-capture';
export const LEGACY_CAPTURE_EVENT = 'mindwtr:quick-add';

// Give guided capture its own explicit entry point. Listening to the legacy
// Window event and trying to stop its other listeners opened both dialogs in
// Chromium, despite passing the isolated DOM test. Legacy contextual/audio/import
// capture remains untouched; only the workspace's plain Add action uses this host.
export function PwaCaptureHost() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const receive = () => {
            if (document.querySelector('[role="dialog"]:not([data-testid="plain-capture-sheet"])')) return;
            setOpen(true);
        };
        window.addEventListener(QUICK_CAPTURE_EVENT, receive);
        return () => window.removeEventListener(QUICK_CAPTURE_EVENT, receive);
    }, []);
    return <PlainCaptureSheet isOpen={open} onClose={() => setOpen(false)} onAdvanced={() => {
        setOpen(false);
        window.dispatchEvent(new CustomEvent(LEGACY_CAPTURE_EVENT, { detail: { captureMode: 'text' } }));
    }} />;
}
