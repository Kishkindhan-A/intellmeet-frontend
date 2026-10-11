// Regression check for both supported local frontend addresses.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const runtime = JSON.parse(await readFile('.data/local-run/running.json', 'utf8'));
assert.equal(runtime.api, 'http://localhost:4000', 'Isolated local runtime required');
for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
  const preflight = await fetch('http://127.0.0.1:4000/api/auth/register', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  // Use the frontend proxy, just as the registration form does. Mail is captured locally.
  const response = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Local origin regression',
      email: `origin-${randomBytes(8).toString('hex')}@example.test`,
      password: `LocalCheck!${randomBytes(24).toString('hex')}`,
    }),
  });
  assert.ok(response.ok, `Registration from ${origin} returned ${response.status}`);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  console.log(`PASS: preflight and registration from ${origin}`);
}
for (const origin of ['https://untrusted.example', 'http://127.0.0.1:5174']) {
  const response = await fetch('http://127.0.0.1:4000/api/auth/register', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ORIGIN_DENIED');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  console.log(`PASS: rejected ${origin}`);
}
