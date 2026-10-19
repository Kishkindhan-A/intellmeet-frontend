import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Sparkles, ShieldCheck, Check, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { api, clearSession, login, setSession } from './api';
import type { User } from './api';
import { ErrorBox, Submit } from './ui';
import { SignalMark } from './Brand';
import { navigate } from './navigation';
type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify' | 'oauth';
export function Auth({ ready }: { ready: (u: User) => void }) {
  const mode: AuthMode =
    location.pathname === '/reset-password'
      ? 'reset'
      : location.pathname === '/verify-email'
        ? 'verify'
        : location.pathname === '/auth/callback'
          ? 'oauth'
          : location.pathname === '/register'
            ? 'register'
            : location.pathname === '/forgot-password'
              ? 'forgot'
              : 'login';
  const [email, setEmail] = useState(() =>
    mode === 'verify' &&
    typeof history !== 'undefined' &&
    typeof history.state?.verificationEmail === 'string'
      ? history.state.verificationEmail
      : '',
  );
  const [emailOtp, setEmailOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(() =>
    new URLSearchParams(location.search).get('notice') === 'session-expired'
      ? 'Your session expired. Sign in again to continue.'
      : '',
  );
  const [notice, setNotice] = useState(() => {
    const result = new URLSearchParams(location.search).get('notice');
    return result === 'password-reset'
      ? 'Password updated. Sign in with your new password.'
      : result === 'verified'
        ? 'Email verified. Sign in to continue.'
        : '';
  });
  const [busy, setBusy] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(true);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyFailed, setPolicyFailed] = useState(false);
  const [policyAttempt, setPolicyAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api<{ emailVerificationRequired: boolean }>('/auth/config')
      .then((settings) => {
        if (active) {
          setVerificationRequired(settings.emailVerificationRequired);
          setPolicyLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setPolicyLoading(false);
          setPolicyFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [policyAttempt]);
  const verificationStarted = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [token] = useState(() => {
    const p = new URLSearchParams(location.hash.slice(1));
    const t = p.get('token') || p.get('ticket') || '';
    return t;
  });
  useEffect(() => {
    // Read during initialization, remove only after mount: StrictMode runs initializers twice.
    if (token && location.hash && location.pathname !== '/invite')
      history.replaceState(null, '', location.pathname + location.search);
  }, [token]);
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setResendCooldown((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);
  async function confirmEmail() {
    if (!token && !emailOtp) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (token) await api('/auth/verify-email', 'POST', { token });
      else await api('/auth/verify-email-otp', 'POST', { email, code: emailOtp });
      setMode('login', 'verified');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to verify email. Request a new link.');
    } finally {
      setBusy(false);
    }
  }
  const initialVerification = useRef(confirmEmail);
  useEffect(() => {
    // One attempt per mounted email link, including StrictMode effect replay.
    if (mode === 'verify' && token && !verificationStarted.current) {
      verificationStarted.current = true;
      void initialVerification.current();
    }
  }, [mode, token]);
  function setMode(next: AuthMode, feedback?: 'password-reset' | 'verified') {
    setError('');
    setNotice('');
    setPassword('');
    setConfirmPassword('');
    const path = {
      login: '/login',
      register: '/register',
      forgot: '/forgot-password',
      reset: '/reset-password',
      verify: '/verify-email',
      oauth: '/auth/callback',
    }[next];
    navigate(path + (feedback ? `?notice=${feedback}` : ''));
  }
  const missingToken = ['reset', 'oauth'].includes(mode) && !token;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    if (['register', 'reset'].includes(mode) && password !== confirmPassword) {
      setError('Passwords do not match. Enter the same password in both fields.');
      return;
    }
    if (missingToken) return;
    setBusy(true);
    try {
      if (mode === 'login') ready(await login(email, password, code));
      else if (mode === 'register') {
        if (policyLoading || policyFailed) return;
        await api('/auth/register', 'POST', { name, email, password });
        if (!verificationRequired) {
          ready(await login(email, password, code));
          return;
        }
        setPassword('');
        setConfirmPassword('');
        history.pushState({ verificationEmail: email }, '', '/verify-email');
        window.dispatchEvent(new PopStateEvent('popstate'));
      } else if (mode === 'forgot') {
        await api('/auth/forgot-password', 'POST', { email });
        setNotice('If this account is eligible, check your email for a password reset link.');
      } else if (mode === 'reset') {
        await api('/auth/reset-password', 'POST', { token, password });
        clearSession();
        setMode('login', 'password-reset');
      } else if (mode === 'verify') {
        await confirmEmail();
      } else if (mode === 'oauth') {
        const s = await api<{
          user: User;
          accessToken: string;
          csrfToken: string;
        }>('/auth/google/complete', 'POST', {
          ticket: token,
          ...(code ? { code } : {}),
        });
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
            disabled={busy}
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
              : mode === 'forgot'
                ? 'Enter your account email. Reset links expire after 30 minutes.'
                : mode === 'reset'
                  ? 'Choose a new password of 12–128 characters.'
                  : mode === 'verify'
                    ? token
                      ? 'Checking your email link. You can retry if needed.'
                      : 'Enter the six-digit OTP sent to your email. It expires in 10 minutes.'
                    : 'Pick up the conversation where you left off.'}
          </p>
          <ErrorBox message={error} />
          {policyFailed && (
            <div role="alert">
              <p>Account services are temporarily unavailable. Please try again shortly.</p>
              <button
                type="button"
                onClick={() => {
                  setPolicyFailed(false);
                  setPolicyLoading(true);
                  setPolicyAttempt((attempt) => attempt + 1);
                }}
              >
                Retry account settings
              </button>
            </div>
          )}
          {missingToken && (
            <div className="error" role="alert">
              This link is missing its secure token. Request a new link to continue.
            </div>
          )}
          {notice && (
            <div className="success" role="status">
              {notice}
            </div>
          )}
          <form onSubmit={submit} aria-busy={busy}>
            {mode === 'verify' && !token && (
              <>
                <label>
                  Account email
                  <input
                    ref={emailInput}
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    disabled={busy}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                  />
                </label>
                <label>
                  Email verification OTP
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    required
                    value={emailOtp}
                    disabled={busy}
                    onChange={(event) =>
                      setEmailOtp(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    placeholder="Six-digit code"
                  />
                </label>
              </>
            )}
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
                  disabled={busy}
                />
              </label>
            )}
            {['login', 'register', 'forgot'].includes(mode) && (
              <label>
                Work email
                <input
                  required
                  type="email"
                  ref={emailInput}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  maxLength={254}
                  disabled={busy}
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
                    disabled={busy}
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
                    disabled={busy}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>
            )}
            {['register', 'reset'].includes(mode) && (
              <label>
                Confirm password
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={confirmPassword}
                  disabled={busy}
                  aria-invalid={Boolean(confirmPassword && confirmPassword !== password)}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Enter your password again"
                />
                <small className="muted">
                  Use 12–128 characters. Spaces and password managers are welcome.
                </small>
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
                    maxLength={100}
                    disabled={busy}
                  />
                </label>
              </details>
            )}
            {mode === 'login' && (
              <button
                className="text-button forgot"
                type="button"
                disabled={busy}
                onClick={() => setMode('forgot')}
              >
                Forgot password?
              </button>
            )}
            <Submit
              busy={busy}
              disabled={missingToken || (mode === 'register' && (policyLoading || policyFailed))}
            >
              {mode === 'login'
                ? 'Sign in to your workspace'
                : mode === 'register'
                  ? 'Create account'
                  : mode === 'forgot'
                    ? 'Send reset link'
                    : mode === 'verify'
                      ? token
                        ? 'Verify email'
                        : 'Verify OTP'
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
            </>
          ) : (
            <button
              className="text-button back"
              disabled={busy}
              onClick={() => {
                setMode('login');
                setError('');
              }}
            >
              <ArrowLeft size={16} />
              Back to sign in
            </button>
          )}
          {verificationRequired && ['login', 'register', 'verify'].includes(mode) && (
            <form
              className="verification-resend"
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy || resendCooldown > 0) return;
                if (emailInput.current && !emailInput.current.reportValidity()) return;
                setBusy(true);
                setError('');
                setNotice('');
                try {
                  await api('/auth/resend-verification', 'POST', { email });
                  setEmailOtp('');
                  setNotice(
                    'If this account is eligible, check its inbox and spam folder for a new OTP. The previous code is replaced when the new email is accepted.',
                  );
                  setResendCooldown(30);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Unable to send. Try again later.');
                } finally {
                  setBusy(false);
                }
              }}
              aria-busy={busy}
            >
              {mode === 'verify' && token && (
                <label>
                  Account email
                  <input
                    ref={emailInput}
                    type="email"
                    required
                    autoComplete="email"
                    maxLength={254}
                    value={email}
                    disabled={busy}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                  />
                </label>
              )}
              <button
                className="text-button"
                type="submit"
                disabled={busy || !email || resendCooldown > 0}
              >
                {resendCooldown > 0
                  ? `Try resend again in ${resendCooldown}s`
                  : 'Resend verification email'}
              </button>
            </form>
          )}
          {missingToken && mode === 'reset' && (
            <button className="text-button" onClick={() => setMode('forgot')}>
              Request a new reset link
            </button>
          )}
        </div>
        <footer>Made for focused work. Built for human connection.</footer>
      </section>
    </main>
  );
}
