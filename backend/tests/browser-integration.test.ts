import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
afterEach(() => vi.unstubAllGlobals());
it('never intercepts API or third-party requests in the offline worker', () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  runInNewContext(readFileSync(new URL('../../frontend/public/sw.js', import.meta.url), 'utf8'), {
    self: {
      location: { origin: 'https://app.example' },
      addEventListener: (name: string, handler: (typeof handlers)[string]) => {
        handlers[name] = handler;
      },
    },
    URL,
  });
  for (const [url, mode, method] of [
    ['https://app.example/api/auth/me', 'navigate', 'GET'],
    ['https://app.example/health/ready', 'navigate', 'GET'],
    ['https://app.example/socket.io', 'navigate', 'GET'],
    ['https://outside.example/workspace', 'navigate', 'GET'],
    ['https://app.example/api/notes', 'cors', 'POST'],
  ]) {
    const respondWith = vi.fn();
    handlers.fetch({ request: { url, mode, method }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  }
});
it('serves only a public reconnect page when navigation loses the network', async () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const fallback = { public: true };
  const match = vi.fn().mockResolvedValue(fallback);
  runInNewContext(readFileSync(new URL('../../frontend/public/sw.js', import.meta.url), 'utf8'), {
    self: {
      location: { origin: 'https://app.example' },
      addEventListener: (name: string, handler: (typeof handlers)[string]) => {
        handlers[name] = handler;
      },
    },
    URL,
    fetch: vi.fn().mockRejectedValue(new Error('offline')),
    caches: { match },
    Response,
  });
  const respondWith = vi.fn();
  handlers.fetch({
    request: { url: 'https://app.example/workspace/tasks', mode: 'navigate', method: 'GET' },
    respondWith,
  });
  await expect(respondWith.mock.calls[0][0]).resolves.toBe(fallback);
  expect(match).toHaveBeenCalledExactlyOnceWith('/offline.html');
});
it('syncs validated browser preferences across tabs without writing them back', async () => {
  vi.resetModules();
  const events = new EventTarget();
  const write = vi.fn();
  vi.stubGlobal('window', events);
  vi.stubGlobal('localStorage', { getItem: () => '{}', setItem: write });
  const store = await import('../../frontend/src/browserPreferenceStore');
  const event = new Event('storage');
  Object.assign(event, {
    key: 'intellmeet.browser-preferences.v1',
    newValue: '{"compact":true,"desktopAlerts":"invalid"}',
  });
  events.dispatchEvent(event);
  expect(store.snapshot().compact).toBe(true);
  expect(store.snapshot().desktopAlerts).toBe(false);
  expect(write).not.toHaveBeenCalled();
});
it('removes private in-memory note drafts when the session ends', async () => {
  vi.resetModules();
  const events = new EventTarget();
  vi.stubGlobal('window', events);
  const { noteDrafts } = await import('../../frontend/src/noteDrafts');
  noteDrafts.set('user:meeting', { text: 'private draft', revision: 3 });
  events.dispatchEvent(new Event('session-ended'));
  expect(noteDrafts.size).toBe(0);
});
