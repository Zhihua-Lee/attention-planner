import type { ReactNode } from 'react';

/** Shared content hierarchy for both capture drafts and existing tasks. */
export function TaskContentSection({ t, body, steps }: {
    t: (key: string) => string;
    body: ReactNode;
    steps?: ReactNode;
}) {
    return (
        <section aria-label={t('taskEdit.descriptionLabel')} className="space-y-3">
            {body}
            {steps && (
                <details className="border-t border-border/50 pt-2">
                    <summary className="min-h-11 cursor-pointer py-3 text-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                        {t('taskEdit.checklist')}
                    </summary>
                    {steps}
                </details>
            )}
        </section>
    );
}
