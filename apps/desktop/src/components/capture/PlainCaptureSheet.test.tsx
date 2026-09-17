import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Area, Project } from '@mindwtr/core';
import { PlainCaptureSheet } from './PlainCaptureSheet';
import { PwaCaptureHost, QUICK_CAPTURE_EVENT, LEGACY_CAPTURE_EVENT } from './PwaCaptureHost';

const mocks = vi.hoisted(() => {
    const addTask = vi.fn();
    return {
        addTask,
        showToast: vi.fn(),
        navigate: vi.fn(),
        state: {
            addTask,
            projects: [] as Project[],
            areas: [] as Area[],
            tasks: [], _allTasks: [],
            settings: { gtd: { defaultCaptureMethod: 'text' } },
            setHighlightTask: vi.fn(),
        },
    };
});
vi.mock('@mindwtr/core', async (importOriginal) => ({
    ...await importOriginal<typeof import('@mindwtr/core')>(),
    flushPendingSave: vi.fn().mockResolvedValue(undefined),
    shallow: Object.is,
    useTaskStore: Object.assign(
        <T,>(selector: (state: typeof mocks.state) => T) => selector(mocks.state),
        { getState: () => mocks.state },
    ),
}));
vi.mock('../../contexts/language-context', () => ({
    useLanguage: () => ({ language: 'en', t: (key: string) => key === 'common.close' ? 'Close' : key }),
}));
vi.mock('../../store/ui-store', () => ({
    useUiStore: <T,>(selector: (state: { showToast: typeof mocks.showToast }) => T) => selector({ showToast: mocks.showToast }),
}));
vi.mock('../../lib/navigation-events', () => ({ dispatchNavigateEvent: (...args: unknown[]) => mocks.navigate(...args) }));

vi.mock('../../lib/lifecycle-actions', () => ({ensurePlannerBackup: vi.fn().mockResolvedValue(undefined),plannerClock:()=>({now:new Date('2026-09-17T12:00:00Z'),deviceId:'test'}),checkReservation:vi.fn()}));
vi.mock('../planner/usePlannerEnvironment',()=>({usePlannerEnvironment:()=>({events:[],loaded:true,calendarError:null,showDate:()=>{}})}));

beforeEach(() => {
    localStorage.clear();
    mocks.addTask.mockReset();
    mocks.addTask.mockResolvedValue({ success: true, id: 'created-task' });
    mocks.showToast.mockClear();
    mocks.navigate.mockClear();
    mocks.state.projects = [];
    mocks.state.areas = [];
    mocks.state.settings.gtd.defaultCaptureMethod = 'text';
});
afterEach(cleanup);

const fillTitle = (title = 'Laundry') => fireEvent.change(screen.getByLabelText('What do you need to do?'), { target: { value: title } });
const openHost = () => act(() => { window.dispatchEvent(new CustomEvent(QUICK_CAPTURE_EVENT)); });

describe('plain capture interaction', () => {
    it('adds literal text without syntax parsing or mandatory metadata', async () => {
        const onClose = vi.fn();
        render(<PlainCaptureSheet isOpen onClose={onClose} />);
        fillTitle('Read C++ @home #1 /done');
        fireEvent.click(screen.getByRole('button', { name: 'Add to Inbox' }));
        await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
        expect(mocks.addTask).toHaveBeenCalledWith('Read C++ @home #1 /done', expect.objectContaining({ status: 'inbox', description: undefined, planner:{version:1,blocks:[],days:[]} }));
    });
    it('keeps a failed submission editable rather than closing or resetting it', async () => {
        mocks.addTask.mockResolvedValue({ success: false, error: 'Storage unavailable' });
        const onClose = vi.fn();
        render(<PlainCaptureSheet isOpen onClose={onClose} />);
        fillTitle();
        fireEvent.click(screen.getByRole('button', { name: 'Add to Inbox' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
        expect(screen.getByLabelText('What do you need to do?')).toHaveValue('Laundry');
        expect(onClose).not.toHaveBeenCalled();
    });
    it('guards concurrent submissions', async () => {
        let resolve!: (result: { success: boolean; id: string }) => void;
        mocks.addTask.mockImplementation(() => new Promise(result => { resolve = result; }));
        render(<PlainCaptureSheet isOpen onClose={vi.fn()} />);
        fillTitle();
        const form = screen.getByLabelText('What do you need to do?').closest('form')!;
        fireEvent.submit(form);
        fireEvent.submit(form);
        await waitFor(()=>expect(mocks.addTask).toHaveBeenCalledOnce());
        await act(async () => resolve({ success: true, id: 'created-task' }));
    });
    it('does not submit during IME composition', () => {
        render(<PlainCaptureSheet isOpen onClose={vi.fn()} />);
        fillTitle();
        fireEvent.keyDown(screen.getByLabelText('What do you need to do?'), { key: 'Enter', isComposing: true });
        expect(mocks.addTask).not.toHaveBeenCalled();
    });
    it('uses separate controls for a reservation and deadline', async () => {
        render(<PlainCaptureSheet isOpen onClose={vi.fn()} />);
        fillTitle();
        fireEvent.click(screen.getByText('When?'));
        fireEvent.change(screen.getByLabelText('Reserve a time'), { target: { value: '2026-09-18T09:30' } });
        fireEvent.change(screen.getByLabelText('Must finish by'), { target: { value: '2026-09-20' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
        await waitFor(() => expect(mocks.addTask).toHaveBeenCalledOnce());
        const props=mocks.addTask.mock.calls[0][1];
        expect(props.status).toBe('next');expect(props.dueDate).toBe('2026-09-20');
        expect(props.scheduledAt).toBeUndefined();
        expect(props.planner.blocks).toHaveLength(1);
        expect(props.planner.blocks[0].startAt).toBe(new Date(2026,8,18,9,30).toISOString());
    });
    it('preserves note indentation', async () => {
        render(<PlainCaptureSheet isOpen onClose={vi.fn()} />);
        fillTitle();
        fireEvent.click(screen.getByText('Content and steps'));
        const description = '    indented code\n\n- one\n  - nested\n';
        fireEvent.change(screen.getByRole('textbox', {name:'taskEdit.descriptionLabel'}), { target: { value: description } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to Inbox' }));
        await waitFor(() => expect(mocks.addTask).toHaveBeenCalledOnce());
        expect(mocks.addTask).toHaveBeenCalledWith('Laundry', expect.objectContaining({ status: 'inbox', description }));
    });
    it('closes without creating a task and restores the draft when reopened', () => {
        render(<PwaCaptureHost />);
        openHost();
        fillTitle('Unfinished thought');
        fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mocks.addTask).not.toHaveBeenCalled();
        openHost();
        expect(screen.getByLabelText('What do you need to do?')).toHaveValue('Unfinished thought');
    });
    it('never dispatches a legacy request when plain capture opens or closes', () => {
        const legacy = vi.fn();
        window.addEventListener(LEGACY_CAPTURE_EVENT, legacy);
        try {
            render(<PwaCaptureHost />);
            openHost();
            expect(screen.getAllByRole('dialog')).toHaveLength(1);
            fillTitle();
            fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            openHost();
            expect(screen.getAllByRole('dialog')).toHaveLength(1);
            expect(legacy).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener(LEGACY_CAPTURE_EVENT, legacy);
        }
    });
    it('hands advanced capture explicitly to the existing host', () => {
        const legacy = vi.fn();
        window.addEventListener(LEGACY_CAPTURE_EVENT, legacy);
        try {
            render(<PwaCaptureHost />);
            openHost();
            fireEvent.click(screen.getByRole('button', { name: /Advanced capture/ }));
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(legacy).toHaveBeenCalledOnce();
            expect(mocks.addTask).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener(LEGACY_CAPTURE_EVENT, legacy);
        }
    });
});
