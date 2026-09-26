import { z } from 'zod';
import type { AppData, Task } from '../../../packages/core/src/types';
import type { TaskStore } from '../../../packages/core/src/store-types';
import { createTaskActions } from '../../../packages/core/src/store-tasks';
import { computeDerivedState, isTaskVisible } from '../../../packages/core/src/store-helpers';
import {
    activeWorkBlocks, assertReservationFree, blockEnd, changeWork, contentDraftPatch,
    plannerPatch, scheduleWork, taskPlanner, validPlanDay,
} from '../../../packages/core/src/planner';
import { generateDeterministicUUID } from '../../../packages/core/src/uuid';
import { projectTask } from './mcp-projection';

const id = z.string().trim().min(1).max(200);
const title = z.string().trim().min(1).max(500);
const description = z.string().max(50_000);
const timestamp = z.string().max(40).datetime({ offset: true });
const date = z.string().max(40).refine(value => validPlanDay(value) || timestamp.safeParse(value).success,
    'Use YYYY-MM-DD or an ISO timestamp with an explicit UTC offset.');
const checklistItem = z.object({ id: id.optional(), title, isCompleted: z.boolean().optional() }).strict();
const checklist = z.array(checklistItem).max(100).refine(items => {
    const ids = items.flatMap(item => item.id ? [item.id] : []);
    return new Set(ids).size === ids.length;
}, 'Checklist item IDs must be unique.');

/** A closed allowlist: no raw Task/AppData patches, credentials or calendar settings. */
export const mcpCommandSchema = z.union([
    z.object({ type: z.literal('create_draft'), title, description: description.optional(),
        checklist: z.array(z.object({ title }).strict()).max(100).optional() }).strict(),
    z.object({ type: z.literal('update_content'), taskId: id, title: title.optional(),
        description: description.nullable().optional(), checklist: checklist.optional() }).strict()
        .refine(value => value.title !== undefined || value.description !== undefined || value.checklist !== undefined,
            'Include at least one content change.'),
    z.object({ type: z.literal('move_task'), taskId: id, parentTaskId: id.nullable() }).strict(),
    z.object({ type: z.literal('delete_task'), taskId: id }).strict(),
    z.object({ type: z.literal('complete_task'), taskId: id }).strict(),
    z.object({ type: z.literal('reopen_task'), taskId: id }).strict(),
    z.object({ type: z.literal('set_dates'), taskId: id,
        availableAt: date.nullable().optional(), dueDate: date.nullable().optional() }).strict()
        .refine(value => value.availableAt !== undefined || value.dueDate !== undefined,
            'Include at least one date; null explicitly clears it.'),
    z.object({ type: z.literal('schedule_work'), taskId: id, blockId: id.optional(), startAt: timestamp,
        durationMinutes: z.number().int().min(1).max(1440), timeZone: z.string().min(1).max(100)
            .refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } },
                'Use a valid IANA time zone.') }).strict(),
    z.object({ type: z.literal('cancel_work'), taskId: id, blockId: id }).strict(),
]);
export type McpCommand = z.infer<typeof mcpCommandSchema>;

export type McpTaskPreview = Pick<Task, 'id' | 'title' | 'description' | 'status' | 'checklist' |
    'parentTaskId' | 'availableAt' | 'dueDate' | 'completedAt' | 'deletedAt' | 'planner'>;
export type PreparedMcpCommand = {
    version: 1;
    operationId: string;
    preparedAt: string;
    command: McpCommand;
    /** Only hashes are retained for concurrency checking; no second full data snapshot. */
    expectedFingerprint: string;
    generatedTaskId: string;
    generatedBlockId: string;
    summary: string;
    warnings: string[];
    before?: McpTaskPreview;
    after: McpTaskPreview;
    additionalTasks: McpTaskPreview[];
};
export type McpCommandResult = { data: AppData; changedTaskIds: string[]; createdTaskId?: string };
export type McpCommandOptions = { now?: Date; deviceId?: string };

export class McpCommandConflict extends Error {
    readonly code = 'stale_proposal';
    constructor() { super('Tasks changed after this proposal was prepared. Read the latest data and request a new approval.'); }
}

export function parseMcpCommand(value: unknown): McpCommand { return mcpCommandSchema.parse(value); }

function liveTask(data: AppData, taskId: string): Task {
    const task = data.tasks.find(item => item.id === taskId);
    if (!task || task.deletedAt || task.purgedAt) throw new Error('Task no longer exists or is in Trash.');
    if (task.projectArchivedAt) throw new Error('Restore this task’s archived project in the PWA before changing it.');
    return task;
}

/** Explicit projection; task attachments, settings and calendar feed secrets never reach preview/UI. */
export function mcpTaskPreview(task: Task): McpTaskPreview {
    return projectTask(task);
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(item => canonical(item === undefined ? null : item)).join(',')}]`;
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
            .map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

async function fingerprint(data: AppData): Promise<string> {
    // Parent links, recurring peers and overlapping reservations all affect validity.
    // Conservative v1: any task/container change invalidates an existing approval.
    const bytes = new TextEncoder().encode(canonical({
        tasks: data.tasks, projects: data.projects, sections: data.sections, areas: data.areas,
        // Core actions also consult defaults and lifecycle preferences. A change to
        // those settings must not alter an already approved preview's semantics.
        settings: data.settings,
    }));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function commandWarnings(data: AppData, command: McpCommand): string[] {
    if (command.type === 'create_draft') return [];
    const task = liveTask(data, command.taskId);
    const warnings: string[] = [];
    if (command.type === 'schedule_work') warnings.push(
        '尚未检查 Outlook 等外部日历；目前只检查已同步到 Drive 的任务时间块是否重叠。请自行确认该时段没有会议或课程，再批准安排。');
    if (command.type === 'complete_task' && task.recurrence) warnings.push(
        '完成周期任务可能按现有规则生成下一次任务，具体日期已列在下方。远程服务使用 UTC，请核对带时间的周期任务，尤其是夏令时切换前后的日期和时刻。');
    if (command.type === 'complete_task') warnings.push('完成任务会取消它剩余的时间块，但不会连带完成独立子任务。');
    if (command.type === 'delete_task') warnings.push('仅把这个任务放入回收站。独立子任务仍会保留并显示；不会永久删除文件。');
    if (command.type === 'reopen_task') warnings.push('重新打开为 Ready。已取消的时间块不会自动恢复；已经生成的下一次周期任务也不会被删除。');
    if (command.type === 'set_dates' && task.relativeStartOffset) warnings.push(
        command.availableAt !== undefined
            ? '指定可开始日期会解除旧版的相对开始时间规则，防止该规则覆盖所选日期。'
            : '这个任务使用相对开始时间规则；改变截止日期也可能改变据此计算的可开始时间。');
    return warnings;
}

function summary(command: McpCommand, task?: Task): string {
    const name = task?.title ?? ('title' in command ? command.title : '') ?? '';
    const action: Record<McpCommand['type'], string> = {
        create_draft: '新建收集箱草稿', update_content: '修改任务内容', move_task: '移动独立任务的父子关系',
        delete_task: '放入回收站', complete_task: '完成任务', reopen_task: '重新打开为 Ready',
        set_dates: '修改任务日期', schedule_work: '安排任务时间块', cancel_work: '取消任务时间块',
    };
    return `${action[command.type]}: ${name}`;
}

/**
 * Construct the normal core command engine per request. No zustand singleton,
 * browser storage, background saves or shared mutable state is used here.
 * Only its task collection is retained; all other original AppData fields survive.
 */
function isolatedActions(data: AppData, deviceId: string) {
    const local = structuredClone(data);
    let state = {
        tasks: local.tasks.filter(task => isTaskVisible(task)), _allTasks: local.tasks,
        _tasksById: new Map(local.tasks.map(task => [task.id, task])),
        projects: local.projects.filter(project => !project.deletedAt), _allProjects: local.projects,
        _projectsById: new Map(local.projects.map(project => [project.id, project])),
        sections: local.sections.filter(section => !section.deletedAt), _allSections: local.sections,
        _sectionsById: new Map(local.sections.map(section => [section.id, section])),
        areas: local.areas.filter(area => !area.deletedAt), _allAreas: local.areas,
        _areasById: new Map(local.areas.map(area => [area.id, area])),
        people: local.people ?? [], _allPeople: local.people ?? [],
        _peopleById: new Map((local.people ?? []).map(person => [person.id, person])),
        settings: { ...local.settings, deviceId, diagnostics: { loggingEnabled: false } },
        lastDataChangeAt: 0, error: null,
        getDerivedState: () => computeDerivedState(state.tasks, state.projects),
    } as TaskStore;
    const actions = createTaskActions({
        get: () => state,
        set: partial => { state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) }; },
        getStorage: () => ({ getData: async () => local, saveData: async () => {} }),
        debouncedSave: () => {},
        trackImmediateSave: save => save,
    });
    Object.assign(state, actions);
    return { actions, tasks: () => state._allTasks };
}

async function execute(data: AppData, prepared: Pick<PreparedMcpCommand, 'command' | 'operationId' | 'generatedTaskId' | 'generatedBlockId'>,
    options: McpCommandOptions = {}): Promise<McpCommandResult> {
    const { command } = prepared;
    const clock = { now: options.now ?? new Date(), deviceId: options.deviceId ?? 'attention-planner-mcp' };
    const { actions, tasks } = isolatedActions(data, clock.deviceId);
    const task = command.type === 'create_draft' ? undefined : liveTask(data, command.taskId);
    let result;
    if (command.type === 'create_draft') {
        if (data.tasks.some(item => item.id === prepared.generatedTaskId)) throw new Error('This draft operation already exists; do not create it again.');
        result = await actions.addTask(command.title, {
            status: 'inbox', areaId: undefined, description: command.description,
            checklist: command.checklist?.map((item, index) => ({ title: item.title, isCompleted: false,
                id: generateDeterministicUUID(`${prepared.operationId}:checklist:${index}`) })),
        });
    } else {
        let patch: Partial<Task>;
        switch (command.type) {
            case 'update_content': {
                const draft: Partial<Task> = { ...task! };
                if (command.title !== undefined) draft.title = command.title;
                if (command.description !== undefined) draft.description = command.description ?? undefined;
                if (command.checklist !== undefined) {
                    const existing = new Map(task!.checklist?.map(item => [item.id, item]));
                    draft.checklist = command.checklist.map((item, index) => {
                        if (item.id && !existing.has(item.id)) throw new Error('Unknown checklist item ID. Omit ID to add a new step.');
                        return { ...(item.id ? existing.get(item.id) : {}),
                            id: item.id ?? generateDeterministicUUID(`${prepared.operationId}:checklist:${index}`),
                            title: item.title, isCompleted: item.isCompleted ?? (item.id ? existing.get(item.id)?.isCompleted : false) ?? false };
                    });
                }
                patch = contentDraftPatch(task!, draft, task!);
                break;
            }
            case 'move_task': patch = { parentTaskId: command.parentTaskId ?? undefined }; break;
            case 'delete_task': result = await actions.deleteTask(command.taskId); break;
            case 'complete_task':
                if (task!.status === 'done' || task!.status === 'archived' || task!.status === 'reference') throw new Error('Only an open actionable task can be completed.');
                patch = { status: 'done', completedAt: clock.now.toISOString() };
                break;
            case 'reopen_task':
                if (task!.status !== 'done') throw new Error('Only a completed task can be reopened with this command.');
                patch = { status: 'next' };
                break;
            case 'set_dates': {
                if (task!.status === 'reference') throw new Error('Reference notes cannot have task dates. Convert this note to a task in the PWA first.');
                const draft: Partial<Task> = { ...task! };
                if (command.availableAt !== undefined) draft.availableAt = command.availableAt ?? undefined;
                if (command.dueDate !== undefined) draft.dueDate = command.dueDate ?? undefined;
                patch = { ...contentDraftPatch(task!, draft, task!), status: task!.status };
                if (command.availableAt !== undefined) {
                    // Freeze legacy reservations before clearing a legacy availability value.
                    patch = { ...patch, ...plannerPatch(task!, taskPlanner(task!)), relativeStartOffset: undefined };
                    if (task!.startTime && !task!.startTime.includes('T')) patch.startTime = undefined;
                }
                break;
            }
            case 'schedule_work': {
                const blockId = command.blockId ?? prepared.generatedBlockId;
                if (command.blockId && !taskPlanner(task!).blocks.some(block => block.id === command.blockId)) throw new Error('The work block no longer exists. Omit blockId to create a reservation.');
                const busy = data.tasks.flatMap(item => activeWorkBlocks(item)
                    .filter(block => item.id !== task!.id || block.id !== blockId)
                    .map(block => ({ start: block.startAt, end: new Date(blockEnd(block)).toISOString() })));
                // This validates KNOWN work blocks only. External-calendar uncertainty is
                // disclosed in every server-generated approval; never report global free/busy.
                assertReservationFree(command, busy, true);
                patch = scheduleWork(task!, { id: blockId, startAt: command.startAt,
                    durationMinutes: command.durationMinutes, timeZone: command.timeZone }, clock);
                break;
            }
            case 'cancel_work': patch = changeWork(task!, command.blockId, 'cancel', clock); break;
        }
        if (command.type !== 'delete_task') result = await actions.updateTask(command.taskId, patch!);
    }
    if (!result?.success) throw new Error(result?.error ?? 'The task command failed.');
    const oldIds = new Set(data.tasks.map(item => item.id));
    const nextTasks = tasks().map(item => {
        if (oldIds.has(item.id)) return item;
        // Core generates random IDs. Pin only new identities to this server-owned
        // operation so an uncertain Drive write cannot produce duplicate drafts.
        const nextId = command.type === 'create_draft' ? prepared.generatedTaskId
            : generateDeterministicUUID(`${prepared.operationId}:recurring-task`);
        if (oldIds.has(nextId)) throw new Error('The generated task already exists; refresh before retrying.');
        return { ...item, id: nextId, attachments: item.attachments?.map((attachment, index) => ({
            ...attachment, id: generateDeterministicUUID(`${prepared.operationId}:attachment:${index}`),
        })) };
    });
    const previous = new Map(data.tasks.map(item => [item.id, canonical(item)]));
    const changedTaskIds = nextTasks.filter(item => previous.get(item.id) !== canonical(item)).map(item => item.id);
    return { data: { ...data, tasks: nextTasks }, changedTaskIds,
        ...(command.type === 'create_draft' ? { createdTaskId: prepared.generatedTaskId } : {}) };
}

/** Run validation and generate the exact fields shown on the human approval page. */
export async function prepareMcpCommand(data: AppData, input: unknown,
    options: McpCommandOptions & { operationId?: string } = {}): Promise<PreparedMcpCommand> {
    const command = parseMcpCommand(input);
    const now = options.now ?? new Date();
    const operationId = options.operationId ?? crypto.randomUUID();
    const identity = {
        command, operationId,
        generatedTaskId: generateDeterministicUUID(`${operationId}:draft`),
        generatedBlockId: generateDeterministicUUID(`${operationId}:work-block`),
    };
    const result = await execute(data, identity, { ...options, now });
    const taskId = command.type === 'create_draft' ? identity.generatedTaskId : command.taskId;
    const before = command.type === 'create_draft' ? undefined : liveTask(data, command.taskId);
    return {
        version: 1, ...identity, preparedAt: now.toISOString(), expectedFingerprint: await fingerprint(data),
        summary: summary(command, before), warnings: commandWarnings(data, command),
        before: before && mcpTaskPreview(before),
        after: mcpTaskPreview(result.data.tasks.find(item => item.id === taskId)!),
        additionalTasks: result.data.tasks.filter(item => item.id !== taskId && result.changedTaskIds.includes(item.id)).map(mcpTaskPreview),
    };
}

/**
 * Caller MUST load this prepared object from trusted server storage after human
 * confirmation (except create_draft). Never accept it as AI/client JSON input.
 * Caller remains responsible for Drive ETag preconditions and durable idempotency.
 */
export async function applyMcpCommand(data: AppData, prepared: PreparedMcpCommand,
    options: McpCommandOptions = {}): Promise<McpCommandResult> {
    if (prepared.version !== 1) throw new Error('Unsupported task proposal version.');
    const command = parseMcpCommand(prepared.command);
    if (await fingerprint(data) !== prepared.expectedFingerprint) throw new McpCommandConflict();
    return execute(data, { ...prepared, command }, { ...options, now: options.now ?? new Date(prepared.preparedAt) });
}
