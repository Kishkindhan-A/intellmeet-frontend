import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { navigate } from '../../frontend/src/navigation';
let address: URL;
let pushes: ReturnType<typeof vi.fn>;
let replacements: ReturnType<typeof vi.fn>;
let events: EventTarget;
beforeEach(() => {
  address = new URL('https://intellmeet.example/workspace/overview');
  events = new EventTarget();
  vi.stubGlobal('location', address);
  vi.stubGlobal('window', events);
  vi.stubGlobal('PopStateEvent', class extends Event {});
  pushes = vi.fn((_state, _unused, path) => {
    address = new URL(path, address);
    vi.stubGlobal('location', address);
  });
  replacements = vi.fn((_state, _unused, path) => {
    address = new URL(path, address);
    vi.stubGlobal('location', address);
  });
  vi.stubGlobal('history', { pushState: pushes, replaceState: replacements });
});
afterEach(() => vi.unstubAllGlobals());
it('creates one history entry and notifies React for a workspace navigation', () => {
  const listener = vi.fn();
  events.addEventListener('popstate', listener);
  navigate('/workspace/tasks?workspace=team');
  expect(pushes).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledOnce();
  expect(address.pathname + address.search).toBe('/workspace/tasks?workspace=team');
  navigate('/workspace/tasks?workspace=team');
  expect(pushes).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledOnce();
});
it('supports replacing a route without adding an extra Back step', () => {
  navigate('/workspace/settings', true);
  expect(replacements).toHaveBeenCalledOnce();
  expect(pushes).not.toHaveBeenCalled();
});
it('rejects navigation to another origin without changing browser history', () => {
  expect(() => navigate('https://other.example/workspace')).toThrow('Navigation must stay');
  expect(pushes).not.toHaveBeenCalled();
});
