import type { Project, Task } from './types';

/** Historical storage states are interpreted here without rewriting user facts. */
export function getTaskDomainState(task: Task) {
    return {
        kind: task.status === 'reference' ? 'reference' as const : 'task' as const,
        lifecycle: task.deletedAt ? 'deleted' as const
            : task.status === 'archived' ? 'archived' as const : 'live' as const,
        workflow: task.status === 'reference' || task.status === 'archived' ? null : task.status,
    };
}

export function isTaskPlanningVisible(task: Task): boolean {
    const state = getTaskDomainState(task);
    return state.kind === 'task' && state.lifecycle === 'live' && state.workflow !== 'done';
}

export function isPlanningProjectActive(task: Task, projects: ReadonlyMap<string, Project>): boolean {
    if (!task.projectId) return true;
    const project = projects.get(task.projectId);
    return Boolean(project && !project.deletedAt && project.status === 'active');
}

export function isTaskPlanningCandidate(task: Task, projects: ReadonlyMap<string, Project>): boolean {
    return isTaskPlanningVisible(task) && task.status === 'next' && isPlanningProjectActive(task, projects);
}
