import { getSequentialFirstTaskIds } from './task-utils';
import { isTaskAvailable } from './task-time-semantics';
import type { Project, Task } from './types';
import { tFallback } from './i18n';
import { isPlanningProjectActive, isTaskPlanningCandidate, isTaskPlanningVisible } from './task-domain';
export * from './task-domain';

export type ExecutionBlock = 'lifecycle' | 'workflow' | 'project' | 'sequential' | 'unavailable';

export function getPlanningBlockLabel(reason: ExecutionBlock | null, t: (key: string) => string): string | null {
    if (!reason) return null;
    const labels: Record<ExecutionBlock, string> = {
        lifecycle: 'Closed task', workflow: 'Waiting for activation', project: 'Project is inactive',
        sequential: 'Waiting for an earlier step', unavailable: 'Not available yet',
    };
    return tFallback(t, `planning.block.${reason}`, labels[reason]);
}

/** Build once per snapshot. Planning never mutates workflow or applies a clock filter. */
export function createPlanningPolicy(tasks: readonly Task[], projects: readonly Project[], now: Date) {
    const projectMap = new Map(projects.map((project) => [project.id, project]));
    const sequential = new Set(projects.filter((project) => project.isSequential).map((project) => project.id));
    const sections = new Set(projects.filter((project) => project.sequentialScope === 'section').map((project) => project.id));
    const isVisible = isTaskPlanningVisible;
    const first = getSequentialFirstTaskIds(tasks.filter(isVisible), sequential, { sectionScopedProjectIds: sections });
    const isCandidate = (task: Task): boolean => isTaskPlanningCandidate(task, projectMap);
    const executionBlock = (task: Task): ExecutionBlock | null => {
        if (!isVisible(task)) return 'lifecycle';
        if (task.status !== 'next') return 'workflow';
        if (!isPlanningProjectActive(task, projectMap)) return 'project';
        if (task.projectId && sequential.has(task.projectId) && !first.has(task.id)) return 'sequential';
        if (!isTaskAvailable(task, now)) return 'unavailable';
        return null;
    };
    return { isVisible, isCandidate, executionBlock };
}
