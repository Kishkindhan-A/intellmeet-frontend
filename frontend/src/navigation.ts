import { useSyncExternalStore } from 'react';

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};

export function useBrowserLocation() {
  return useSyncExternalStore(subscribe, () => location.pathname + location.search);
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function navigate(path: string, replace = false) {
  const target = new URL(path, location.href);
  if (target.origin !== location.origin) throw new Error('Navigation must stay on this website');
  if (
    target.pathname + target.search + target.hash ===
    location.pathname + location.search + location.hash
  )
    return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function signedInDestination(next: string | null): string {
  if (next === 'profile') return '/profile';
  if (!next?.startsWith('/') || next.startsWith('//')) return '/workspace/overview';
  const target = new URL(next, location.origin);
  if (
    target.origin !== location.origin ||
    !/^\/(workspace(?:\/|$)|profile$|settings$)/.test(target.pathname)
  )
    return '/workspace/overview';
  return target.pathname + target.search;
}
