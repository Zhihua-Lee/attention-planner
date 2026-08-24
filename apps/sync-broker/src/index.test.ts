import { describe, expect, it } from 'vitest';

import { __brokerTestUtils } from './index';

const encryptionSecret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('sync broker security boundaries', () => {
    it('round-trips refresh tokens without storing plaintext', async () => {
        const encrypted = await __brokerTestUtils.encryptText('refresh-token-value', encryptionSecret);
        expect(encrypted).not.toContain('refresh-token-value');
        await expect(__brokerTestUtils.decryptText(encrypted, encryptionSecret)).resolves.toBe('refresh-token-value');
    });

    it('only permits local return paths', () => {
        expect(__brokerTestUtils.sanitizeReturnTo('/?view=settings')).toBe('/?view=settings');
        expect(__brokerTestUtils.sanitizeReturnTo('https://attacker.example/')).toBe('/?view=settings');
        expect(__brokerTestUtils.sanitizeReturnTo('//attacker.example/')).toBe('/?view=settings');
        expect(__brokerTestUtils.sanitizeReturnTo('/safe\r\nLocation: https://attacker.example')).toBe('/?view=settings');
    });

    it('strips task content from accepted reminder records', () => {
        const fireAt = Date.now() + 60_000;
        const reminders = __brokerTestUtils.validateReminders([{
            id: 'opaque_reminder_id_1234',
            fireAt,
            title: 'private task title',
            description: 'private task body',
        }]);
        expect(reminders).toEqual([{ id: 'opaque_reminder_id_1234', fireAt }]);
        expect(reminders[0]).not.toHaveProperty('title');
        expect(reminders[0]).not.toHaveProperty('description');
    });

    it('rejects insecure push endpoints', () => {
        expect(() => __brokerTestUtils.validateSubscription({
            endpoint: 'http://127.0.0.1/internal',
            keys: { auth: 'a', p256dh: 'b' },
        })).toThrow('Invalid push subscription');
    });
});
