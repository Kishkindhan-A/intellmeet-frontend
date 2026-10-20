import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import { snapshot, subscribe, update } from './browserPreferenceStore';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
let pendingInstall: InstallEvent | null = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  pendingInstall = event as InstallEvent;
  window.dispatchEvent(new Event('intellmeet-install-ready'));
});
window.addEventListener('appinstalled', () => {
  pendingInstall = null;
  window.dispatchEvent(new Event('intellmeet-install-ready'));
});

export function BrowserIntegration() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const check = () => setOnline(navigator.onLine);
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        /* Core app remains available without offline support. */
      });
    }
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
    };
  }, []);
  return online ? null : (
    <div className="connection-banner" role="status">
      You appear to be offline. Meetings and saved changes need a connection. Reconnect before
      submitting again.
    </div>
  );
}

export function BrowserTools() {
  const [message, setMessage] = useState('');
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const check = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', check);
    return () => document.removeEventListener('fullscreenchange', check);
  }, []);
  // Never copy authentication, reset, or invitation tokens from the current URL.
  const safeUrl = () => {
    const url = new URL(location.pathname, location.origin);
    if (location.pathname.startsWith('/workspace')) {
      const params = new URLSearchParams(location.search);
      for (const key of ['workspace', 'meeting'])
        if (params.has(key)) url.searchParams.set(key, params.get(key)!);
    }
    return url.href;
  };
  return (
    <div className="browser-tools">
      <button
        className="secondary compact"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(safeUrl());
            setMessage('Link copied. Access still requires workspace permission.');
          } catch {
            setMessage('Clipboard is unavailable. Copy the page address from your browser.');
          }
        }}
      >
        Copy page link
      </button>
      {'share' in navigator && (
        <button
          className="secondary compact"
          onClick={async () => {
            try {
              await navigator.share({ title: document.title, url: safeUrl() });
              setMessage('Share dialog closed.');
            } catch (error) {
              if (!(error instanceof DOMException && error.name === 'AbortError'))
                setMessage('Sharing is unavailable. Use Copy page link instead.');
            }
          }}
        >
          Share
        </button>
      )}
      {document.fullscreenEnabled && (
        <button
          className="secondary compact"
          onClick={async () => {
            try {
              if (document.fullscreenElement) await document.exitFullscreen();
              else await document.documentElement.requestFullscreen();
            } catch {
              setMessage('Fullscreen was blocked by this browser.');
            }
          }}
        >
          {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      )}
      <button className="secondary compact" onClick={() => window.print()}>
        Print page
      </button>
      {message && <span role="status">{message}</span>}
    </div>
  );
}

export function BrowserCapabilities() {
  const prefs = useSyncExternalStore(subscribe, snapshot);
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const [installable, setInstallable] = useState(!!pendingInstall);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ready = () => setInstallable(!!pendingInstall);
    window.addEventListener('intellmeet-install-ready', ready);
    let active = true;
    const cleanups: (() => void)[] = [];
    for (const name of ['camera', 'microphone', 'notifications']) {
      if (!navigator.permissions) continue;
      void navigator.permissions
        .query({ name: name as PermissionName })
        .then((status) => {
          if (!active) return;
          const changed = () => setPermissions((current) => ({ ...current, [name]: status.state }));
          changed();
          status.addEventListener('change', changed);
          cleanups.push(() => status.removeEventListener('change', changed));
        })
        .catch(() => {
          /* Some browsers cannot query these permission names. */
        });
    }
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
      window.removeEventListener('intellmeet-install-ready', ready);
    };
  }, []);
  return (
    <section className="panel settings-panel">
      <h2>Browser connections</h2>
      <p>
        Camera: {permissions.camera || 'Check in browser site settings'} · Microphone:{' '}
        {permissions.microphone || 'Check in browser site settings'}
      </p>
      <p>
        Use the site controls beside the browser address to change blocked permissions. The device
        test opens both devices briefly and stops them immediately; it does not record or upload
        media.
      </p>
      <button
        className="secondary"
        disabled={busy || !navigator.mediaDevices?.getUserMedia}
        onClick={async () => {
          setBusy(true);
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            stream.getTracks().forEach((track) => track.stop());
            setMessage('Camera and microphone are available. Test devices stopped.');
          } catch {
            setMessage(
              'Device test failed. Check site permissions, connected devices, and whether another app is using them.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Checking devices…' : 'Test camera & microphone'}
      </button>
      <h3>Desktop notifications</h3>
      <p>
        Opt in to alerts for new workspace notifications while this website is open in a background
        tab. Message content stays inside IntellMeet. This is not background push when the app is
        closed.
      </p>
      <p>
        Browser permission: {'Notification' in window ? Notification.permission : 'Unsupported'}
      </p>
      <button
        className="secondary"
        disabled={!('Notification' in window)}
        onClick={async () => {
          if (prefs.desktopAlerts) {
            update({ ...prefs, desktopAlerts: false });
            return;
          }
          try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
              update({ ...prefs, desktopAlerts: true });
              setMessage('Desktop alerts enabled.');
            } else
              setMessage(
                'Alerts are not enabled. Change notification permission in browser site settings to try again.',
              );
          } catch {
            setMessage('Notifications are unavailable in this browser.');
          }
        }}
      >
        {prefs.desktopAlerts ? 'Turn off desktop alerts' : 'Enable desktop alerts'}
      </button>
      <h3>Install IntellMeet</h3>
      {installable ? (
        <button
          className="secondary"
          onClick={async () => {
            const event = pendingInstall;
            if (!event) return;
            try {
              await event.prompt();
              const choice = await event.userChoice;
              setMessage(
                choice.outcome === 'accepted'
                  ? 'Install accepted.'
                  : 'Installation dismissed. You can still use the website.',
              );
            } catch {
              setMessage('Use your browser menu to install this app.');
            } finally {
              pendingInstall = null;
              setInstallable(false);
            }
          }}
        >
          Install app
        </button>
      ) : (
        <p>
          Use your browser menu → Install app or Add to Home Screen when available. On Safari, use
          Share → Add to Home Screen (iPhone/iPad) or File → Add to Dock (Mac). The browser decides
          when installation is available.
        </p>
      )}
      <BrowserTools />
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export function DesktopAlerts({ userId }: { userId: string }) {
  const prefs = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (
      !prefs.desktopAlerts ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    )
      return;
    let active = true;
    let running = false;
    let seen: Set<string> | null = null;
    const check = async () => {
      if (running || !navigator.onLine) return;
      running = true;
      try {
        const result = await api<{ notifications: { _id: string; readAt?: string }[] }>(
          '/notifications',
        );
        if (!active) return;
        const ids = new Set(result.notifications.map((item) => item._id));
        const fresh =
          seen && result.notifications.some((item) => !item.readAt && !seen!.has(item._id));
        seen = ids;
        if (fresh && document.visibilityState === 'hidden') {
          try {
            const alert = new Notification('IntellMeet', {
              body: 'You have new workspace updates.',
              tag: 'intellmeet-workspace',
            });
            alert.onclick = () => {
              window.focus();
              alert.close();
            };
          } catch {
            /* Unsupported desktop notification constructors must not affect the app. */
          }
        }
      } catch {
        /* Session and connection errors are handled by the API client. */
      } finally {
        running = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [prefs.desktopAlerts, userId]);
  return null;
}
