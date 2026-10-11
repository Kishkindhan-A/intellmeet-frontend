export interface User {
  id: string;
  name: string;
  email: string;
  mfaEnabled: boolean;
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
const base = import.meta.env.VITE_API_URL || '/api';
export const getAccessToken = () => accessToken;
export function clearSession() {
  accessToken = '';
  csrfToken = '';
  window.dispatchEvent(new Event('session-ended'));
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
  const r = await fetch(base + path, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok)
    throw new ApiError(
      r.status,
      data?.error?.code || 'REQUEST_FAILED',
      data?.error?.message || `Request failed (${r.status})`,
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
  try {
    return await raw<T>(path, method, body);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && !path.startsWith('/auth/')) {
      try {
        await restoreSession();
      } catch (f) {
        if (f instanceof ApiError && f.status === 401) clearSession();
        throw f;
      }
      return raw<T>(path, method, body);
    }
    throw e;
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
