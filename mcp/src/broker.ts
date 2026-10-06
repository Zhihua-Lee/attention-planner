import type { TokenSource } from '../../src/store/drive';

/**
 * Google access goes through the existing sync broker (the Worker at /api/*), which keeps the Google refresh token.
 * The broker knows the owner by its session cookie, so a connection keeps the cookie of the browser that allowed
 * it (inside the OAuth grant, encrypted) and presents it when it needs a token. The broker itself is unchanged.
 */
export const SESSION_COOKIE = 'attention_planner_session';

export type Broker = { fetch(request: Request): Promise<Response> };

export function sessionOf(request: Request): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim() || null;
  }
  return null;
}

const call = (broker: Broker, origin: string, session: string, path: string, method: 'GET' | 'POST', body?: unknown) =>
  broker.fetch(
    new Request(`${origin}/api${path}`, {
      method,
      headers: {
        Cookie: `${SESSION_COOKIE}=${session}`,
        Origin: origin,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );

/**
 * Ask the broker to notify every device of the owner that has reminders on. Only an opaque id travels (`ai_<id>`);
 * each device words the notification itself. Best effort: a failure never stops the proposal.
 */
export async function notifyDevices(
  broker: Broker,
  origin: string,
  session: string,
  proposalId: string,
): Promise<void> {
  try {
    await call(broker, origin, session, '/push/notify', 'POST', { id: `ai_${proposalId}` });
  } catch {
    /* the proposal is kept anyway; the app shows it on its next sync */
  }
}

/** Whether this session belongs to the owner and Google Drive is connected. */
export async function sessionConnected(broker: Broker, origin: string, session: string | null): Promise<boolean> {
  if (!session) return false;
  const res = await call(broker, origin, session, '/google/status', 'GET');
  if (!res.ok) return false;
  return !!((await res.json()) as { connected?: boolean }).connected;
}

export const EXPIRED =
  'The sign-in this connection was made with has expired. Open Attention Planner in the browser, then reconnect this AI to it.';

/** Google access tokens for a session, reused until a minute before they expire. */
export function brokerTokens(broker: Broker, origin: string, session: string): TokenSource {
  let cached: { token: string; until: number } | null = null;
  return async () => {
    if (cached && Date.now() < cached.until) return cached.token;
    const res = await call(broker, origin, session, '/google/token', 'POST');
    if (res.status === 401 || res.status === 403) throw new Error(EXPIRED);
    if (!res.ok) throw new Error(`The sync broker answered ${res.status}.`);
    const body = (await res.json()) as { accessToken?: string; expiresIn?: number };
    if (!body.accessToken) throw new Error('The sync broker returned no access token.');
    cached = { token: body.accessToken, until: Date.now() + Math.max(60, (body.expiresIn ?? 3600) - 60) * 1000 };
    return body.accessToken;
  };
}
