import { createRef } from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../contexts/language-context';
import { TaskItemEditorSurface } from './TaskItemEditorSurface';

afterEach(cleanup);
function setup(isModalEditor: boolean, isEditing = true) {
    const onCancel = vi.fn();
    const ref = createRef<HTMLDivElement>();
    render(<LanguageProvider><TaskItemEditorSurface
        editorAriaLabel="Edit task" isEditing={isEditing} isModalEditor={isModalEditor}
        modalEditorRef={ref} onCancel={onCancel}
        getModalFocusableElements={() => Array.from(ref.current?.querySelectorAll<HTMLElement>('button,input') ?? [])}
        renderDisplay={() => <span>Task row</span>}
        renderEditor={() => <input aria-label="Task name" defaultValue="Laundry" />}
    /></LanguageProvider>);
    return onCancel;
}
describe('editor exit surface', () => {
    it.each([false, true])('exposes a top close control (modal=%s)', modal => {
        const cancel = setup(modal);
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(cancel).toHaveBeenCalledOnce();
    });
    it('does not render editing controls on a closed row', () => {
        setup(false, false);
        expect(screen.getByText('Task row')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });
    it('routes Escape through the same guarded close callback', () => {
        const cancel = setup(true);
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        expect(cancel).toHaveBeenCalledOnce();
    });
    it('does not cancel on a click inside the dialog', () => {
        const cancel = setup(true);
        fireEvent.mouseDown(screen.getByRole('textbox'));
        expect(cancel).not.toHaveBeenCalled();
        fireEvent.mouseDown(screen.getByRole('dialog'));
        expect(cancel).toHaveBeenCalledOnce();
    });
});
