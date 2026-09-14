import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useUiStore } from '../store/ui-store';
import { LanguageProvider } from '../contexts/language-context';
import { ToastHost } from './ToastHost';

describe('ToastHost recovery', () => {
    afterEach(() => {
        useUiStore.getState().toasts.forEach(toast => useUiStore.getState().dismissToast(toast.id));
        vi.useRealTimers();
    });
    it('keeps an actionable toast for at least 12 seconds and dismisses it after undo', () => {
        vi.useFakeTimers();
        const undo = vi.fn();
        useUiStore.getState().showToast('Task completed', 'info', 5000, { label: 'Undo', onClick: undo });
        render(<LanguageProvider><ToastHost /></LanguageProvider>);
        act(() => vi.advanceTimersByTime(11000));
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(undo).toHaveBeenCalledOnce();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
    it('expires an unclicked action after 12 seconds', () => {
        vi.useFakeTimers();
        useUiStore.getState().showToast('Task completed', 'info', 5000, { label: 'Undo', onClick: vi.fn() });
        act(() => vi.advanceTimersByTime(12000));
        expect(useUiStore.getState().toasts).toHaveLength(0);
    });
});
