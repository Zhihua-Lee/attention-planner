import { useMemo, useState, type ReactNode } from 'react';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDndContext, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { taskParentError, taskTreeRows, useTaskStore, type Task } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { moveTaskWithUndo } from '../../lib/move-task-with-undo';
import { openTaskDetails } from '../../lib/lifecycle-actions';
import { useUiStore } from '../../store/ui-store';
import { TaskMovePicker } from './TaskMovePicker';

export function TaskHierarchyDrag({ children }: { children: ReactNode }) {
    const { language } = useLanguage(), zh = language.startsWith('zh');
    const [dragged, setDragged] = useState<Task | null>(null);
    const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }));
    return <DndContext accessibility={{ screenReaderInstructions: { draggable: zh ? '拖动把手可移入其他任务；按回车或空格可打开移动任务选择器。' : 'Drag this handle onto another task, or press Enter or Space to choose a parent.' } }} sensors={sensors} collisionDetection={pointerWithin} onDragStart={({ active }) => setDragged(active.data.current?.task ?? null)} onDragCancel={() => setDragged(null)} onDragEnd={({ active, over }) => {
        setDragged(null);
        const source = active.data.current?.task as Task | undefined;
        const parent = over?.data.current?.task as Task | undefined;
        if (!source || !parent || source.id === parent.id) return;
        void moveTaskWithUndo(source.id, parent.id, zh).catch(error => useUiStore.getState().showToast(error instanceof Error ? error.message : String(error), 'error'));
    }}>
        {children}
        <DragOverlay dropAnimation={null}>{dragged ? <div className="max-w-xs rounded-lg border border-primary bg-card p-3 text-sm text-foreground shadow-xl">{dragged.title}<p className="mt-1 text-xs text-muted-foreground">{zh ? '放到任务上，成为独立子任务' : 'Drop on a task to make an independent subtask'}</p></div> : null}</DragOverlay>
    </DndContext>;
}

export function TaskTreeList({ tasks, render, listId }: { tasks: Task[]; render: (task: Task) => ReactNode; listId: string }) {
    const rows = useMemo(() => taskTreeRows(tasks), [tasks]);
    return <div className="space-y-2" data-task-tree={listId}>{rows.map(({ task, depth }) => <TaskTreeCard key={task.id} task={task} depth={depth} listId={listId}>{render(task)}</TaskTreeCard>)}</div>;
}

function TaskTreeCard({ task, depth, listId, children }: { task: Task; depth: number; listId: string; children: ReactNode }) {
    const { language } = useLanguage(), zh = language.startsWith('zh');
    const tasks = useTaskStore(state => state.tasks);
    const [moving, setMoving] = useState(false);
    const { active } = useDndContext();
    const source = active?.data.current?.task as Task | undefined;
    const invalid = useMemo(() => !!source && !!taskParentError(tasks, source.id, task.id), [tasks, source?.id, task.id]);
    const id = `${listId}:${task.id}`;
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id, data: { task } });
    const drop = useDroppable({ id, data: { task }, disabled: invalid });
    const parent = useMemo(() => tasks.find(candidate => candidate.id === task.parentTaskId), [tasks, task.parentTaskId]);
    return <div ref={node => { setNodeRef(node); drop.setNodeRef(node); }} data-tree-task={task.id} data-tree-depth={depth} className={`relative min-w-0 rounded-lg ${isDragging ? 'opacity-40' : ''} ${drop.isOver ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`} style={{ marginInlineStart: Math.min(depth, 3) * 12 }}>
        {parent && <button className="mb-1 min-h-11 max-w-full break-words px-1 text-left text-xs text-muted-foreground underline" onClick={() => openTaskDetails(parent.id)}>{zh ? '属于' : 'In'}：{parent.title}</button>}
        <div className="relative">
            {children}
            <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`${zh ? '拖动或移动任务' : 'Drag or move task'}: ${task.title}`} title={zh ? '拖到另一任务；点击可选择位置' : 'Drag onto another task, or click to choose a parent'} className="absolute right-2 top-2 flex min-h-11 min-w-11 touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => setMoving(true)}><GripVertical className="h-5 w-5" /></button>
        </div>
        {drop.isOver && <p role="status" className="px-2 py-1 text-xs text-primary">{zh ? '松开成为此任务的独立子任务' : 'Release to make an independent subtask here'}</p>}
        {moving && <TaskMovePicker taskId={task.id} onClose={() => setMoving(false)} />}
    </div>;
}
