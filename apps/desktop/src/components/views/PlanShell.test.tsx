import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../contexts/language-context';
import { PlanShell } from './PlanShell';

describe('PlanShell', () => {
    it('keeps planning destinations in one stable secondary navigation', () => {
        const onNavigate = vi.fn();
        const { getByRole, getByText } = render(
            <LanguageProvider>
                <PlanShell activeSection="today" onNavigate={onNavigate}>
                    <div>Today body</div>
                </PlanShell>
            </LanguageProvider>
        );

        expect(getByText('Today body')).toBeInTheDocument();
        expect(getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');

        fireEvent.click(getByRole('button', { name: 'Calendar' }));
        fireEvent.click(getByRole('button', { name: 'Projects' }));
        fireEvent.click(getByRole('button', { name: 'Later' }));
        fireEvent.click(getByRole('button', { name: 'Recurring' }));

        expect(onNavigate.mock.calls.map(([view]) => view)).toEqual([
            'calendar',
            'projects',
            'waiting',
            'recurring',
        ]);
    });
});
