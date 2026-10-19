import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, StrictMode } from '../../frontend/node_modules/react/index.js';
import { renderToStaticMarkup } from '../../frontend/node_modules/react-dom/server.node.js';
import { Auth } from '../../frontend/src/Auth';

vi.mock('../../frontend/src/api', () => ({
  api: vi.fn(),
  login: vi.fn(),
  setSession: vi.fn(),
  clearSession: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());

function render(path: string, hash = '', search = '') {
  vi.stubGlobal('location', { pathname: path, hash, search });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  return renderToStaticMarkup(
    createElement(StrictMode, null, createElement(Auth, { ready: vi.fn() })),
  );
}

describe('authentication forms without a browser', () => {
  it('renders registration with confirmation, accessible labels and password-manager hints', () => {
    const markup = render('/register');
    expect(markup).toContain('Your name');
    expect(markup).toContain('Work email');
    expect(markup).toContain('Confirm password');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).toContain('minLength="12"');
    expect(markup).toContain('maxLength="128"');
    expect(markup).not.toMatch(/value="(?:unit-|secret)/);
  });
  it('renders the direct forgot-password route with an email input and recovery context', () => {
    const markup = render('/forgot-password');
    expect(markup).toContain('Send reset link');
    expect(markup).toContain('type="email"');
    expect(markup).not.toContain('type="password"');
    expect(markup).toContain('30 minutes');
  });
  it('disables reset submissions when the token is missing', () => {
    for (const path of ['/reset-password']) {
      const markup = render(path);
      expect(markup).toContain('missing its secure token');
      expect(markup).toMatch(/type="submit" disabled=""/);
    }
  });
  it('renders email and six-digit OTP entry without requiring a link token', () => {
    const markup = render('/verify-email');
    expect(markup).toContain('Email verification OTP');
    expect(markup).toContain('one-time-code');
    expect(markup).toContain('Verify OTP');
    expect(markup).not.toContain('missing its secure token');
  });
  it('retains link tokens during repeated render initialization without exposing them in HTML', () => {
    for (const path of ['/reset-password', '/verify-email']) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const markup = render(path, '#token=unit-secret-link');
        expect(markup).not.toContain('missing its secure token');
        expect(markup).not.toContain('unit-secret-link');
        expect(history.replaceState).not.toHaveBeenCalled();
      }
    }
  });
  it('shows safe success notices after verification and password reset', () => {
    expect(render('/login', '', '?notice=verified')).toContain(
      'Email verified. Sign in to continue.',
    );
    expect(render('/login', '', '?notice=password-reset')).toContain(
      'Sign in with your new password.',
    );
    expect(render('/login', '', '?notice=%3Cscript%3E')).not.toContain('&lt;script&gt;');
    expect(render('/login', '', '?notice=session-expired')).toContain(
      'Your session expired. Sign in again to continue.',
    );
  });
  it('offers verification resend on signup, login and the verification recovery page', () => {
    for (const path of ['/register', '/login', '/verify-email']) {
      expect(render(path)).toContain('Resend verification email');
    }
    expect(render('/verify-email')).toContain('Account email');
  });
});
