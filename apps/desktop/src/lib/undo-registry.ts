// Holds the most recent undoable action (task completion or deletion) so
// Ctrl/Cmd+Z can trigger the same restore the undo toast offers. Registration
// is independent of whether the toast is shown, and both the toast button and
// the keyboard shortcut run the same closure, so undoing twice is a no-op.
let lastUndoableAction: (() => void) | null = null;

export function registerUndoableAction(action: () => void): () => void {
    let consumed = false;
    const run = () => {
        if (consumed) return;
        consumed = true;
        if (lastUndoableAction === run) lastUndoableAction = null;
        action();
    };
    lastUndoableAction = run;
    return run;
}

export function takeUndoableAction(): (() => void) | null {
    const action = lastUndoableAction;
    lastUndoableAction = null;
    return action;
}

export function clearUndoableAction(): void {
    lastUndoableAction = null;
}
