import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarEventDetails } from './CalendarEventDetails';
vi.mock('../../contexts/language-context', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('./useDialogHistory', () => ({ useDialogHistory: (_open: boolean, close: () => void) => close }));
afterEach(cleanup);
describe('external calendar details', () => {
    const event = { id: 'a', sourceId: 'outlook', title: 'Research meeting', start: '2026-09-20T13:00:00Z', end: '2026-09-20T14:00:00Z', allDay: false, location: 'Room 401\nScience Building', description: '<script>not executable</script>\nBring notes' };
    it('shows full location and description as safe read-only text with keyboard dismissal', () => {
        const onClose = vi.fn();
        render(<CalendarEventDetails event={event} onClose={onClose} />);
        expect(screen.getByRole('dialog', { name: event.title })).toBeInTheDocument();
        expect(screen.getByText(/Room 401/)).toHaveTextContent('Science Building');
        expect(screen.getByText(/not executable/)).toHaveTextContent('<script>not executable</script>');
        expect(document.querySelector('script')).toBeNull();
        expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });
    it('explains missing location and displays an inclusive all-day end date', () => {
        render(<CalendarEventDetails event={{ ...event, location: '', allDay: true, start: new Date(2026, 8, 20).toISOString(), end: new Date(2026, 8, 21).toISOString() }} onClose={vi.fn()} />);
        expect(screen.getByText('No location provided')).toBeInTheDocument();
        expect(screen.getByText(/All day/)).toHaveTextContent('9/20/2026 – 9/20/2026');
    });
});
