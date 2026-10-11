import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Bell, HelpCircle } from 'lucide-react';
import { api } from './api';
import type { User } from './api';
import type { Workspace } from './types';
import { ErrorBox, Submit, Empty, dateLabel } from './ui';
export function SettingsPage({
  user,
  workspace,
  update,
}: {
  user: User;
  workspace: Workspace;
  update: () => void;
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
    try {
      const d = Object.fromEntries(new FormData(e.currentTarget));
      await api(
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
      setNotice('Settings saved.');
      update();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorBox message={error} />
      {notice && <div className="success">{notice}</div>}
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
        <section className="panel settings-panel">
          <h2>Two-factor authentication</h2>
          <p>Use an authenticator app. Recovery codes are shown once; save them privately.</p>
          {user.mfaEnabled ? (
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
      </div>
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
        <h3>Development email</h3>
        <p>
          Verification and invitation messages appear in the{' '}
          <a href="http://localhost:8026" target="_blank" rel="noreferrer">
            local inbox
          </a>
          .
        </p>
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
