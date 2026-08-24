import type { ExternalCalendarEvent, ExternalCalendarSubscription } from '@mindwtr/core';

import {
    getGoogleDriveConnection,
    googleDriveFetch,
    GoogleDriveApiError,
} from './google-drive-sync';

const DRIVE_API_ROOT = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v3';
const EXPORT_FILE_NAME = 'outlook-calendar.json';
const EXPORT_FILE_MARKER_KEY = 'attentionPlannerRole';
const EXPORT_FILE_MARKER_VALUE = 'outlookCalendarExport';

export const GOOGLE_DRIVE_OUTLOOK_SOURCE_ID = 'outlook-google-drive';

type DriveFileMetadata = {
    id?: string;
    modifiedTime?: string;
    name?: string;
    version?: string;
    webViewLink?: string;
};

type JsonRecord = Record<string, unknown>;

export type GoogleDriveCalendarExportStatus = {
    connected: boolean;
    fileReady: boolean;
    modifiedTime: string | null;
};

export type GoogleDriveCalendarFetchResult = {
    calendar: ExternalCalendarSubscription;
    events: ExternalCalendarEvent[];
};

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function parseGoogleApiError(response: Response, fallback: string): Promise<GoogleDriveApiError> {
    let detail = '';
    try {
        const payload = await response.json() as { error?: { message?: string } };
        detail = payload.error?.message?.trim() || '';
    } catch {
        // Status plus fallback remains useful when Google returns no JSON.
    }
    return new GoogleDriveApiError(response.status, detail || fallback);
}

function escapeDriveQueryString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listExportFiles(): Promise<DriveFileMetadata[]> {
    const params = new URLSearchParams({
        fields: 'files(id,name,version,modifiedTime,webViewLink)',
        orderBy: 'modifiedTime desc',
        pageSize: '10',
        q: `appProperties has { key='${escapeDriveQueryString(EXPORT_FILE_MARKER_KEY)}' and value='${escapeDriveQueryString(EXPORT_FILE_MARKER_VALUE)}' } and trashed = false`,
        spaces: 'drive',
    });
    const response = await googleDriveFetch(`${DRIVE_API_ROOT}/files?${params}`);
    if (!response.ok) {
        throw await parseGoogleApiError(response, `Google Drive calendar file lookup failed (${response.status}).`);
    }
    const payload = await response.json() as { files?: DriveFileMetadata[] };
    const files = Array.isArray(payload.files) ? payload.files.filter((file) => file.id) : [];
    if (files.length > 1) {
        throw new Error('Google Drive contains multiple Outlook calendar export files. Remove the duplicate before continuing.');
    }
    return files;
}

async function readExportFileMetadata(): Promise<DriveFileMetadata | null> {
    return (await listExportFiles())[0] ?? null;
}

function createMultipartBody(): { body: Blob; contentType: string } {
    const boundary = `attention_planner_calendar_${crypto.randomUUID().replace(/-/g, '')}`;
    const metadata = JSON.stringify({
        appProperties: { [EXPORT_FILE_MARKER_KEY]: EXPORT_FILE_MARKER_VALUE },
        mimeType: 'application/json',
        name: EXPORT_FILE_NAME,
    });
    const initialContent = JSON.stringify({
        schemaVersion: 1,
        generatedAt: null,
        events: [],
    });
    const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${initialContent}\r\n`,
        `--${boundary}--`,
    ]);
    return { body, contentType: `multipart/related; boundary=${boundary}` };
}

async function createExportFile(): Promise<DriveFileMetadata> {
    const multipart = createMultipartBody();
    const response = await googleDriveFetch(
        `${DRIVE_UPLOAD_ROOT}/files?uploadType=multipart&fields=id,name,version,modifiedTime,webViewLink`,
        {
            body: multipart.body,
            headers: { 'Content-Type': multipart.contentType },
            method: 'POST',
        },
    );
    if (!response.ok) {
        throw await parseGoogleApiError(response, `Google Drive calendar file creation failed (${response.status}).`);
    }
    return await response.json() as DriveFileMetadata;
}

export async function getGoogleDriveCalendarExportStatus(): Promise<GoogleDriveCalendarExportStatus> {
    const connection = await getGoogleDriveConnection();
    if (!connection.connected) return { connected: false, fileReady: false, modifiedTime: null };
    const metadata = await readExportFileMetadata();
    return {
        connected: true,
        fileReady: Boolean(metadata?.id),
        modifiedTime: metadata?.modifiedTime ?? null,
    };
}

export async function ensureGoogleDriveCalendarExportFile(): Promise<GoogleDriveCalendarExportStatus> {
    const connection = await getGoogleDriveConnection();
    if (!connection.connected) {
        throw new Error('请先在“设置 → 同步”连接 Google Drive。');
    }
    const existing = await readExportFileMetadata();
    const metadata = existing ?? await createExportFile();
    return {
        connected: true,
        fileReady: Boolean(metadata.id),
        modifiedTime: metadata.modifiedTime ?? null,
    };
}

function firstValue(record: JsonRecord, keys: string[]): unknown {
    for (const key of keys) {
        if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return undefined;
}

function normalizeText(value: unknown): string | undefined {
    if (typeof value === 'string') return value.trim() || undefined;
    if (!isRecord(value)) return undefined;
    const nested = firstValue(value, ['displayName', 'name', 'address', 'value']);
    return typeof nested === 'string' ? nested.trim() || undefined : undefined;
}

function normalizeDateTime(value: unknown): string | null {
    const raw = typeof value === 'string'
        ? value.trim()
        : isRecord(value) && typeof value.dateTime === 'string'
            ? value.dateTime.trim()
            : '';
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function eventArray(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (!isRecord(payload)) return [];
    if (Array.isArray(payload.events)) return payload.events;
    if (Array.isArray(payload.value)) return payload.value;
    return [];
}

export function mapGoogleDriveOutlookEvent(value: unknown, index = 0): ExternalCalendarEvent | null {
    if (!isRecord(value)) return null;
    const start = normalizeDateTime(firstValue(value, ['startWithTimeZone', 'start', 'Start']));
    const end = normalizeDateTime(firstValue(value, ['endWithTimeZone', 'end', 'End']));
    if (!start || !end) return null;
    const nativeId = normalizeText(firstValue(value, ['id', 'Id', 'eventId'])) || `${index}:${start}`;
    const title = normalizeText(firstValue(value, ['title', 'subject', 'Subject'])) || '(Untitled Outlook event)';
    const location = normalizeText(firstValue(value, ['location', 'Location']));
    const allDayValue = firstValue(value, ['allDay', 'isAllDay', 'IsAllDay']);
    return {
        id: `${GOOGLE_DRIVE_OUTLOOK_SOURCE_ID}:${nativeId}`,
        sourceId: GOOGLE_DRIVE_OUTLOOK_SOURCE_ID,
        nativeEventId: nativeId,
        title,
        start,
        end,
        allDay: allDayValue === true || allDayValue === 'true',
        location,
    };
}

export async function fetchGoogleDriveCalendarEvents(
    rangeStart: Date,
    rangeEnd: Date,
): Promise<GoogleDriveCalendarFetchResult | null> {
    const connection = await getGoogleDriveConnection();
    if (!connection.connected) return null;
    const metadata = await readExportFileMetadata();
    if (!metadata?.id) return null;
    const response = await googleDriveFetch(
        `${DRIVE_API_ROOT}/files/${encodeURIComponent(metadata.id)}?alt=media`,
    );
    if (!response.ok) {
        throw await parseGoogleApiError(response, `Google Drive calendar download failed (${response.status}).`);
    }
    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new Error('The Outlook calendar export file is not valid JSON.');
    }
    const events = eventArray(payload)
        .map((event, index) => mapGoogleDriveOutlookEvent(event, index))
        .filter((event): event is ExternalCalendarEvent => Boolean(event))
        .filter((event) => Date.parse(event.start) < rangeEnd.getTime() && Date.parse(event.end) > rangeStart.getTime());
    return {
        calendar: {
            id: GOOGLE_DRIVE_OUTLOOK_SOURCE_ID,
            name: 'Outlook (Google Drive)',
            url: 'gdrive://outlook-calendar.json',
            enabled: true,
            color: '#0078d4',
        },
        events,
    };
}
