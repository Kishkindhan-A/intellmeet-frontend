import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const denied = (code = 'SESSION_EXPIRED', status = 401) =>
  json({ error: { code, message: 'Denied' } }, status);
let events: EventTarget;
let fetchMock: ReturnType<typeof vi.fn>;
const posted: string[] = [];
let channelListener: (event: { data: unknown }) => void;

beforeEach(() => {
  vi.resetModules();
  posted.length = 0;
  events = new EventTarget();
  vi.stubGlobal('window', events);
  vi.stubGlobal('navigator', { locks: { request: (_name: string, run: () => unknown) => run() } });
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      addEventListener(_event: string, listener: typeof channelListener) {
        channelListener = listener;
      }
      postMessage(message: string) {
        posted.push(message);
      }
    },
  );
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('frontend session client', () => {
  it('keeps credentials in memory and sends authenticated mutations with cookies and CSRF', async () => {
    const client = await import('../../frontend/src/api');
    client.setSession({ accessToken: 'unit-access', csrfToken: 'unit-csrf' });
    fetchMock.mockResolvedValue(json({ user: { name: 'Updated' } }));
    await client.api('/auth/me', 'PATCH', { name: 'Updated' });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/auth/me');
    expect(options.credentials).toBe('include');
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer unit-access',
      'X-CSRF-Token': 'unit-csrf',
    });
  });
  it('deduplicates concurrent session restoration', async () => {
    const client = await import('../../frontend/src/api');
    fetchMock
      .mockResolvedValueOnce(json({ csrfToken: 'unit-csrf' }))
      .mockResolvedValueOnce(json({ accessToken: 'unit-refreshed', csrfToken: 'unit-new-csrf' }));
    await Promise.all([client.restoreSession(), client.restoreSession()]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.getAccessToken()).toBe('unit-refreshed');
  });
  it('refreshes an expired access token and retries a protected profile read', async () => {
    const client = await import('../../frontend/src/api');
    fetchMock
      .mockResolvedValueOnce(denied())
      .mockResolvedValueOnce(json({ csrfToken: 'unit-csrf' }))
      .mockResolvedValueOnce(json({ accessToken: 'unit-refreshed', csrfToken: 'unit-new-csrf' }))
      .mockResolvedValueOnce(json({ user: { name: 'Restored' } }));
    expect(await client.api('/auth/me')).toEqual({ user: { name: 'Restored' } });
    expect(fetchMock.mock.calls[3]![1].headers.Authorization).toBe('Bearer unit-refreshed');
  });
  it('clears identity and notifies other tabs when refresh is rejected', async () => {
    const client = await import('../../frontend/src/api');
    client.setSession({ accessToken: 'unit-access', csrfToken: 'unit-csrf' });
    const ended = vi.fn();
    events.addEventListener('session-ended', ended);
    fetchMock.mockResolvedValueOnce(denied()).mockResolvedValueOnce(denied());
    await expect(client.api('/workspaces')).rejects.toMatchObject({ status: 401 });
    expect(client.getAccessToken()).toBe('');
    expect(ended).toHaveBeenCalledOnce();
    expect(posted).toEqual(['signed-out']);
  });
  it('clears a session when a protected retry is still unauthorized', async () => {
    const client = await import('../../frontend/src/api');
    fetchMock
      .mockResolvedValueOnce(denied())
      .mockResolvedValueOnce(json({ csrfToken: 'unit-csrf' }))
      .mockResolvedValueOnce(json({ accessToken: 'unit-new', csrfToken: 'unit-new-csrf' }))
      .mockResolvedValueOnce(denied());
    await expect(client.api('/auth/sessions/unit-id', 'DELETE')).rejects.toMatchObject({
      status: 401,
    });
    expect(client.getAccessToken()).toBe('');
    expect(posted).toEqual(['signed-out']);
  });
  it('preserves identity for incorrect current passwords and temporary network failures', async () => {
    const client = await import('../../frontend/src/api');
    client.setSession({ accessToken: 'unit-access', csrfToken: 'unit-csrf' });
    fetchMock.mockResolvedValueOnce(denied('INVALID_CREDENTIALS'));
    await expect(client.api('/auth/change-password', 'POST', {})).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'));
    await expect(client.api('/auth/me')).rejects.toThrow('Network unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.getAccessToken()).toBe('unit-access');
    expect(posted).toEqual([]);
  });
  it('recovers rotated CSRF once before retrying the rejected mutation', async () => {
    const client = await import('../../frontend/src/api');
    client.setSession({ accessToken: 'unit-access', csrfToken: 'unit-old-csrf' });
    fetchMock
      .mockResolvedValueOnce(denied('CSRF_INVALID', 403))
      .mockResolvedValueOnce(json({ csrfToken: 'unit-current-csrf' }))
      .mockResolvedValueOnce(json({ updated: true }));
    await expect(client.api('/auth/me', 'PATCH', { name: 'Updated' })).resolves.toEqual({
      updated: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![1].headers['X-CSRF-Token']).toBe('unit-current-csrf');
  });
  it('does not echo another tab’s sign-out broadcast', async () => {
    const client = await import('../../frontend/src/api');
    client.setSession({ accessToken: 'unit-access', csrfToken: 'unit-csrf' });
    const ended = vi.fn();
    events.addEventListener('session-ended', ended);
    channelListener({ data: 'signed-out' });
    expect(client.getAccessToken()).toBe('');
    expect(ended).toHaveBeenCalledOnce();
    expect(posted).toEqual([]);
  });
  it('preserves a refreshed session when reauthentication rejects an incorrect current password', async () => {
    const client = await import('../../frontend/src/api');
    fetchMock
      .mockResolvedValueOnce(denied())
      .mockResolvedValueOnce(json({ csrfToken: 'unit-csrf' }))
      .mockResolvedValueOnce(json({ accessToken: 'unit-new', csrfToken: 'unit-new-csrf' }))
      .mockResolvedValueOnce(denied('INVALID_CREDENTIALS'));
    await expect(client.api('/auth/change-password', 'POST', {})).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(client.getAccessToken()).toBe('unit-new');
    expect(posted).toEqual([]);
  });
});
