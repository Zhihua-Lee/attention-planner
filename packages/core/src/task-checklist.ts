import type { Task } from './types';

/** Clean an explicit save, not the editor draft: an empty row is still useful while typing. */
export function checklistForSave(checklist: Task['checklist']): Task['checklist'] {
    const items = checklist?.filter(item => item.title.trim().length > 0);
    // Keep real item IDs, completion and Markdown whitespace exactly as entered.
    return items?.length ? items : undefined;
}
