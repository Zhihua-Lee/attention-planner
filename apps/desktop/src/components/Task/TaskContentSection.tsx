import { useState, type ReactNode } from 'react';

/** Shared content hierarchy for both capture drafts and existing tasks. */
export function TaskContentSection({ t, body, steps, checklist = [] }: {
    t: (key: string) => string;
    body: ReactNode;
    steps?: ReactNode;
    checklist?: { isCompleted: boolean }[];
}) {
    const [expanded, setExpanded] = useState<boolean | undefined>();
    return (
        <section aria-label={t('taskEdit.descriptionLabel')} className="space-y-3">
            {body}
            {steps && (
                <details open={expanded ?? checklist.length > 0} className="border-t border-border/50 pt-2">
                    <summary onClick={event => { event.preventDefault(); setExpanded(!(expanded ?? checklist.length > 0)); }} className="min-h-11 cursor-pointer py-3 text-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                        {t('taskEdit.checklist')}
                        {checklist.length > 0 && <span className="ml-2 tabular-nums">{checklist.filter(item => item.isCompleted).length}/{checklist.length}</span>}
                    </summary>
                    {steps}
                </details>
            )}
        </section>
    );
}
