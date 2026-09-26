import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TaskContentSection } from './TaskContentSection';
afterEach(cleanup);
const props = { t: (key: string) => key, body: <div>Body</div>, steps: <input aria-label="Step" /> };
it('opens populated steps, shows progress, and respects deliberate collapse across edits', () => {
    const view = render(<TaskContentSection {...props} checklist={[{ isCompleted: false }]} />);
    const details = screen.getByLabelText('Step').closest('details')!;
    expect(details.open).toBe(true);
    expect(details).toHaveTextContent('0/1');
    fireEvent.click(details.querySelector('summary')!);
    view.rerender(<TaskContentSection {...props} checklist={[{ isCompleted: true }, { isCompleted: false }]} />);
    expect(details.open).toBe(false);
    expect(details).toHaveTextContent('1/2');
    fireEvent.click(details.querySelector('summary')!);
    expect(details.open).toBe(true);
});
it('starts empty collapsed and opens when restored content arrives', () => {
    const view = render(<TaskContentSection {...props} />);
    const details = screen.getByLabelText('Step').closest('details')!;
    expect(details.open).toBe(false);
    view.rerender(<TaskContentSection {...props} checklist={[{ isCompleted: false }]} />);
    expect(details.open).toBe(true);
});
