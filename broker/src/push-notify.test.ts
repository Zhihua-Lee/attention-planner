import { describe, expect, it } from 'vitest';

import { NotificationDevice } from './index';

/** Just enough of a Durable Object's state for NotificationDevice. */
function fakeState() {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    data,
    alarm: () => alarm,
    state: {
      storage: {
        get: async (key: string) => data.get(key),
        put: async (key: string, value: unknown) => void data.set(key, value),
        deleteAll: async () => data.clear(),
        setAlarm: async (at: number) => void (alarm = at),
        deleteAlarm: async () => void (alarm = null),
      },
    },
  };
}
const post = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

describe('notifying every device of an account', () => {
  it("keeps a list of the account's devices", async () => {
    const { state } = fakeState();
    const registry = new NotificationDevice(state as never, {} as never);
    const call = async (path: string, deviceId?: string) =>
      (await (await registry.fetch(post(`https://registry.internal${path}`, { deviceId }))).json()) as {
        devices: string[];
      };
    await call('/register', 'phone-device-id-0000000001');
    await call('/register', 'laptop-device-id-000000002');
    await call('/register', 'phone-device-id-0000000001');
    expect((await call('/devices')).devices).toEqual(['phone-device-id-0000000001', 'laptop-device-id-000000002']);
    await call('/unregister', 'phone-device-id-0000000001');
    expect((await call('/devices')).devices).toEqual(['laptop-device-id-000000002']);
  });

  it('schedules an opaque notification at once on a device with push on, and refuses one without', async () => {
    const on = fakeState();
    on.data.set('config', {
      reminders: [],
      subscription: { endpoint: 'https://push.example/x', keys: {} },
      updatedAt: 0,
    });
    const device = new NotificationDevice(on.state as never, {} as never);
    const res = await device.fetch(post('https://device.internal/notify', { id: 'p_abcdefghijklmnopqrst' }));
    expect(res.status).toBe(200);
    const config = on.data.get('config') as { reminders: { id: string; fireAt: number }[] };
    expect(config.reminders.map((r) => r.id)).toEqual(['p_abcdefghijklmnopqrst']);
    expect(on.alarm()).toBeGreaterThan(Date.now() - 1_000);
    const off = new NotificationDevice(fakeState().state as never, {} as never);
    expect((await off.fetch(post('https://device.internal/notify', { id: 'p_abcdefghijklmnopqrst' }))).status).toBe(
      409,
    );
  });
});
