import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDndContext, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { taskParentError, taskTreeRows, useTaskStore, type Task, type TaskDropPosition } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { placeTaskWithUndo } from '../../lib/move-task-with-undo';
import { openTaskDetails } from '../../lib/lifecycle-actions';
import { useUiStore } from '../../store/ui-store';
import { TaskMovePicker } from './TaskMovePicker';

type TreeDragData = { task: Task; listId: string; position?: TaskDropPosition };
const PlacementBusy = createContext(false);

export function TaskHierarchyDrag({ children }: { children: ReactNode }) {
    const { language } = useLanguage(), zh = language.startsWith('zh');
    const [dragged, setDragged] = useState<Task | null>(null);
    const [saving, setSaving] = useState(false);
    const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }));
    return <DndContext accessibility={{ screenReaderInstructions: { draggable: zh
        ? '拖到卡片上沿或下沿调整顺序，拖到中间成为子任务。按回车或空格打开移动菜单，也可上移或下移。'
        : 'Drag to the top or bottom edge to reorder, or the middle to nest. Press Enter or Space for the move menu, including Move up and Move down.' } }}
        sensors={sensors} collisionDetection={pointerWithin}
        onDragStart={({ active }) => setDragged(active.data.current?.task ?? null)}
        onDragCancel={() => setDragged(null)} onDragEnd={({ active, over }) => {
            setDragged(null);
            const source = active.data.current as TreeDragData | undefined;
            const target = over?.data.current as TreeDragData | undefined;
            if (saving || !source || !target?.position || source.task.id === target.task.id) return;
            // Crossing a filtered view must not silently change a task's status or day plan.
            if (target.position !== 'inside' && source.listId !== target.listId) return;
            setSaving(true);
            void placeTaskWithUndo(source.task.id, target.task.id, target.position, zh)
                .catch(error => useUiStore.getState().showToast(error instanceof Error ? error.message : String(error), 'error'))
                .finally(() => setSaving(false));
        }}>
        <PlacementBusy.Provider value={saving}><div className="min-w-0" aria-busy={saving} data-task-placement-saving={saving || undefined}>{children}</div></PlacementBusy.Provider>
        <DragOverlay dropAnimation={null}>{dragged ? <div className="max-w-xs rounded-xl border border-primary/30 bg-card p-4 text-sm font-medium text-foreground shadow-xl">
            {dragged.title}<p className="mt-1 text-xs font-normal text-muted-foreground">{zh ? '边缘换序 · 中间成为子任务' : 'Edges to reorder · middle to nest'}</p>
        </div> : null}</DragOverlay>
    </DndContext>;
}

export function TaskTreeList({ tasks, render, listId }: { tasks: Task[]; render: (task: Task) => ReactNode; listId: string }) {
    const rows = useMemo(() => taskTreeRows(tasks), [tasks]);
    const neighbors = useMemo(() => {
        const groups = new Map<string | undefined, string[]>();
        for (const { task } of rows) {
            const siblings = groups.get(task.parentTaskId) ?? [];
            siblings.push(task.id);
            groups.set(task.parentTaskId, siblings);
        }
        const result = new Map<string, { previousTaskId?: string; nextTaskId?: string }>();
        for (const ids of groups.values()) ids.forEach((id, index) => result.set(id, { previousTaskId: ids[index - 1], nextTaskId: ids[index + 1] }));
        return result;
    }, [rows]);
    return <div className="space-y-3" data-task-tree={listId}>{rows.map(({ task, depth }) => <TaskTreeCard key={task.id} task={task} depth={depth} listId={listId} {...neighbors.get(task.id)}>{render(task)}</TaskTreeCard>)}</div>;
}

/** Disjoint hit areas make the pointer position, not the dragged card's centre, authoritative. */
function TaskDropZone({ task, listId, position }: { task: Task; listId: string; position: TaskDropPosition }) {
    const { language } = useLanguage(), zh = language.startsWith('zh');
    const tasks = useTaskStore(state => state.tasks);
    const { active } = useDndContext();
    const source = active?.data.current as TreeDragData | undefined;
    const parentId = position === 'inside' ? task.id : task.parentTaskId;
    const disabled = !source || source.task.id === task.id
        || (position !== 'inside' && source.listId !== listId)
        || !!taskParentError(tasks, source.task.id, parentId);
    const drop = useDroppable({ id: `${listId}:${task.id}:${position}`, data: { task, listId, position }, disabled });
    const area = position === 'before' ? 'inset-x-0 top-0 h-1/4' : position === 'after' ? 'inset-x-0 bottom-0 h-1/4' : 'inset-x-0 top-1/4 bottom-1/4';
    const label = position === 'inside' ? (zh ? '放入，成为子任务' : 'Nest as a subtask')
        : position === 'before' ? (zh ? '插入到前面' : 'Insert before') : (zh ? '插入到后面' : 'Insert after');
    return <>
        <div ref={drop.setNodeRef} data-task-drop={position} data-drop-task={task.id} className={`pointer-events-none absolute ${area}`} aria-hidden="true" />
        {drop.isOver && !disabled && <div className={`pointer-events-none absolute inset-x-0 z-10 ${position === 'inside' ? 'inset-y-0 rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background' : position === 'before' ? '-top-1.5 h-0.5 rounded-full bg-primary' : '-bottom-1.5 h-0.5 rounded-full bg-primary'}`}>
            <span role="status" className={`absolute right-3 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm ${position === 'inside' ? 'bottom-2' : '-top-3'}`}>{label}</span>
        </div>}
    </>;
}

function TaskTreeCard({ task, depth, listId, children, previousTaskId, nextTaskId }: {
    task: Task; depth: number; listId: string; children: ReactNode; previousTaskId?: string; nextTaskId?: string;
}) {
    const { language } = useLanguage(), zh = language.startsWith('zh');
    const tasks = useTaskStore(state => state.tasks);
    const [moving, setMoving] = useState(false);
    const placementBusy = useContext(PlacementBusy);
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: `${listId}:${task.id}`, data: { task, listId }, disabled: placementBusy });
    const parent = useMemo(() => tasks.find(candidate => candidate.id === task.parentTaskId), [tasks, task.parentTaskId]);
    return <div ref={setNodeRef} data-tree-task={task.id} data-tree-depth={depth} className={`task-tree-row relative min-w-0 rounded-xl ${isDragging ? 'opacity-40' : ''}`} style={{ marginInlineStart: Math.min(depth, 3) * 16 }}>
        {parent && <button className="mb-1 min-h-11 max-w-full break-words px-2 text-left text-xs text-muted-foreground hover:text-primary" onClick={() => openTaskDetails(parent.id)}>{zh ? '属于' : 'In'}：{parent.title}</button>}
        <div className="relative">
            {children}
            <button ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={placementBusy} aria-label={`${zh ? '拖动或移动任务' : 'Drag or move task'}: ${task.title}`}
                title={zh ? '边缘换序，中间成为子任务；点击打开移动菜单' : 'Edges to reorder, middle to nest; click for the move menu'}
                className="task-drag-handle absolute right-2 top-2 flex min-h-11 min-w-11 touch-none cursor-grab items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => setMoving(true)}><GripVertical className="h-4 w-4" /></button>
            {(['before', 'inside', 'after'] as const).map(position => <TaskDropZone key={position} task={task} listId={listId} position={position} />)}
        </div>
        {moving && <TaskMovePicker taskId={task.id} previousTaskId={previousTaskId} nextTaskId={nextTaskId} onClose={() => setMoving(false)} />}
    </div>;
}
