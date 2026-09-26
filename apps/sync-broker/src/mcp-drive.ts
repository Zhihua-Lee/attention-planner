import type { AppData } from '../../../packages/core/src/types';
import { readTaskPlanner } from '../../../packages/core/src/planner';
import { validateMergedSyncData } from '../../../packages/core/src/sync-normalization';

const DATA_FILE_NAME = 'attention-planner-v2.json';
const DRIVE_ROOT = 'https://www.googleapis.com/drive/v2/files';
const UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v2/files';
export const MAX_MCP_SNAPSHOT_BYTES = 10 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const METADATA_FIELDS = 'id,title,version,etag,mimeType,fileSize,modifiedDate,spaces,labels(trashed),clientEncryptionDetails';

export type McpSnapshot = {
    data: AppData;
    fileId: string;
    revision: string;
    etag: string;
    modifiedTime?: string;
};

export type McpDriveErrorCode = 'snapshot_conflict' | 'invalid_snapshot' | 'unsupported_snapshot'
    | 'snapshot_too_large' | 'missing_snapshot' | 'ambiguous_snapshot' | 'missing_etag'
    | 'drive_unauthorized' | 'drive_unavailable' | 'invalid_drive_response' | 'write_outcome_unknown';

/** Messages are fixed strings: neither upstream bodies nor task/token content are exposed. */
export class McpDriveError extends Error {
    constructor(readonly code: McpDriveErrorCode, message: string, readonly status = 409) {
        super(message);
        this.name = 'McpDriveError';
    }
}

type DriveMetadata = Omit<McpSnapshot, 'data'>;
type Fetcher = typeof fetch;

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

function validRevision(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9]{1,30}$/.test(value);
}

function validEtag(value: unknown): value is string {
    // An exact, strong entity tag only. Wildcards and weak tags cannot guard this write.
    return typeof value === 'string' && /^"[\x21\x23-\x7e]{1,512}"$/.test(value);
}

function invalidResponse(): never {
    throw new McpDriveError('invalid_drive_response', 'Google Drive returned an invalid response.', 502);
}

function conflict(): never {
    throw new McpDriveError('snapshot_conflict', 'Tasks changed in Google Drive. Read the latest snapshot before trying again.');
}

async function request(
    accessToken: string,
    url: string,
    fetcher: Fetcher,
    init: RequestInit = {},
): Promise<Response> {
    const isWrite = init.method === 'PUT';
    if (!accessToken || /[\r\n]/.test(accessToken)) {
        throw new McpDriveError('drive_unauthorized', 'Reconnect Google Drive in Attention Planner.', 401);
    }
    let response: Response;
    try {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${accessToken}`);
        headers.set('Accept', 'application/json');
        response = await fetcher(url, {
            ...init,
            headers,
            // Workers supports manual/follow, but not error. Never follow redirects
            // carrying the bearer token; the exact-200 check below rejects 3xx.
            redirect: 'manual',
            signal: AbortSignal.timeout(30_000),
        });
    } catch {
        throw new McpDriveError(
            isWrite ? 'write_outcome_unknown' : 'drive_unavailable',
            isWrite ? 'The Drive write outcome is unknown. Read the latest snapshot before retrying.' : 'Google Drive could not be reached.',
            502,
        );
    }
    if (response.status === 409 || response.status === 412) conflict();
    if (response.status === 401 || response.status === 403) {
        throw new McpDriveError('drive_unauthorized', 'Reconnect Google Drive in Attention Planner.', 401);
    }
    if (response.status === 404) {
        throw new McpDriveError('missing_snapshot', 'Sync Attention Planner to Google Drive before using remote tools.');
    }
    if (response.status !== 200 || response.redirected) {
        throw new McpDriveError(
            isWrite ? 'write_outcome_unknown' : 'drive_unavailable',
            isWrite ? 'The Drive write outcome is unknown. Read the latest snapshot before retrying.' : 'Google Drive is temporarily unavailable.',
            502,
        );
    }
    return response;
}

async function boundedJson(response: Response, limit: number): Promise<unknown> {
    const length = response.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
        await response.body?.cancel().catch(() => undefined);
        throw new McpDriveError('snapshot_too_large', 'The Drive response exceeds the remote tool size limit.', 413);
    }
    const mediaType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') invalidResponse();
    if (!response.body) invalidResponse();
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let content = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > limit) {
                await reader.cancel();
                throw new McpDriveError('snapshot_too_large', 'The Drive response exceeds the remote tool size limit.', 413);
            }
            content += decoder.decode(value, { stream: true });
        }
        content += decoder.decode();
        return JSON.parse(content) as unknown;
    } catch (error) {
        if (error instanceof McpDriveError) throw error;
        invalidResponse();
    } finally {
        reader.releaseLock();
    }
}

function optionalFields(record: Record<string, unknown>, fields: readonly string[], type: 'string' | 'boolean'): void {
    if (fields.some(field => record[field] !== undefined && typeof record[field] !== type)) throw new Error();
}

function validateRecurrence(value: unknown): void {
    if (value === undefined) return;
    const rules = ['daily', 'weekly', 'monthly', 'yearly'];
    if (typeof value === 'string') {
        if (!rules.includes(value)) throw new Error();
        return;
    }
    if (!object(value) || typeof value.rule !== 'string' || !rules.includes(value.rule)) throw new Error();
    optionalFields(value, ['seriesId', 'strategy', 'weekStart', 'until', 'rrule'], 'string');
    if (value.strategy !== undefined && !['strict', 'fluid'].includes(value.strategy as string)) throw new Error();
    if (value.weekStart !== undefined && !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(value.weekStart as string)) throw new Error();
    if (value.byDay !== undefined && (!Array.isArray(value.byDay)
        || value.byDay.some(day => typeof day !== 'string' || !/^(-1|1|2|3|4)?(MO|TU|WE|TH|FR|SA|SU)$/.test(day)))) throw new Error();
    if (value.byMonthDay !== undefined && (!Array.isArray(value.byMonthDay)
        || value.byMonthDay.some(day => !Number.isSafeInteger(day) || day < 1 || day > 31))) throw new Error();
    for (const field of ['count', 'completedOccurrences', 'anchorDay', 'startAnchorDay', 'dueAnchorDay', 'reviewAnchorDay']) {
        const number = value[field];
        if (number === undefined) continue;
        if (typeof number !== 'number' || !Number.isSafeInteger(number)
            || number < (field === 'completedOccurrences' ? 0 : 1)
            || (field.endsWith('AnchorDay') || field === 'anchorDay') && number > 31) throw new Error();
    }
}

function validatePlannerScalars(value: unknown): void {
    const planner = readTaskPlanner(value);
    if (!planner) return;
    const record = planner as unknown as Record<string, unknown>;
    optionalFields(record, ['skippedAt', 'legacySchedule'], 'string');
    optionalFields(record, ['legacyFocus'], 'boolean');
    // readTaskPlanner checks required fields. Check optional fields as well so a
    // private object cannot be smuggled through a known display field's TS type.
    const stamps = [planner.contentStamp, ...planner.blocks, ...planner.days];
    for (const stamp of stamps) {
        if (stamp) optionalFields(stamp as unknown as Record<string, unknown>, ['manualAt', 'manualBy'], 'string');
    }
    for (const block of planner.blocks) {
        optionalFields(block as unknown as Record<string, unknown>, ['reason'], 'string');
        if (typeof block.state !== 'string' || typeof block.origin !== 'string') throw new Error();
    }
}

/** Validate in place. Normalizers/allowlist serializers would discard fields owned by other clients. */
function validateSnapshot(value: unknown): asserts value is AppData {
    if (!object(value)) throw new McpDriveError('invalid_snapshot', 'The Drive file is not a valid Attention Planner snapshot.');
    if (value.encrypted === true || value.ciphertext !== undefined || value.encryption !== undefined
        || value.schemaVersion !== undefined || value.version !== undefined) {
        throw new McpDriveError('unsupported_snapshot', 'Encrypted or versioned snapshot envelopes are not supported by remote tools.');
    }
    try {
        if (validateMergedSyncData(value as unknown as AppData).length > 0) throw new Error();
        for (const key of ['tasks', 'projects', 'sections', 'areas', 'people'] as const) {
            const entities = value[key] ?? [];
            const seen = new Set<string>();
            for (const entity of entities as Array<Record<string, unknown>>) {
                if (typeof entity.id !== 'string' || seen.has(entity.id)) throw new Error();
                seen.add(entity.id);
                optionalFields(entity, ['title', 'name', 'description', 'status', 'parentTaskId', 'projectId', 'sectionId',
                    'areaId', 'createdAt', 'updatedAt', 'deletedAt', 'purgedAt', 'projectArchivedAt',
                    'availableAt', 'scheduledAt', 'snoozedUntil', 'startTime', 'dueDate', 'reviewAt', 'completedAt',
                    'timeEstimate'], 'string');
            }
        }
        for (const task of (value as unknown as AppData).tasks) {
            optionalFields(task as unknown as Record<string, unknown>, ['isFocusedToday'], 'boolean');
            if (typeof task.title !== 'string' || !task.title.trim()
                || !['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'archived'].includes(task.status)
                || typeof task.createdAt !== 'string' || !Number.isFinite(Date.parse(task.createdAt))
                || !Array.isArray(task.tags) || task.tags.some(tag => typeof tag !== 'string')
                || !Array.isArray(task.contexts) || task.contexts.some(context => typeof context !== 'string')) throw new Error();
            if (task.checklist !== undefined && (!Array.isArray(task.checklist)
                || task.checklist.some(item => !object(item) || typeof item.id !== 'string' || !item.id
                    || typeof item.title !== 'string' || typeof item.isCompleted !== 'boolean'))) throw new Error();
            validateRecurrence(task.recurrence);
            validatePlannerScalars(task.planner);
        }
    } catch {
        throw new McpDriveError('invalid_snapshot', 'The Drive snapshot has invalid or unsupported task data. Open Attention Planner to resolve it.');
    }
}

async function findFile(accessToken: string, fetcher: Fetcher): Promise<string> {
    const params = new URLSearchParams({
        q: `title = '${DATA_FILE_NAME}' and trashed = false`,
        spaces: 'appDataFolder',
        maxResults: '2',
        fields: 'items(id,title),nextPageToken,incompleteSearch',
    });
    const value = await boundedJson(await request(accessToken, `${DRIVE_ROOT}?${params}`, fetcher), MAX_METADATA_BYTES);
    if (!object(value) || !Array.isArray(value.items)
        || (value.incompleteSearch !== undefined && typeof value.incompleteSearch !== 'boolean')
        || (value.nextPageToken !== undefined && typeof value.nextPageToken !== 'string')) invalidResponse();
    // Do not select the newest copy or silently skip a partial list.
    if (value.items.length > 1 || value.nextPageToken || value.incompleteSearch) {
        throw new McpDriveError('ambiguous_snapshot', 'The Drive sync file is ambiguous. Resolve duplicate or incomplete files in Attention Planner first.');
    }
    if (value.items.length === 0) {
        throw new McpDriveError('missing_snapshot', 'Sync Attention Planner to Google Drive before using remote tools.');
    }
    const file = value.items[0];
    if (!object(file) || !validId(file.id) || file.title !== DATA_FILE_NAME) invalidResponse();
    return file.id;
}

async function metadata(accessToken: string, fileId: string, fetcher: Fetcher): Promise<DriveMetadata> {
    const params = new URLSearchParams({ fields: METADATA_FIELDS });
    const value = await boundedJson(await request(accessToken, `${DRIVE_ROOT}/${fileId}?${params}`, fetcher), MAX_METADATA_BYTES);
    if (!object(value) || value.id !== fileId || value.title !== DATA_FILE_NAME || !validRevision(value.version)
        || value.mimeType !== 'application/json' || !Array.isArray(value.spaces) || !value.spaces.includes('appDataFolder')
        || !object(value.labels) || value.labels.trashed !== false
        || typeof value.fileSize !== 'string' || !/^\d{1,30}$/.test(value.fileSize)
        || (value.modifiedDate !== undefined && (typeof value.modifiedDate !== 'string' || !Number.isFinite(Date.parse(value.modifiedDate))))) invalidResponse();
    if (value.clientEncryptionDetails !== undefined) {
        throw new McpDriveError('unsupported_snapshot', 'Encrypted Drive files are not supported by remote tools.');
    }
    if (Number(value.fileSize) > MAX_MCP_SNAPSHOT_BYTES) {
        throw new McpDriveError('snapshot_too_large', 'The Drive snapshot exceeds the remote tool size limit.', 413);
    }
    if (!validEtag(value.etag)) {
        throw new McpDriveError('missing_etag', 'Google Drive did not provide a strong ETag. Remote writes are disabled.');
    }
    return { fileId, revision: value.version, etag: value.etag, modifiedTime: value.modifiedDate as string | undefined };
}

function assertSameSnapshot(expected: DriveMetadata, actual: DriveMetadata): void {
    if (expected.fileId !== actual.fileId || expected.revision !== actual.revision || expected.etag !== actual.etag) conflict();
}

/**
 * Drive v2 exposes a file ETag in JSON, whereas v3 does not expose that field.
 * Use v2 for both metadata and conditional media updates; never mix API-version ETags.
 * https://developers.google.com/workspace/drive/api/reference/rest/v2/files
 * https://developers.google.com/workspace/drive/api/reference/rest/v2/files/update
 * Both endpoints accept the existing drive.appdata scope.
 */
export async function readMcpSnapshot(accessToken: string, fetcher: Fetcher = fetch): Promise<McpSnapshot> {
    const fileId = await findFile(accessToken, fetcher);
    const before = await metadata(accessToken, fileId, fetcher);
    const data = await boundedJson(await request(accessToken, `${DRIVE_ROOT}/${fileId}?alt=media`, fetcher), MAX_MCP_SNAPSHOT_BYTES);
    const after = await metadata(accessToken, fileId, fetcher);
    assertSameSnapshot(before, after);
    validateSnapshot(data);
    return { ...after, data };
}

/** Callers must derive nextData from the original snapshot, retaining unrelated and unknown fields. */
export async function writeMcpSnapshot(
    accessToken: string,
    snapshot: McpSnapshot,
    nextData: AppData,
    fetcher: Fetcher = fetch,
): Promise<string> {
    if (!snapshot || !validId(snapshot.fileId) || !validRevision(snapshot.revision)) {
        throw new McpDriveError('invalid_snapshot', 'Read a valid Drive snapshot before writing.');
    }
    if (!validEtag(snapshot.etag)) {
        throw new McpDriveError('missing_etag', 'A strong snapshot ETag is required. No data was written.');
    }
    validateSnapshot(snapshot.data);
    validateSnapshot(nextData);
    let body: string;
    try { body = JSON.stringify(nextData); } catch {
        throw new McpDriveError('invalid_snapshot', 'The proposed snapshot cannot be serialized.');
    }
    if (new TextEncoder().encode(body).byteLength > MAX_MCP_SNAPSHOT_BYTES) {
        throw new McpDriveError('snapshot_too_large', 'The proposed snapshot exceeds the remote tool size limit.', 413);
    }
    if (await findFile(accessToken, fetcher) !== snapshot.fileId) conflict();
    assertSameSnapshot(snapshot, await metadata(accessToken, snapshot.fileId, fetcher));
    const params = new URLSearchParams({ uploadType: 'media', fields: 'id,version' });
    const response = await request(accessToken, `${UPLOAD_ROOT}/${snapshot.fileId}?${params}`, fetcher, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'If-Match': snapshot.etag },
        body,
    });
    // The write may have committed even if its response cannot be read. Never retry it blindly.
    try {
        const result = await boundedJson(response, MAX_METADATA_BYTES);
        if (!object(result) || result.id !== snapshot.fileId || !validRevision(result.version)
            || BigInt(result.version) <= BigInt(snapshot.revision)) throw new Error();
        return result.version;
    } catch {
        throw new McpDriveError('write_outcome_unknown', 'The Drive write outcome is unknown. Read the latest snapshot before retrying.', 502);
    }
}
