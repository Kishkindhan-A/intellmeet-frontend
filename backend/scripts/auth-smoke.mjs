// Real local API + captured SMTP smoke test. Uses only a synthetic example.test account.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const localRuntime = JSON.parse(await readFile('.data/local-run/running.json', 'utf8'));

const base = 'http://127.0.0.1:4000';
const inbox = 'http://127.0.0.1:8026';
const email = `auth-smoke-${randomUUID()}@example.test`;
const password = `Local-only-${randomUUID()}`;
const replacement = `Local-reset-${randomUUID()}`;
const cookies = new Map();
let csrf = '';
const checks = [];
function pass(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}
function check(condition, name) {
  if (!condition) throw new Error(name);
}

async function api(path, method = 'GET', body, status = 200, withCsrf = true) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: 'http://localhost:5173',
      ...(cookies.size
        ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
        : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(withCsrf && csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const index = pair.indexOf('=');
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (value) cookies.set(name, value);
    else cookies.delete(name);
  }
  const result = response.status === 204 ? null : await response.json();
  if (response.status !== status)
    throw new Error(`${method} ${path}: expected ${status}, received ${response.status}`);
  return result;
}

async function emailToken(subject, address = email, except = '', format = 'token') {
  for (let attempt = 0; attempt < 24; attempt++) {
    const list = await (
      await fetch(`${inbox}/api/v1/messages`, { signal: AbortSignal.timeout(5000) })
    ).json();
    const message = list.messages.find(
      (message) =>
        message.Subject.includes(subject) && message.To.some((to) => to.Address === address),
    );
    if (message) {
      const mail = await (await fetch(`${inbox}/api/v1/message/${message.ID}`)).json();
      const token =
        format === 'otp'
          ? mail.Text?.match(/verification code: (\d{6})/)?.[1]
          : mail.Text?.match(/#token=([^\s]+)/)?.[1];
      if (subject === 'Verify')
        check(mail.HTML?.includes('Verify Email Address'), 'Verification HTML missing');
      if (token && token !== except) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Synthetic account mail did not reach captured SMTP');
}

try {
  await api('/health/ready');
  pass('backend readiness');
  const policy = await api('/api/auth/config');
  if (policy.emailVerificationRequired && localRuntime.emailMode !== 'captured')
    throw new Error(
      'Verification tests require captured email; synthetic recipients will not be sent through live SMTP.',
    );
  await api('/api/workspaces', 'GET', undefined, 401);
  pass('protected access denied while logged out');
  await api(
    '/api/auth/register',
    'POST',
    { name: 'Authentication smoke test', email, password },
    202,
  );
  await api(
    '/api/auth/register',
    'POST',
    { name: 'Duplicate attempt', email, password: replacement },
    202,
  );
  pass('registration and generic duplicate handling');
  if (!policy.emailVerificationRequired) {
    await api('/api/auth/login', 'POST', { email, password: replacement }, 401);
    const login = await api('/api/auth/login', 'POST', { email, password });
    csrf = login.csrfToken;
    check(login.user.verified === false, 'Address was incorrectly marked verified');
    pass('email/password login succeeds without OTP and rejects incorrect password');
    await api('/api/workspaces');
    pass('protected workspace access');
    await api('/api/auth/logout', 'POST', {}, 204);
    await api('/api/auth/me', 'GET', undefined, 401);
    pass('logout invalidates the session');
  } else {
    await api('/api/auth/login', 'POST', { email, password: replacement }, 401);
    await api('/api/auth/login', 'POST', { email, password }, 403);
    pass('incorrect credentials and unverified login denied');
    const secondEmail = `second-${email}`;
    await api(
      '/api/auth/register',
      'POST',
      { name: 'Second recipient', email: secondEmail, password },
      202,
    );
    const firstLink = await emailToken('Verify');
    const secondLink = await emailToken('Verify', secondEmail);
    check(firstLink !== secondLink, 'Different accounts received the same link');
    pass('distinct branded HTML emails addressed to two separate test recipients');
    await api('/api/auth/resend-verification', 'POST', { email }, 202);
    const replacementLink = await emailToken('Verify', email, firstLink);
    check(replacementLink !== firstLink, 'Resend did not generate a new link');
    await api('/api/auth/verify-email', 'POST', { token: firstLink }, 400);
    await api('/api/auth/verify-email', 'POST', { token: replacementLink });
    await api('/api/auth/verify-email', 'POST', { token: replacementLink }, 400);
    await api('/api/auth/login', 'POST', { email: secondEmail, password }, 403);
    pass('resend replaces old link, reuse rejected, and another account remains unverified');
    const secondOtp = await emailToken('Verify', secondEmail, '', 'otp');
    await api('/api/auth/verify-email-otp', 'POST', { email: secondEmail, code: secondOtp });
    await api('/api/auth/verify-email-otp', 'POST', { email: secondEmail, code: secondOtp }, 400);
    await api('/api/auth/verify-email', 'POST', { token: secondLink }, 400);
    pass('six-digit OTP verifies its account once and invalidates fallback link');
    pass('real captured verification email and token consumption');
    const login = await api('/api/auth/login', 'POST', { email, password });
    csrf = login.csrfToken;
    check(cookies.has('im_access') && cookies.has('im_refresh'), 'Session cookies missing');
    await api('/api/workspaces');
    pass('verified cookie login and protected access');
    await api('/api/auth/me', 'PATCH', { name: 'CSRF must fail' }, 403, false);
    pass('cookie mutation requires CSRF');
    const refresh = await api('/api/auth/refresh', 'POST', {});
    csrf = refresh.csrfToken;
    pass('refresh rotation');
    const profile = await api('/api/auth/me', 'PATCH', { name: 'Updated smoke-test profile' });
    check(profile.user.name === 'Updated smoke-test profile', 'Profile update not returned');
    const sessions = await api('/api/auth/sessions');
    check(
      sessions.sessions.some((session) => session._id === sessions.currentSessionId),
      'Current device not identified',
    );
    pass('profile update and current-session identification');
    await api('/api/auth/forgot-password', 'POST', { email }, 202);
    const reset = await emailToken('Reset');
    await api('/api/auth/reset-password', 'POST', { token: reset, password: replacement });
    await api('/api/auth/me', 'GET', undefined, 401);
    await api('/api/auth/reset-password', 'POST', { token: reset, password: replacement }, 400);
    pass('real reset email, one-time consumption, and old-session revocation');
    cookies.clear();
    csrf = '';
    await api('/api/auth/login', 'POST', { email, password }, 401);
    const newLogin = await api('/api/auth/login', 'POST', { email, password: replacement });
    csrf = newLogin.csrfToken;
    pass('old password denied and new password accepted');
    await api('/api/auth/logout', 'POST', {}, 204);
    check(cookies.size === 0, 'Logout cookies not cleared');
    await api('/api/auth/me', 'GET', undefined, 401);
    pass('logout and unauthenticated profile denial');
  }
  console.log(
    `${checks.length} local authentication smoke checks passed. Synthetic data retained; credentials and tokens were not logged.`,
  );
} catch (error) {
  console.error(`Authentication smoke test failed: ${error.message}`);
  process.exitCode = 1;
}
