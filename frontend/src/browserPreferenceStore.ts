export type Preferences = { shortcuts: boolean; reducedMotion: boolean; compact: boolean };
export const defaults: Preferences = { shortcuts: true, reducedMotion: false, compact: false };
const key = 'intellmeet.browser-preferences.v1';
let current = defaults;
export let storageAvailable = true;
try {
  const saved = JSON.parse(localStorage.getItem(key) || '{}');
  current = { ...defaults };
  for (const name of Object.keys(defaults) as (keyof Preferences)[]) {
    if (typeof saved?.[name] === 'boolean') current[name] = saved[name];
  }
} catch {
  storageAvailable = false;
}
const listeners = new Set<() => void>();
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const snapshot = () => current;
export const shortcutsEnabled = () => current.shortcuts;
export function update(next: Preferences) {
  current = next;
  try {
    localStorage.setItem(key, JSON.stringify(next));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  listeners.forEach((listener) => listener());
}
