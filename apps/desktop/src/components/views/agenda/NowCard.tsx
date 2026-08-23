import { useMemo, useState } from 'react';
import { CalendarClock, Check, ChevronDown, ChevronUp, Clock3, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
    generateUUID,
    normalizeAttentionFrames,
    type AttentionFrame,
    type AttentionFrameDay,
    type NowSelection,
} from '@mindwtr/core';

type ResolveText = (key: string, fallback: string) => string;

type NowCardProps = {
    activeFrame: AttentionFrame | null;
    frames: AttentionFrame[];
    inboxCount: number;
    now: Date;
    onCompleteTask: (taskId: string) => void;
    onFramesChange: (frames: AttentionFrame[]) => void;
    onSkipTask: (taskId: string) => void;
    onSnoozeTask: (taskId: string) => void;
    resolveText: ResolveText;
    selection: NowSelection | null;
};

type DayPreset = 'weekdays' | 'weekend' | 'everyday';

const DAY_PRESETS: Record<DayPreset, AttentionFrameDay[]> = {
    weekdays: [1, 2, 3, 4, 5],
    weekend: [0, 6],
    everyday: [0, 1, 2, 3, 4, 5, 6],
};

const formatClock = (date: Date): string => date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
});

function selectionLabel(selection: NowSelection | null, resolveText: ResolveText): string {
    if (!selection) return resolveText('attention.now.clear', 'Nothing is demanding your attention right now');
    switch (selection.reason) {
        case 'calendar-event': return resolveText('attention.now.meeting', 'Current calendar event');
        case 'scheduled': return resolveText('attention.now.scheduled', 'Scheduled now');
        case 'focused': return resolveText('attention.now.focused', "Today's focus");
        case 'frame': return selection.frame?.name ?? resolveText('attention.now.frame', 'Current frame');
        default: return resolveText('attention.now.next', 'Next clear action');
    }
}

function AttentionFrameEditor({
    frames,
    onFramesChange,
    resolveText,
}: Pick<NowCardProps, 'frames' | 'onFramesChange' | 'resolveText'>) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [startTime, setStartTime] = useState('09:30');
    const [endTime, setEndTime] = useState('12:00');
    const [token, setToken] = useState('');
    const [dayPreset, setDayPreset] = useState<DayPreset>('weekdays');

    const addFrame = () => {
        const trimmedName = name.trim();
        if (!trimmedName || startTime === endTime) return;
        const trimmedToken = token.trim().toLocaleLowerCase();
        onFramesChange(normalizeAttentionFrames([
            ...frames,
            {
                id: generateUUID(),
                name: trimmedName,
                startTime,
                endTime,
                days: DAY_PRESETS[dayPreset],
                matchTokens: trimmedToken ? [trimmedToken] : undefined,
            },
        ]));
        setName('');
        setToken('');
    };

    return (
        <div className="border-t border-border/50 pt-3">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                aria-expanded={open}
            >
                {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {resolveText('attention.frames.manage', 'Manage flexible frames')}
            </button>
            {open && (
                <div className="mt-3 space-y-3">
                    {frames.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {frames.map((item) => (
                                <div key={item.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1.5 text-xs">
                                    <button
                                        type="button"
                                        className={item.enabled === false ? 'text-muted-foreground line-through' : 'font-medium'}
                                        onClick={() => onFramesChange(frames.map((candidate) => (
                                            candidate.id === item.id ? { ...candidate, enabled: candidate.enabled !== false ? false : undefined } : candidate
                                        )))}
                                        title={resolveText('attention.frames.toggle', 'Enable or disable frame')}
                                    >
                                        {item.name} · {item.startTime}–{item.endTime}
                                        {item.matchTokens?.length ? ` · ${item.matchTokens.join(', ')}` : ''}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onFramesChange(frames.filter((candidate) => candidate.id !== item.id))}
                                        aria-label={`${resolveText('common.delete', 'Delete')} ${item.name}`}
                                        className="text-muted-foreground hover:text-destructive"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="grid gap-2 md:grid-cols-[minmax(9rem,1.3fr)_7rem_7rem_8rem_minmax(8rem,1fr)_auto]">
                        <input
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder={resolveText('attention.frames.name', 'Frame name')}
                            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                        />
                        <input
                            type="time"
                            value={startTime}
                            onChange={(event) => setStartTime(event.target.value)}
                            aria-label={resolveText('attention.frames.start', 'Start time')}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        />
                        <input
                            type="time"
                            value={endTime}
                            onChange={(event) => setEndTime(event.target.value)}
                            aria-label={resolveText('attention.frames.end', 'End time')}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        />
                        <select
                            value={dayPreset}
                            onChange={(event) => setDayPreset(event.target.value as DayPreset)}
                            aria-label={resolveText('attention.frames.days', 'Days')}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        >
                            <option value="weekdays">{resolveText('attention.frames.weekdays', 'Weekdays')}</option>
                            <option value="weekend">{resolveText('attention.frames.weekend', 'Weekend')}</option>
                            <option value="everyday">{resolveText('attention.frames.everyday', 'Every day')}</option>
                        </select>
                        <input
                            value={token}
                            onChange={(event) => setToken(event.target.value)}
                            placeholder={resolveText('attention.frames.token', '@context or #tag')}
                            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                        />
                        <button
                            type="button"
                            onClick={addFrame}
                            disabled={!name.trim() || startTime === endTime}
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Plus className="h-4 w-4" />
                            {resolveText('common.add', 'Add')}
                        </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {resolveText('attention.frames.help', 'A frame sets the kind of work that fits this time; it does not fill every minute.')}
                    </p>
                </div>
            )}
        </div>
    );
}

export function NowCard({
    activeFrame,
    frames,
    inboxCount,
    now,
    onCompleteTask,
    onFramesChange,
    onSkipTask,
    onSnoozeTask,
    resolveText,
    selection,
}: NowCardProps) {
    const eventEnd = useMemo(() => {
        if (!selection || selection.kind !== 'event') return null;
        const parsed = new Date(selection.event.end);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }, [selection]);

    return (
        <section className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm" data-testid="now-card">
            <div className="p-5 md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <Clock3 className="h-4 w-4" />
                            {resolveText('attention.now.title', 'NOW')}
                            <span className="font-normal normal-case tracking-normal text-muted-foreground">{formatClock(now)}</span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{selectionLabel(selection, resolveText)}</p>
                    </div>
                    {activeFrame && (
                        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                            {activeFrame.name} · {activeFrame.startTime}–{activeFrame.endTime}
                        </span>
                    )}
                </div>

                {selection?.kind === 'event' ? (
                    <div className="mt-4 flex items-start gap-3">
                        <CalendarClock className="mt-1 h-5 w-5 shrink-0 text-primary" />
                        <div>
                            <h3 className="text-xl font-semibold text-foreground">{selection.event.title}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {eventEnd ? `${resolveText('attention.now.until', 'Until')} ${formatClock(eventEnd)}` : resolveText('attention.now.inProgress', 'In progress')}
                                {selection.event.location ? ` · ${selection.event.location}` : ''}
                            </p>
                        </div>
                    </div>
                ) : selection?.kind === 'task' ? (
                    <div className="mt-4">
                        <h3 className="text-2xl font-semibold leading-tight text-foreground">→ {selection.task.title}</h3>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => onCompleteTask(selection.task.id)}
                                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                            >
                                <Check className="h-4 w-4" />
                                {resolveText('common.done', 'Done')}
                            </button>
                            <button
                                type="button"
                                onClick={() => onSnoozeTask(selection.task.id)}
                                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background/70 px-3 text-sm font-medium hover:bg-muted"
                            >
                                <Clock3 className="h-4 w-4" />
                                {resolveText('attention.now.snooze', 'Later · 30 min')}
                            </button>
                            <button
                                type="button"
                                onClick={() => onSkipTask(selection.task.id)}
                                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background/70 px-3 text-sm font-medium hover:bg-muted"
                            >
                                <RefreshCw className="h-4 w-4" />
                                {resolveText('attention.now.another', 'Show another')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="mt-4 rounded-xl border border-dashed border-border bg-background/40 px-4 py-5">
                        <p className="font-medium text-foreground">
                            {activeFrame
                                ? resolveText('attention.now.noFrameTask', 'No executable task matches this frame yet.')
                                : resolveText('attention.now.clearBody', 'You can rest, capture a thought, or choose a frame for this time.')}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {inboxCount > 0
                                ? `${inboxCount} ${resolveText('attention.now.inboxWaiting', 'items are safely waiting in Inbox; you do not need to sort them now.')}`
                                : resolveText('attention.now.inboxEmpty', 'Inbox is clear.')}
                        </p>
                    </div>
                )}
            </div>
            <div className="bg-background/35 px-5 pb-5 md:px-6 md:pb-6">
                <AttentionFrameEditor frames={frames} onFramesChange={onFramesChange} resolveText={resolveText} />
            </div>
        </section>
    );
}
