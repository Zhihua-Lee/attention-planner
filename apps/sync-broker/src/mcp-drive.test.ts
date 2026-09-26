import { describe, expect, it, vi } from 'vitest';
import type { AppData } from '../../../packages/core/src/types';
import {
    MAX_MCP_SNAPSHOT_BYTES,
    readMcpSnapshot,
    writeMcpSnapshot,
    type McpSnapshot,
} from './mcp-drive';

const TOKEN = 'fixture-token-not-a-real-credential';
const FILE_ID = 'fixture_file_id';
const FILE_NAME = 'attention-planner-v2.json';
const DATE = '2026-09-26T12:00:00.000Z';

function data(): AppData {
    return {
        tasks: [{
            id: 'task-one', title: 'Fixture task', status: 'inbox', tags: [], contexts: [],
            createdAt: DATE, updatedAt: DATE, rev: 2, revBy: 'fixture-device',
            planner: { version: 1, days: [], blocks: [] },
        }],
        projects: [], sections: [], areas: [], settings: {},
    };
}

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: FILE_ID, title: FILE_NAME, version: '7', etag: '"fixture-etag-7"',
        mimeType: 'application/json', fileSize: '1024', modifiedDate: DATE,
        spaces: ['appDataFolder'], labels: { trashed: false }, ...overrides,
    };
}

function snapshot(): McpSnapshot {
    return { data: data(), fileId: FILE_ID, revision: '7', etag: '"fixture-etag-7"', modifiedTime: DATE };
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function listing(): Response {
    return json({ items: [{ id: FILE_ID, title: FILE_NAME }] });
}

function fetchQueue(...responses: Array<Response | Error>) {
    return vi.fn<typeof fetch>().mockImplementation(async () => {
        const response = responses.shift();
        if (!response) throw new Error('Unexpected fixture fetch');
        if (response instanceof Error) throw response;
        return response;
    });
}

function readQueue(payload: unknown = data(), before = metadata(), after = before) {
    return fetchQueue(listing(), json(before), json(payload), json(after));
}

function planner() {
    const stamp = { revision: 1, manualRevision: 1, updatedAt: DATE, deviceId: 'fixture-device', manualAt: DATE, manualBy: 'fixture-device' };
    return {
        version: 1,
        contentStamp: { ...stamp },
        blocks: [{ ...stamp, id: 'block-one', startAt: DATE, timeZone: 'UTC',
            allocatedMinutes: 30, completedMinutes: 0, durationMinutes: 30, state: 'scheduled', origin: 'manual', reason: 'manual',
            history: [{ startAt: DATE, durationMinutes: 30, at: DATE, reason: 'manual' }] }],
        days: [{ ...stamp, date: '2026-09-26', selected: true }],
        legacyFocus: false, legacySchedule: DATE, skippedAt: DATE,
    };
}

async function expectInvalidTask(changed: Record<string, unknown>) {
    const payload = { ...data(), tasks: [{ ...data().tasks[0], ...changed }] };
    await expect(readMcpSnapshot(TOKEN, readQueue(payload))).rejects.toMatchObject({ code: 'invalid_snapshot' });
    const fetcher = fetchQueue();
    await expect(writeMcpSnapshot(TOKEN, snapshot(), payload as unknown as AppData, fetcher)).rejects.toMatchObject({ code: 'invalid_snapshot' });
    expect(fetcher).not.toHaveBeenCalled();
}

describe('remote MCP Drive snapshots', () => {
    it('reads only the exact hidden file and returns a stable snapshot using the same API version', async () => {
        const fetcher = readQueue();
        await expect(readMcpSnapshot(TOKEN, fetcher)).resolves.toEqual(snapshot());
        const urls = fetcher.mock.calls.map(([url]) => new URL(String(url)));
        expect(urls[0].searchParams.get('spaces')).toBe('appDataFolder');
        expect(urls[0].searchParams.get('q')).toBe(`title = '${FILE_NAME}' and trashed = false`);
        expect(urls.every(url => url.origin === 'https://www.googleapis.com' && url.pathname.startsWith('/drive/v2/files'))).toBe(true);
        expect(urls[2].searchParams.get('alt')).toBe('media');
        for (const [, init] of fetcher.mock.calls) {
            expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
            expect(init?.redirect).toBe('manual');
        }
    });

    it('preserves unknown fields, tombstones, settings, and planner metadata through read and write', async () => {
        const original = {
            ...data(),
            futureExtension: { opaque: ['retain', 7] },
            settings: { futureSetting: { nested: true } },
            tasks: [
                { ...data().tasks[0], futureTaskField: { value: 'keep' } },
                { ...data().tasks[0], id: 'deleted-task', deletedAt: DATE, futureTombstone: 3 },
            ],
        };
        const current = await readMcpSnapshot(TOKEN, readQueue(original));
        const next = structuredClone(current.data);
        next.tasks[0].title = 'Approved fixture edit';
        const fetcher = fetchQueue(listing(), json(metadata()), json({ id: FILE_ID, version: '8' }));
        await expect(writeMcpSnapshot(TOKEN, current, next, fetcher)).resolves.toBe('8');
        const [url, init] = fetcher.mock.calls[2];
        expect(String(url)).toContain('/upload/drive/v2/files/fixture_file_id?');
        expect(init?.method).toBe('PUT');
        expect(new Headers(init?.headers).get('If-Match')).toBe('"fixture-etag-7"');
        const written = JSON.parse(String(init?.body));
        expect(written).toEqual({ ...original, tasks: [{ ...original.tasks[0], title: 'Approved fixture edit' }, original.tasks[1]] });
        expect(current.data).toEqual(original);
    });

    it.each([
        { version: '8' },
        { etag: '"different-etag"' },
    ])('rejects a file that changes between metadata and media reads: %j', async changed => {
        const fetcher = readQueue(data(), metadata(), metadata(changed));
        await expect(readMcpSnapshot(TOKEN, fetcher)).rejects.toMatchObject({ code: 'snapshot_conflict' });
        expect(fetcher).toHaveBeenCalledTimes(4);
    });

    it('rejects stale versions before any upload', async () => {
        const fetcher = fetchQueue(listing(), json(metadata({ version: '8', etag: '"new"' })));
        await expect(writeMcpSnapshot(TOKEN, snapshot(), data(), fetcher)).rejects.toMatchObject({ code: 'snapshot_conflict' });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('honors a racing PWA write through 412 and never retries without If-Match', async () => {
        const fetcher = fetchQueue(listing(), json(metadata()), json({ error: 'private upstream detail' }, 412));
        await expect(writeMcpSnapshot(TOKEN, snapshot(), data(), fetcher)).rejects.toMatchObject({ code: 'snapshot_conflict' });
        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('If-Match')).toBe(snapshot().etag);
    });

    it.each([undefined, '', '*', 'W/"weak"', 'unquoted', '"tag", "other"'])('fails closed for missing or unsafe ETags: %s', async etag => {
        const fetcher = fetchQueue(listing(), json(metadata({ etag })));
        await expect(readMcpSnapshot(TOKEN, fetcher)).rejects.toMatchObject({ code: 'missing_etag' });
        const writeFetcher = fetchQueue();
        await expect(writeMcpSnapshot(TOKEN, { ...snapshot(), etag: etag as string }, data(), writeFetcher))
            .rejects.toMatchObject({ code: 'missing_etag' });
        expect(writeFetcher).not.toHaveBeenCalled();
    });

    it.each([
        { items: [{ id: FILE_ID, title: FILE_NAME }, { id: 'another', title: FILE_NAME }] },
        { items: [{ id: FILE_ID, title: FILE_NAME }], nextPageToken: 'more-results' },
        { items: [{ id: FILE_ID, title: FILE_NAME }], incompleteSearch: true },
    ])('refuses duplicate or incomplete discovery: %j', async payload => {
        const fetcher = fetchQueue(json(payload));
        await expect(readMcpSnapshot(TOKEN, fetcher)).rejects.toMatchObject({ code: 'ambiguous_snapshot' });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('requires the PWA to initialize the hidden sync file', async () => {
        const fetcher = fetchQueue(json({ items: [] }));
        await expect(readMcpSnapshot(TOKEN, fetcher)).rejects.toMatchObject({ code: 'missing_snapshot' });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it.each([
        null,
        { items: 'invalid' },
        { items: [{ id: 'bad/id', title: FILE_NAME }] },
        { items: [{ id: FILE_ID, title: 'outlook-calendar.json' }] },
        { items: [], incompleteSearch: 'false' },
    ])('rejects malformed discovery responses: %j', async payload => {
        await expect(readMcpSnapshot(TOKEN, fetchQueue(json(payload)))).rejects.toMatchObject({ code: 'invalid_drive_response' });
    });

    it.each([
        { id: 'different-file' }, { spaces: ['drive'] }, { title: 'other.json' },
        { labels: { trashed: true } }, { version: 7 }, { mimeType: 'text/html' }, { fileSize: 'no-size' },
    ])('rejects malformed or out-of-scope metadata: %j', async changed => {
        await expect(readMcpSnapshot(TOKEN, fetchQueue(listing(), json(metadata(changed)))))
            .rejects.toMatchObject({ code: 'invalid_drive_response' });
    });

    it.each([
        null, {}, { ...data(), tasks: 'invalid' }, { ...data(), settings: [] },
        { ...data(), tasks: [{ ...data().tasks[0], status: 'unknown' }] },
        { ...data(), tasks: [{ ...data().tasks[0], checklist: [{ id: 'check', title: 'Bad', isCompleted: 'false' }] }] },
        { ...data(), tasks: [data().tasks[0], data().tasks[0]] },
        { ...data(), tasks: [{ ...data().tasks[0], planner: { version: 2, blocks: [], days: [] } }] },
    ])('rejects malformed or unsupported snapshots without normalizing them: %j', async payload => {
        await expect(readMcpSnapshot(TOKEN, readQueue(payload))).rejects.toMatchObject({ code: 'invalid_snapshot' });
        const fetcher = fetchQueue();
        await expect(writeMcpSnapshot(TOKEN, snapshot(), payload as AppData, fetcher)).rejects.toMatchObject({ code: 'invalid_snapshot' });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each(['title', 'description', 'parentTaskId', 'projectId', 'areaId', 'startTime', 'availableAt',
        'scheduledAt', 'dueDate', 'completedAt', 'deletedAt', 'timeEstimate', 'isFocusedToday'])
    ('rejects objects hidden in the known %s task field on reads and writes', async field => {
        await expectInvalidTask({ [field]: { privateExtension: 'must-not-be-displayed' } });
    });

    it.each([null, 42, ['text']])('rejects non-string optional descriptions: %j', async description => {
        await expectInvalidTask({ description });
    });

    it.each([
        null, 'hourly', ['daily'], { rule: ['daily'] }, { rule: 'daily', until: {} },
        { rule: 'daily', seriesId: {} }, { rule: 'daily', strategy: 'unknown' },
        { rule: 'weekly', byDay: [{ privateExtension: 'hidden' }] },
        { rule: 'weekly', byDay: ['5MO'] }, { rule: 'weekly', weekStart: ['MO'] },
        { rule: 'monthly', byMonthDay: ['1'] }, { rule: 'monthly', byMonthDay: [32] },
        { rule: 'daily', count: {} }, { rule: 'daily', count: 0 },
        { rule: 'daily', completedOccurrences: -1 }, { rule: 'monthly', anchorDay: 32 },
        { rule: 'daily', rrule: {} },
    ])('rejects malformed recurrence values without coercing or exposing them: %j', async recurrence => {
        await expectInvalidTask({ recurrence });
    });

    it.each([
        ['contentStamp.manualAt', { ...planner(), contentStamp: { ...planner().contentStamp, manualAt: {} } }],
        ['block.manualBy', { ...planner(), blocks: [{ ...planner().blocks[0], manualBy: {} }] }],
        ['day.manualAt', { ...planner(), days: [{ ...planner().days[0], manualAt: {} }] }],
        ['block.reason', { ...planner(), blocks: [{ ...planner().blocks[0], reason: {} }] }],
        ['history.reason', { ...planner(), blocks: [{ ...planner().blocks[0], history: [{ ...planner().blocks[0].history[0], reason: {} }] }] }],
        ['block.state', { ...planner(), blocks: [{ ...planner().blocks[0], state: ['scheduled'] }] }],
        ['block.origin', { ...planner(), blocks: [{ ...planner().blocks[0], origin: ['manual'] }] }],
        ['legacyFocus', { ...planner(), legacyFocus: {} }],
        ['legacySchedule', { ...planner(), legacySchedule: {} }],
        ['skippedAt', { ...planner(), skippedAt: {} }],
    ])('rejects malformed known planner scalar %s', async (_field, value) => {
        await expectInvalidTask({ planner: value });
    });

    it('preserves valid recurrence, documented nullable archive evidence and unknown nested extensions', async () => {
        const value = planner();
        const payload = { ...data(), tasks: [{ ...data().tasks[0],
            completedAtBeforeProjectArchive: null, isFocusedTodayBeforeProjectArchive: null,
            recurrence: { rule: 'monthly', seriesId: 'series-one', strategy: 'strict', byDay: ['1MO', '-1FR'],
                byMonthDay: [1, 31], weekStart: 'MO', count: 10, completedOccurrences: 0,
                anchorDay: 31, startAnchorDay: 1, dueAnchorDay: 31, reviewAnchorDay: 15, until: DATE,
                rrule: 'FREQ=MONTHLY', futureRecurrence: { opaque: 'retain' } },
            planner: { ...value, futurePlanner: { opaque: 'retain' },
                contentStamp: { ...value.contentStamp, futureStamp: { opaque: 'retain' } },
                blocks: [{ ...value.blocks[0], futureBlock: { opaque: 'retain' },
                    history: [{ ...value.blocks[0].history[0], futureHistory: { opaque: 'retain' } }] }],
                days: [{ ...value.days[0], futureDay: { opaque: 'retain' } }] },
        }] };
        const current = await readMcpSnapshot(TOKEN, readQueue(payload));
        expect(current.data).toEqual(payload);
        const fetcher = fetchQueue(listing(), json(metadata()), json({ id: FILE_ID, version: '8' }));
        await expect(writeMcpSnapshot(TOKEN, current, current.data, fetcher)).resolves.toBe('8');
        expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual(payload);
    });

    it.each(['daily', 'weekly', 'monthly', 'yearly'])('accepts a supported legacy recurrence string %s', async recurrence => {
        const payload = { ...data(), tasks: [{ ...data().tasks[0], recurrence }] };
        expect((await readMcpSnapshot(TOKEN, readQueue(payload))).data).toEqual(payload);
    });

    it.each([{ encrypted: true }, { ciphertext: 'opaque' }, { schemaVersion: 99 }, { version: 2 }])('rejects unsupported envelopes: %j', async envelope => {
        await expect(readMcpSnapshot(TOKEN, readQueue({ ...data(), ...envelope })))
            .rejects.toMatchObject({ code: 'unsupported_snapshot' });
    });

    it('rejects Drive client-side encryption metadata', async () => {
        const fetcher = fetchQueue(listing(), json(metadata({ clientEncryptionDetails: {} })));
        await expect(readMcpSnapshot(TOKEN, fetcher)).rejects.toMatchObject({ code: 'unsupported_snapshot' });
    });

    it('rejects oversized metadata before downloading content', async () => {
        const fetcher = fetchQueue(listing(), json(metadata({ fileSize: String(MAX_MCP_SNAPSHOT_BYTES + 1) })));
        await expect(readMcpSnapshot(TOKEN, fetcher)).rejects.toMatchObject({ code: 'snapshot_too_large' });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('enforces the byte limit on chunked content without trusting Content-Length', async () => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(MAX_MCP_SNAPSHOT_BYTES));
                controller.enqueue(new Uint8Array(1));
                controller.close();
            },
        });
        const oversized = new Response(stream, { headers: { 'Content-Type': 'application/json' } });
        const fetcher = fetchQueue(listing(), json(metadata()), oversized);
        await expect(readMcpSnapshot(TOKEN, fetcher)).rejects.toMatchObject({ code: 'snapshot_too_large' });
    });

    it('rejects oversized writes before any network request', async () => {
        const next = data();
        next.tasks[0].description = 'x'.repeat(MAX_MCP_SNAPSHOT_BYTES);
        const fetcher = fetchQueue();
        await expect(writeMcpSnapshot(TOKEN, snapshot(), next, fetcher)).rejects.toMatchObject({ code: 'snapshot_too_large' });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each([
        new Response('{bad json', { headers: { 'Content-Type': 'application/json' } }),
        new Response('<html>sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
    ])('refuses non-JSON and malformed JSON responses', async response => {
        await expect(readMcpSnapshot(TOKEN, fetchQueue(response))).rejects.toMatchObject({ code: 'invalid_drive_response' });
    });

    it('does not expose upstream response bodies or credentials in errors', async () => {
        const privateContent = 'private task title and fixture-token-not-a-real-credential';
        const error = await readMcpSnapshot(TOKEN, fetchQueue(json({ error: privateContent }, 403))).catch(value => value);
        expect(error).toMatchObject({ code: 'drive_unauthorized', status: 401 });
        expect(String(error)).not.toContain(privateContent);
        expect(String(error)).not.toContain(TOKEN);
    });

    it('rejects redirects without following or forwarding the bearer token', async () => {
        const fetcher = fetchQueue(new Response(null, { status: 302, headers: { Location: 'https://other.example.invalid/' } }));
        await expect(readMcpSnapshot(TOKEN, fetcher)).rejects.toMatchObject({ code: 'drive_unavailable' });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
    });

    it.each([
        new Error('upstream network detail'),
        json({ error: 'upstream detail' }, 503),
        json({ id: FILE_ID }),
        json({ id: FILE_ID, version: '7' }),
        json({ id: 'different-file', version: '8' }),
    ])('reports uncertain upload outcomes without automatic replay', async response => {
        const fetcher = fetchQueue(listing(), json(metadata()), response);
        await expect(writeMcpSnapshot(TOKEN, snapshot(), data(), fetcher)).rejects.toMatchObject({ code: 'write_outcome_unknown' });
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
});
