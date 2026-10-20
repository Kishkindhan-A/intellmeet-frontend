import { useEffect, useState, useSyncExternalStore } from 'react';

import { defaults, storageAvailable, subscribe, snapshot, update } from './browserPreferenceStore';

export function BrowserPreferenceEffects() {
  const prefs = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    document.documentElement.classList.toggle('prefer-reduced-motion', prefs.reducedMotion);
    document.documentElement.classList.toggle('prefer-compact', prefs.compact);
  }, [prefs]);
  return null;
}
export function BrowserPreferences() {
  const prefs = useSyncExternalStore(subscribe, snapshot);
  const online = useOnlineStatus();
  return (
    <section className="panel settings-panel">
      <h2>Browser & keyboard</h2>
      <p>
        Preferences apply to this browser on this device. Your browser controls camera, microphone,
        and notification permissions through its site settings.
      </p>
      <p role="status">
        Connection: {online ? 'Online' : 'Offline — reconnect before saving changes'}
      </p>
      {(['shortcuts', 'reducedMotion', 'compact'] as const).map((name) => (
        <label className="check-label" key={name}>
          <input
            type="checkbox"
            checked={prefs[name]}
            onChange={(event) => update({ ...prefs, [name]: event.target.checked })}
          />
          {
            {
              shortcuts: 'Enable workspace keyboard shortcuts',
              reducedMotion: 'Reduce animations',
              compact: 'Compact workspace spacing',
            }[name]
          }
        </label>
      ))}
      <p role="status">
        {storageAvailable
          ? 'Preferences save automatically on this device.'
          : 'Browser storage is unavailable. Preferences apply until you reload.'}
      </p>
      <button className="secondary" onClick={() => update({ ...defaults })}>
        Reset browser preferences
      </button>
      <ShortcutList />
    </section>
  );
}
function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const check = () => setOnline(navigator.onLine);
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
    };
  }, []);
  return online;
}
export function ShortcutList() {
  return (
    <div className="shortcut-list">
      <h3>Keyboard shortcuts</h3>
      <p>
        Available in the workspace, outside text fields and dialogs. Browser and meeting controls
        keep their usual shortcuts.
      </p>
      {[
        ['Ctrl / ⌘ + K', 'Search workspace'],
        ['Alt + Shift + 1', 'Overview'],
        ['Alt + Shift + 2', 'Meetings'],
        ['Alt + Shift + 3', 'Action items'],
        ['Alt + Shift + 4', 'Your team'],
        ['Alt + Shift + S', 'Settings'],
        ['?', 'Show shortcuts'],
        ['Esc', 'Close a dialog'],
      ].map(([keys, action]) => (
        <p className="shortcut-row" key={keys}>
          <span>{action}</span>
          <kbd>{keys}</kbd>
        </p>
      ))}
    </div>
  );
}
