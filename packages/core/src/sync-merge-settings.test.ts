import { describe, expect, it } from 'vitest';
import { mergeSettingsForSync } from './sync-merge-settings';
import type { AppData } from './types';

type Settings = AppData['settings'];

// #742 (2026-07-16 comment): naturalLanguageDates is a synced GTD boolean.
// Per P14 (#120), explicit values always beat an unset/default value on a
// peer, regardless of which side's sync timestamp is newer — a device that
// never touched the field must never overwrite a peer that set it.
describe('mergeSettingsForSync > gtd.naturalLanguageDates', () => {
    it('an incoming explicit false survives merge against a local peer without the field', () => {
        const local: Settings = { gtd: {} };
        const incoming: Settings = { gtd: { naturalLanguageDates: false } };

        const merged = mergeSettingsForSync(local, incoming);

        expect(merged.gtd?.naturalLanguageDates).toBe(false);
    });

    it('a local explicit false survives merge against an incoming peer without the field', () => {
        const local: Settings = { gtd: { naturalLanguageDates: false } };
        const incoming: Settings = { gtd: {} };

        const merged = mergeSettingsForSync(local, incoming);

        expect(merged.gtd?.naturalLanguageDates).toBe(false);
    });

    it('an incoming explicit false survives even when the local peer set a newer gtd timestamp for other fields', () => {
        const local: Settings = {
            gtd: { defaultScheduleTime: '09:00' },
            syncPreferencesUpdatedAt: { gtd: '2026-07-16T12:00:00.000Z' },
        };
        const incoming: Settings = {
            gtd: { naturalLanguageDates: false },
            syncPreferencesUpdatedAt: { gtd: '2026-07-01T00:00:00.000Z' },
        };

        const merged = mergeSettingsForSync(local, incoming);

        // The local device's newer gtd timestamp wins the tiebreaker for
        // fields both sides set differently, but naturalLanguageDates is
        // unset locally, so the incoming explicit value still applies.
        expect(merged.gtd?.naturalLanguageDates).toBe(false);
        expect(merged.gtd?.defaultScheduleTime).toBe('09:00');
    });

    it('both sides explicit and differing: the newer peer (by gtd sync timestamp) wins', () => {
        const local: Settings = {
            gtd: { naturalLanguageDates: true },
            syncPreferencesUpdatedAt: { gtd: '2026-07-01T00:00:00.000Z' },
        };
        const incoming: Settings = {
            gtd: { naturalLanguageDates: false },
            syncPreferencesUpdatedAt: { gtd: '2026-07-16T12:00:00.000Z' },
        };

        const merged = mergeSettingsForSync(local, incoming);

        expect(merged.gtd?.naturalLanguageDates).toBe(false);
    });

    it('neither side sets the field: merged gtd omits it (default true applies at read time)', () => {
        const local: Settings = { gtd: { defaultScheduleTime: '09:00' } };
        const incoming: Settings = { gtd: {} };

        const merged = mergeSettingsForSync(local, incoming);

        expect(merged.gtd?.naturalLanguageDates).toBeUndefined();
    });
});

describe('mergeSettingsForSync > gtd.attentionFrames', () => {
    it('keeps valid frames and drops malformed remote frames', () => {
        const local: Settings = { gtd: {} };
        const incoming: Settings = {
            gtd: {
                attentionFrames: [
                    {
                        id: 'frame-1',
                        name: 'Deep work',
                        startTime: '09:00',
                        endTime: '11:00',
                        days: [1, 2, 3, 4, 5],
                        matchTokens: ['@Desk', '@desk'],
                    },
                    {
                        id: '',
                        name: 'Invalid',
                        startTime: 'noon',
                        endTime: '13:00',
                        days: [],
                    },
                ],
            },
        };

        const merged = mergeSettingsForSync(local, incoming);

        expect(merged.gtd?.attentionFrames).toEqual([{
            id: 'frame-1',
            name: 'Deep work',
            startTime: '09:00',
            endTime: '11:00',
            days: [1, 2, 3, 4, 5],
            matchTokens: ['@desk'],
        }]);
    });
});
