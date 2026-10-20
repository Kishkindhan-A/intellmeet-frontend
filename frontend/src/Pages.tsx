import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { BrowserPreferences } from './BrowserPreferences';
import { Bell, HelpCircle } from 'lucide-react';
import { api, clearSession } from './api';
import { navigate } from './navigation';
import type { User } from './api';
import type { Workspace } from './types';
import { ErrorBox, Submit, Empty, dateLabel } from './ui';
export function SettingsPage({
  user,
  workspace,
  update,
  onUserChange,
}: {
  user: User;
  workspace?: Workspace;
  update: () => Promise<void>;
  onUserChange: (user: User) => void;
}) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  async function submit(e: FormEvent<HTMLFormElement>, path: string) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const d = Object.fromEntries(new FormData(e.currentTarget));
      const result = await api<{ user?: User }>(
        path,
        'PATCH',
        path === '/auth/me'
          ? d
          : {
              name: d.name,
              retentionDays: Number(d.retentionDays),
              aiEnabled: d.aiEnabled === 'on',
            },
      );
      if (result.user) onUserChange(result.user);
      setNotice('Settings saved.');
      try {
        await update();
      } catch {
        setError(
          'Your settings were saved, but the workspace could not refresh. Reload the page to see the latest changes.',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorBox message={error} />
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}
      <div className="settings-grid">
        <section className="panel settings-panel">
          <h2>Your profile</h2>
          <form onSubmit={(e) => void submit(e, '/auth/me')}>
            <label>
              Display name
              <input name="name" defaultValue={user.name} required maxLength={100} />
            </label>
            <label>
              Email
              <input value={user.email} readOnly />
            </label>
            <Submit busy={busy}>Save profile</Submit>
          </form>
        </section>
        {workspace && (
          <section className="panel settings-panel">
            <h2>Workspace preferences</h2>
            {workspace.role === 'member' ? (
              <p>Workspace administrators manage these preferences.</p>
            ) : (
              <form onSubmit={(e) => void submit(e, `/workspaces/${workspace._id}`)}>
                <label>
                  Name
                  <input name="name" defaultValue={workspace.name} required maxLength={100} />
                </label>
                <label>
                  Retention in days
                  <input
                    name="retentionDays"
                    type="number"
                    min={1}
                    max={3650}
                    defaultValue={workspace.retentionDays}
                  />
                </label>
                <label className="check-label">
                  <input name="aiEnabled" type="checkbox" defaultChecked={workspace.aiEnabled} />
                  Allow AI processing with participant consent
                </label>
                <Submit busy={busy}>Save workspace</Submit>
              </form>
            )}
          </section>
        )}
        <section className="panel settings-panel">
          <h2>Two-factor authentication</h2>
          <p>Use an authenticator app. Recovery codes are shown once; save them privately.</p>
          {user.mfaEnabled && !codes.length ? (
            <span className="badge live">MFA enabled</span>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                const d = new FormData(e.currentTarget);
                try {
                  if (!secret) {
                    setSecret(
                      (
                        await api<{ secret: string }>('/auth/mfa/setup', 'POST', {
                          password: d.get('password'),
                        })
                      ).secret,
                    );
                  } else {
                    setCodes(
                      (
                        await api<{ recoveryCodes: string[] }>('/auth/mfa/confirm', 'POST', {
                          code: d.get('code'),
                        })
                      ).recoveryCodes,
                    );
                    setSecret('');
                    onUserChange({ ...user, mfaEnabled: true });
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Unable to configure MFA');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {codes.length ? (
                <div className="recovery-codes" role="status">
                  <strong>MFA enabled. Save these recovery codes:</strong>
                  {codes.map((c) => (
                    <code key={c}>{c}</code>
                  ))}
                </div>
              ) : secret ? (
                <>
                  <label>
                    Authenticator setup key<code className="setup-key">{secret}</code>
                  </label>
                  <label>
                    Six-digit code
                    <input name="code" required pattern="[0-9]{6}" autoComplete="one-time-code" />
                  </label>
                  <Submit busy={busy}>Confirm authentication</Submit>
                </>
              ) : (
                <>
                  <label>
                    Current password
                    <input
                      name="password"
                      type="password"
                      required
                      autoComplete="current-password"
                    />
                  </label>
                  <Submit busy={busy}>Set up MFA</Submit>
                </>
              )}
            </form>
          )}
        </section>
        <BrowserPreferences />
        <AccountSecurity />
      </div>
    </>
  );
}
type AccountSession = { _id: string; createdAt: string; expiresAt: string; userAgent?: string };
function AccountSecurity() {
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [error, setError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function loadSessions() {
    const data = await api<{ sessions: AccountSession[]; currentSessionId: string }>(
      '/auth/sessions',
    );
    setSessions(data.sessions);
    setCurrentId(data.currentSessionId);
  }
  useEffect(() => {
    let active = true;
    api<{ sessions: AccountSession[]; currentSessionId: string }>('/auth/sessions')
      .then((data) => {
        if (active) {
          setSessions(data.sessions);
          setCurrentId(data.currentSessionId);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <section className="panel settings-panel">
        <h2>Change password</h2>
        <ErrorBox message={passwordError} />
        <p>
          Changing your password signs out all sessions. MFA accounts must also confirm an
          authentication or recovery code.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            const data = new FormData(event.currentTarget);
            setPasswordError('');
            setNotice('');
            if (data.get('password') !== data.get('confirmPassword')) {
              setPasswordError('New passwords do not match.');
              return;
            }
            setBusy(true);
            try {
              await api('/auth/change-password', 'POST', {
                currentPassword: data.get('currentPassword'),
                password: data.get('password'),
                ...(data.get('code') ? { code: data.get('code') } : {}),
              });
              navigate('/login?notice=password-reset', true);
              clearSession();
            } catch (e) {
              setPasswordError(e instanceof Error ? e.message : 'Unable to change password');
            } finally {
              setBusy(false);
            }
          }}
          aria-busy={busy}
        >
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              required
              maxLength={128}
              autoComplete="current-password"
              disabled={busy}
            />
          </label>
          <label>
            New password
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
          <label>
            Confirm new password
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
          <label>
            Authentication or recovery code (if enabled)
            <input name="code" autoComplete="one-time-code" maxLength={100} disabled={busy} />
          </label>
          <Submit busy={busy}>Update password and sign out</Submit>
        </form>
      </section>
      <section className="panel settings-panel">
        <h2>Active sessions</h2>
        <p>Sign out a device you no longer use or recognize.</p>
        <ErrorBox message={error} />
        {notice && (
          <div className="success" role="status">
            {notice}
          </div>
        )}
        {loading && <p role="status">Loading sessions…</p>}
        {!loading && !sessions.length && <p>No active sessions to display.</p>}
        <div className="account-sessions">
          {sessions.map((session) => (
            <article key={session._id}>
              <div>
                <strong>{session._id === currentId ? 'This device' : 'Another device'}</strong>
                <p>{session.userAgent || 'Browser details unavailable'}</p>
                <small>
                  Signed in {dateLabel(session.createdAt)} · Expires {dateLabel(session.expiresAt)}
                </small>
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  setNotice('');
                  try {
                    await api(`/auth/sessions/${session._id}`, 'DELETE');
                    if (session._id === currentId) clearSession();
                    else {
                      await loadSessions();
                      setNotice('Device signed out.');
                    }
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Unable to end session');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Sign out {session._id === currentId ? 'this device' : 'device'}
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
export function HelpPage({ workspaceId }: { workspaceId: string }) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="settings-grid">
      <section className="panel settings-panel">
        <HelpCircle size={28} />
        <h2>Find your way around</h2>
        <h3>Start a meeting</h3>
        <p>
          Create a meeting, start it as host, and join with your chosen consent settings. Your
          camera and microphone start off.
        </p>
        <h3>Keep the next steps clear</h3>
        <p>Create action items from the workspace or review suggestions in a meeting recap.</p>
        <h3>Account email</h3>
        <p>Check your email inbox for account messages when email delivery is enabled.</p>
      </section>
      <section className="panel settings-panel">
        <h2>Contact workspace support</h2>
        <p>Your request goes to your workspace administrators.</p>
        <ErrorBox message={error} />
        {notice && <div className="success">{notice}</div>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            setBusy(true);
            setError('');
            try {
              const d = new FormData(form);
              await api('/account/support', 'POST', {
                workspaceId,
                subject: d.get('subject'),
                message: d.get('message'),
              });
              setNotice('Your request has been submitted.');
              form.reset();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Unable to submit');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Subject
            <input name="subject" required maxLength={200} />
          </label>
          <label>
            How can we help?
            <textarea name="message" required maxLength={5000} />
          </label>
          <Submit busy={busy}>Submit request</Submit>
        </form>
      </section>
    </div>
  );
}
export function Notifications() {
  const [items, setItems] = useState<
    { _id: string; title: string; readAt?: string; createdAt: string }[]
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ notifications: typeof items }>('/notifications')
      .then((r) => setItems(r.notifications))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel">
      <ErrorBox message={error} />
      {items.length ? (
        items.map((n) => (
          <div key={n._id} className="notification-row">
            <Bell size={18} />
            <div>
              <h3>{n.title}</h3>
              <small>{dateLabel(n.createdAt)}</small>
            </div>
            {!n.readAt && (
              <button
                className="secondary compact"
                onClick={async () => {
                  try {
                    await api(`/notifications/${n._id}/read`, 'POST', {});
                    setItems((current) =>
                      current.map((item) =>
                        item._id === n._id ? { ...item, readAt: new Date().toISOString() } : item,
                      ),
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Unable to update');
                  }
                }}
              >
                Mark read
              </button>
            )}
          </div>
        ))
      ) : (
        <Empty
          title="You’re all caught up"
          detail="Updates from your workspace will appear here."
        />
      )}
    </section>
  );
}
