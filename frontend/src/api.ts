export interface User {
  id: string;
  name: string;
  email: string;
  mfaEnabled: boolean;
  verified: boolean;
}
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
let accessToken = '';
let csrfToken = '';
let pending: Promise<void> | null = null;
const sessionChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('intellmeet-session');
sessionChannel?.addEventListener('message', (event) => {
  if (event.data === 'signed-out') endSession(false);
});
const base = import.meta.env.VITE_API_URL || '/api';
export const getAccessToken = () => accessToken;
function endSession(broadcast: boolean, reason: 'signed-out' | 'expired' = 'signed-out') {
  accessToken = '';
  csrfToken = '';
  window.dispatchEvent(new CustomEvent('session-ended', { detail: { reason } }));
  if (broadcast) sessionChannel?.postMessage('signed-out');
}
export function clearSession(reason: 'signed-out' | 'expired' = 'signed-out') {
  endSession(true, reason);
}
export function setSession(s: { accessToken: string; csrfToken: string }) {
  accessToken = s.accessToken;
  csrfToken = s.csrfToken;
}
async function raw<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let r: Response;
  try {
    r = await fetch(base + path, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      // A newly started deployment can take longer than the old 20-second deadline.
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    throw new ApiError(
      0,
      timeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      timeout
        ? method === 'GET'
          ? 'The server took too long to respond. Please try again.'
          : 'The request took too long. Refresh to check whether your change was saved before trying again.'
        : 'Unable to reach the server. Check your connection and try again.',
    );
  }
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok)
    throw new ApiError(
      r.status,
      data?.error?.code || 'REQUEST_FAILED',
      data?.error?.message ||
        (r.status >= 500
          ? 'Account services are temporarily unavailable. Please try again shortly.'
          : `Request failed (${r.status})`),
    );
  if (r.status !== 204 && data === null)
    throw new ApiError(
      502,
      'INVALID_RESPONSE',
      'The server returned an unexpected response. Please try again.',
    );
  return data as T;
}
export async function restoreSession() {
  if (!pending) {
    const refresh = async () => {
      csrfToken = (await raw<{ csrfToken: string }>('/auth/csrf')).csrfToken;
      setSession(
        await raw<{ accessToken: string; csrfToken: string }>('/auth/refresh', 'POST', {}),
      );
    };
    pending = (
      navigator.locks ? navigator.locks.request('intellmeet-refresh', refresh) : refresh()
    ).finally(() => {
      pending = null;
    });
  }
  return pending;
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let retriedCsrf = false;
  let retriedSession = false;
  for (;;) {
    try {
      return await raw<T>(path, method, body);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 403 &&
        error.code === 'CSRF_INVALID' &&
        method !== 'GET' &&
        !retriedCsrf
      ) {
        // A CSRF denial happens before the write; a second tab may have rotated the cookie.
        retriedCsrf = true;
        try {
          csrfToken = (await raw<{ csrfToken: string }>('/auth/csrf')).csrfToken;
        } catch (csrfError) {
          if (csrfError instanceof ApiError && csrfError.status === 401) clearSession('expired');
          throw csrfError;
        }
        continue;
      }
      const protectedRequest =
        !path.startsWith('/auth/') ||
        path === '/auth/me' ||
        path === '/auth/logout' ||
        path === '/auth/sessions' ||
        path.startsWith('/auth/sessions/');
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        (protectedRequest || error.code === 'SESSION_EXPIRED')
      ) {
        if (retriedSession) {
          clearSession('expired');
          throw error;
        }
        retriedSession = true;
        try {
          await restoreSession();
        } catch (refreshError) {
          if (refreshError instanceof ApiError && refreshError.status === 401)
            clearSession('expired');
          throw refreshError;
        }
        continue;
      }
      throw error;
    }
  }
}
export async function login(email: string, password: string, code: string) {
  const s = await raw<{ user: User; accessToken: string; csrfToken: string }>(
    '/auth/login',
    'POST',
    { email, password, ...(code ? { code } : {}) },
  );
  setSession(s);
  return s.user;
}
