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
