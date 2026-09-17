import type { ComponentProps } from 'react';
import { useTaskStore } from '@mindwtr/core';
import { NowCard as LegacyNowCard } from './LegacyNowCard';
import { RichMarkdown } from '../../RichMarkdown';
import { useUiStore } from '../../../store/ui-store';

export { AttentionFrameEditor } from './LegacyNowCard';
type NowCardProps = ComponentProps<typeof LegacyNowCard>;

// Execution keeps the task's context at hand, without opening the metadata
// editor or navigating away from NOW. Checking a step is not task completion.
export function NowCard(props: NowCardProps) {
    const task = props.selection?.kind === 'task' ? props.selection.task : null;
    const steps = task?.checklist ?? [];
    const hasContext = Boolean(task?.description?.trim() || steps.length);
    const toggleStep = async (stepId: string) => {
        if (!task) return;
        const store = useTaskStore.getState();
        const current = store.tasks.find(candidate => candidate.id === task.id);
        if (!current || current.deletedAt || ['done', 'archived', 'reference'].includes(current.status)) return;
        if (!current.checklist?.some(step => step.id === stepId)) return;
        try {
            const result = await store.updateTask(current.id, {
                checklist: current.checklist.map(step => step.id === stepId ? { ...step, isCompleted: !step.isCompleted } : step),
            });
            if (!result.success) throw new Error(result.error || 'Step update failed');
        } catch {
            useUiStore.getState().showToast(props.resolveText('common.saveFailed', 'Could not save this step. Please try again.'), 'error');
        }
    };
    return <>
        <LegacyNowCard {...props} />
        {task && hasContext && <details key={task.id} className="mt-3 rounded-xl border border-border bg-card px-4 py-2" data-testid="now-task-context">
            <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">
                {props.resolveText('taskEdit.details', 'Details')}
                {steps.length > 0 && <span className="ml-2 font-mono text-xs text-muted-foreground">{steps.filter(step => step.isCompleted).length}/{steps.length}</span>}
            </summary>
            {task.description && <div className="my-3 min-w-0 break-words"><RichMarkdown markdown={task.description} /></div>}
            {steps.length > 0 && <ul className="my-2 divide-y divide-border/40">
                {steps.map(step => <li key={step.id}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-3 text-sm">
                        <input type="checkbox" checked={step.isCompleted} onChange={() => void toggleStep(step.id)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
                        <span className={step.isCompleted ? 'break-words text-muted-foreground line-through' : 'break-words'}>{step.title}</span>
                    </label>
                </li>)}
            </ul>}
        </details>}
    </>;
}
