import { useState } from 'react';
import type { FormEvent } from 'react';
import { Sparkles, ShieldCheck, Check, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { api, login, setSession } from './api';
import type { User } from './api';
import { ErrorBox, Submit } from './ui';
import { SignalMark } from './Brand';
export function Auth({ ready }: { ready: (u: User) => void }) {
  const [mode, setMode] = useState(
    location.pathname === '/reset-password'
      ? 'reset'
      : location.pathname === '/verify-email'
        ? 'verify'
        : location.pathname === '/auth/callback'
          ? 'oauth'
          : location.pathname === '/register'
            ? 'register'
            : 'login',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [token] = useState(() => {
    const p = new URLSearchParams(location.hash.slice(1));
    const t = p.get('token') || p.get('ticket') || '';
    if (location.hash && location.pathname !== '/invite')
      history.replaceState(null, '', location.pathname);
    return t;
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') ready(await login(email, password, code));
      else if (mode === 'register') {
        await api('/auth/register', 'POST', { name, email, password });
        setNotice('Check your email to verify your account, then sign in.');
      } else if (mode === 'forgot') {
        await api('/auth/forgot-password', 'POST', { email });
        setNotice('If eligible, a password reset link has been sent.');
      } else if (mode === 'reset') {
        await api('/auth/reset-password', 'POST', { token, password });
        setNotice('Password updated. Sign in to continue.');
        setMode('login');
      } else if (mode === 'verify') {
        await api('/auth/verify-email', 'POST', { token });
        setNotice('Email verified. Sign in to continue.');
        setMode('login');
      } else if (mode === 'oauth') {
        const s = await api<{ user: User; accessToken: string; csrfToken: string }>(
          '/auth/google/complete',
          'POST',
          { ticket: token, ...(code ? { code } : {}) },
        );
        setSession(s);
        ready(s.user);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to continue');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-icon">
            <SignalMark />
          </span>
          IntellMeet<span className="brand-ai">AI</span>
        </a>
        <div className="story-content">
          <div className="eyebrow light">
            <span />
            BUILT FOR TEAMS THAT MOVE FORWARD
          </div>
          <h1>
            A meeting of minds.
            <br />
            <span>A world of possibility.</span>
          </h1>
          <p>
            Your meetings, ideas, and next steps.
            <br />
            Together in one thoughtful workspace.
          </p>
          <div className="story-art signature-art">
            <div className="orbit o1" />
            <div className="orbit o2" />
            <div className="art-center">
              <SignalMark large />
            </div>
            <div className="floating f1">
              <Sparkles size={18} />
              Ideas into action
            </div>
            <div className="floating f2">
              <Check size={18} />
              Every voice matters
            </div>
            <span className="art-dot d1" />
            <span className="art-dot d2" />
          </div>
          <div className="story-features">
            <span>
              <ShieldCheck size={17} />
              Secure by design
            </span>
            <span>
              <Sparkles size={17} />
              AI with your consent
            </span>
          </div>
        </div>
        <footer>Less meeting fatigue. More meaningful work.</footer>
      </section>
      <section className="auth-panel">
        <div className="auth-top">
          {mode === 'register' ? 'Already have an account?' : 'New to IntellMeet?'}
          <button
            className="text-button"
            onClick={() => {
              setMode(mode === 'register' ? 'login' : 'register');
              setError('');
              setNotice('');
            }}
          >
            {mode === 'register' ? 'Sign in' : 'Create an account'} ↗
          </button>
        </div>
        <div className="auth-form">
          <div className="eyebrow">YOUR TEAM’S NEXT CHAPTER</div>
          <h2>
            {mode === 'login'
              ? 'Welcome back.'
              : mode === 'register'
                ? 'Make room for better work.'
                : mode === 'forgot'
                  ? 'Let’s get you back in.'
                  : mode === 'verify'
                    ? 'Verify your email.'
                    : mode === 'oauth'
                      ? 'Complete your sign-in.'
                      : 'Set a new password.'}
          </h2>
          <p className="muted">
            {mode === 'register'
              ? 'Bring your people and projects into one place.'
              : 'Pick up the conversation where you left off.'}
          </p>
          <ErrorBox message={error} />
          {notice && (
            <div className="success" role="status">
              {notice}
            </div>
          )}
          <form onSubmit={submit}>
            {mode === 'register' && (
              <label>
                Your name
                <input
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Morgan"
                  maxLength={100}
                />
              </label>
            )}
            {['login', 'register', 'forgot'].includes(mode) && (
              <label>
                Work email
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </label>
            )}
            {['login', 'register', 'reset'].includes(mode) && (
              <label>
                Password
                <span className="password-field">
                  <input
                    required
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    minLength={mode === 'login' ? 1 : 12}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      mode === 'login' ? 'Enter your password' : 'At least 12 characters'
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>
            )}
            {['login', 'oauth'].includes(mode) && (
              <details className="mfa-disclosure">
                <summary>Use an authentication or recovery code</summary>
                <label className="optional-label">
                  Authentication code <span>if MFA is enabled</span>
                  <input
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="TOTP or recovery code"
                  />
                </label>
              </details>
            )}
            {mode === 'login' && (
              <button
                className="text-button forgot"
                type="button"
                onClick={() => setMode('forgot')}
              >
                Forgot password?
              </button>
            )}
            <Submit busy={busy}>
              {mode === 'login'
                ? 'Sign in to your workspace'
                : mode === 'register'
                  ? 'Create account'
                  : mode === 'forgot'
                    ? 'Send reset link'
                    : mode === 'verify'
                      ? 'Verify email'
                      : 'Continue'}
            </Submit>
          </form>
          {mode === 'login' ? (
            <>
              <div className="divider">a workspace built around you</div>
              <p className="auth-note">
                <ShieldCheck size={16} />
                Your password and meeting content stay private.
              </p>
              <button
                className="text-button"
                disabled={busy || !email}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api('/auth/resend-verification', 'POST', { email });
                    setNotice('If eligible, a verification email has been sent.');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Unable to send');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Resend verification email
              </button>
            </>
          ) : (
            <button
              className="text-button back"
              onClick={() => {
                setMode('login');
                setError('');
              }}
            >
              <ArrowLeft size={16} />
              Back to sign in
            </button>
          )}
        </div>
        <footer>Made for focused work. Built for human connection.</footer>
      </section>
    </main>
  );
}
