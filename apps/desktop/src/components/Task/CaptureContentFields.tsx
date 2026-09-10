import { useCallback, useId, useRef, useState } from 'react';
import { applyMarkdownToolbarAction, type Task } from '@mindwtr/core';
import { TaskContentSection } from './TaskContentSection';
import { ChecklistField } from './TaskForm/ChecklistField';
import { MarkdownFormatToolbar } from '../MarkdownFormatToolbar';
import { RichMarkdown } from '../RichMarkdown';
import { AutosizeTextarea } from '../ui/AutosizeTextarea';

export function CaptureContentFields({ t, description, checklist, onChange }: {
    t: (key: string) => string;
    description: string;
    checklist: Task['checklist'];
    onChange: (patch: Partial<Pick<Task, 'description' | 'checklist'>>) => void;
}) {
    const draftId = useId();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [preview, setPreview] = useState(false);
    const updateSteps = useCallback((_id: string, patch: Partial<Task>) => {
        onChange({ checklist: patch.checklist });
    }, [onChange]);
    return <TaskContentSection t={t} body={
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <label htmlFor={draftId} className="text-xs font-semibold">{t('taskEdit.descriptionLabel')}</label>
                <button type="button" className="min-h-11 px-2 text-xs text-muted-foreground" onClick={() => setPreview(!preview)}>
                    {t(preview ? 'markdown.edit' : 'markdown.preview')}
                </button>
            </div>
            {preview ? <RichMarkdown markdown={description} /> : <>
                <MarkdownFormatToolbar textareaRef={textareaRef} t={t} canUndo={false} onUndo={() => undefined}
                    onApplyAction={(action, selection) => {
                        const result = applyMarkdownToolbarAction(description, selection, action);
                        onChange({ description: result.value });
                        return result;
                    }} />
                <AutosizeTextarea id={draftId} ref={textareaRef} value={description}
                    onChange={(event) => onChange({ description: event.target.value })}
                    placeholder={t('taskEdit.descriptionPlaceholder')}
                    className="w-full min-h-28 rounded border border-border bg-muted/30 px-3 py-2 text-sm focus-visible:outline-primary"
                    maxHeight={240} />
            </>}
        </div>
    } steps={<ChecklistField draftOnly t={t} taskId={draftId} checklist={checklist} updateTask={updateSteps}
        resetTaskChecklist={() => onChange({ checklist: checklist?.map((item) => ({ ...item, isCompleted: false })) })} />} />;
}
