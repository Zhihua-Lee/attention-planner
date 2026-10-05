import { inRounds } from '../model/doc';
import { reminders } from '../model/reminders';
import type { Doc } from '../model/types';

/**
 * Push reminders through the sync broker's web-push service (same origin, `/api/push/*`).
 * The broker stores only the subscription, opaque reminder ids and their times; the service worker turns an id back
 * into a task title on the device.
 */
const API = '/api/push';
const KEY = 'ap:push-device';

export type PushState = 'unsupported' | 'off' | 'on' | 'denied';

/** The broker wants a 20–80 character device id, separate from the short sync device id. */
function pushDevice(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(36).padStart(2, '0')).join('');
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'device-without-storage-0000';
  }
}

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && localStorage.getItem('ap:push') === 'on' ? 'on' : 'off';
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) throw new Error('signed-out');
  if (!res.ok) throw new Error(`The reminder service answered ${res.status}.`);
}

/** Ask for permission (must run from a tap), subscribe, and send the current reminders. */
export async function enablePush(doc: Doc): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const config = await fetch(`${API}/config`, { credentials: 'same-origin' });
  if (config.status === 401 || config.status === 403) throw new Error('signed-out');
  if (!config.ok) throw new Error(`The reminder service answered ${config.status}.`);
  const { vapidPublicKey } = (await config.json()) as { vapidPublicKey: string };
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) }));
  localStorage.setItem('ap:push', 'on');
  await syncReminders(doc, sub);
  return 'on';
}

export async function disablePush(): Promise<void> {
  localStorage.removeItem('ap:push');
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await post('/unsubscribe', { deviceId: pushDevice() }).catch(() => undefined);
  await sub?.unsubscribe();
}

export const testPush = () => post('/test', { deviceId: pushDevice() });

let last = '';
/** Send the reminder list when it changed. Quietly does nothing when push is off. */
export async function syncReminders(doc: Doc, given?: PushSubscription | null): Promise<void> {
  if (!pushSupported() || localStorage.getItem('ap:push') !== 'on') return;
  const sub = given ?? (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription());
  if (!sub) return;
  const now = new Date();
  const list = reminders(inRounds(doc, now), now);
  const signature = JSON.stringify(list);
  if (signature === last && !given) return;
  await post('/sync', { deviceId: pushDevice(), subscription: sub.toJSON(), reminders: list });
  last = signature;
}
