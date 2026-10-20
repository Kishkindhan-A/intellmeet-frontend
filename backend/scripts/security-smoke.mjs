// Read-only/invalid-input smoke checks for an explicitly selected deployment.
const base = new URL(process.argv[2] || 'https://intellmeet-frontend-rust.vercel.app');
if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Use an HTTP(S) deployment URL');
let failures = 0;
async function check(path, options, expected, inspect) {
  const response = await fetch(new URL(path, base), {
    ...options,
    redirect: 'manual',
    signal: AbortSignal.timeout(45000),
  });
  const passed = response.status === expected && (!inspect || inspect(response));
  if (!passed) failures++;
  console.log(
    `${passed ? 'PASS' : 'FAIL'} ${options?.method || 'GET'} ${path}: HTTP ${response.status}`,
  );
  await response.arrayBuffer();
}
const headers = (response) => {
  const policy = response.headers.get('content-security-policy') || '';
  return (
    policy.includes("script-src 'self'") &&
    !policy.includes("script-src 'self' 'unsafe-inline'") &&
    policy.includes("frame-ancestors 'none'") &&
    response.headers.get('x-content-type-options') === 'nosniff' &&
    response.headers.get('referrer-policy') === 'no-referrer' &&
    !!response.headers.get('permissions-policy')
  );
};
await check('/login', {}, 200, headers);
await check(
  '/workspace/tasks',
  {},
  200,
  (response) =>
    headers(response) && (response.headers.get('cache-control') || '').includes('no-store'),
);
await check('/health/ready', {}, 200);
await check('/api/workspaces', {}, 401);
await check('/api/auth/config', { headers: { Origin: 'https://untrusted.example' } }, 403);
await check('/api/auth/config', { headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403);
await check(
  '/api/auth/login',
  { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' },
  415,
);
await check(
  '/api/auth/login',
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' },
  400,
);
process.exitCode = failures ? 1 : 0;
