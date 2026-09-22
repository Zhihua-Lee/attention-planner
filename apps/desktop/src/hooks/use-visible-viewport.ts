import { useEffect, useState, type CSSProperties } from 'react';

/** Keep form actions above the software keyboard without disabling pinch zoom.
 * https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
 */
export function useVisibleViewport(open = true): CSSProperties | undefined {
    const read = () => {
        const viewport = window.visualViewport;
        return viewport && viewport.scale === 1 && viewport.height > 0
            ? { top: viewport.offsetTop, height: viewport.height, bottom: 'auto' as const }
            : undefined;
    };
    const [bounds, setBounds] = useState(read);
    useEffect(() => {
        if (!open) return;
        const update = () => setBounds(read());
        update();
        window.visualViewport?.addEventListener('resize', update);
        window.visualViewport?.addEventListener('scroll', update);
        window.addEventListener('resize', update);
        return () => {
            window.visualViewport?.removeEventListener('resize', update);
            window.visualViewport?.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
        };
    }, [open]);
    return bounds;
}
