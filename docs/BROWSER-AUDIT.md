# Running backend and Playwright MCP verification

On 10 October 2026, the backend was started with real MongoDB 8.2.6, Redis 8.10.2 (a community Windows build), Mailpit 1.31.4, the API, and the BullMQ worker. All application services bind to loopback in this isolated development run. User `.env` values were not edited. Service data and generated credentials are kept in ignored `.data/local-run`.

## Browser result

Microsoft `@playwright/mcp` 0.0.83 was launched through its actual stdio MCP interface using the MCP SDK. Its `browser_navigate`, `browser_evaluate`, screenshot, console and network tools controlled a headless Edge browser with an isolated profile. This was not a claim that a Codex plugin was connected; no matching plugin was found in discovery.

A temporary test page at `localhost:5173` made credentialed requests to `localhost:4000`, exercising actual browser CORS, cookie and WebSocket behavior. It is a test harness, not a React frontend. The nine audit phases passed, with 33 API requests in the recorded successful run:

1. Readiness and registration from the browser origin.
2. Verification email delivered to real local SMTP; single-use verification and HttpOnly cookie login.
3. CSRF rejection, account preferences, input validation, workspace creation and onboarding.
4. Meeting start/join, Redis-coordinated chat deduplication and optimistic note conflict handling.
5. Browser WebSocket authentication and meeting subscription through the real Redis adapter.
6. Support creation/response and explicit unavailable-provider responses.
7. Refresh cookie rotation and CSRF recovery.
8. Meeting end and deletion processed to completion by the separate BullMQ worker.
9. Logout, cookie rejection and socket disconnection.

The browser console recorded six expected errors from deliberate negative checks: missing CSRF (403), invalid time zone (400), stale note revision (409), disabled media/AI integrations (503 each), and a signed-out request (401). These were asserted outcomes, not unexplained application errors. The initial script run had an escaped-newline syntax error in its final phase; that test-harness defect was corrected and the complete run passed.

Local launcher fixes included Redis readiness retries, a Windows/MSYS configuration-path correction, duplicate-run protection, and explicit loopback binding. `BIND_ADDRESS` is configurable without changing the existing container default of `0.0.0.0`.

## Start, test and stop

Windows with Node.js 24 and installed Edge:

```powershell
npm.cmd ci
powershell -NoProfile -File scripts/setup-local.ps1
npm.cmd run local:start
```

The setup script uses pinned URLs and SHA-256 verification for the Redis community Windows build and Mailpit; it does not register services or alter system PATH. MongoDB's development launcher uses the already installed `mongodb-memory-server` package to manage an actual persistent WiredTiger replica-set process. This Windows configuration is for development; production still requires the documented secured infrastructure.

In another terminal:

```powershell
npm.cmd run test:browser
npm.cmd run local:stop
```

Readiness: `http://localhost:4000/health/ready`. Contract: `http://localhost:4000/openapi.json`. Captured mail: `http://localhost:8026`. Redis uses loopback port 6380 with a random password; MongoDB uses 27018. Stop retains development data. Do not delete that directory when it contains data you want to retain.

Each audit uses synthetic accounts and leaves workspace/support records as test data. Test-created meetings are purged by the worker. The runner creates no external email, purchases, or AI calls. Repeated runs remain subject to real rate limits; wait for the relevant limit window rather than disabling protections. Port 5173 is used only while the browser audit harness runs.

The latest machine-readable evidence is `.data/browser/report.json`; a screenshot is `.data/browser/passed.png`. These are ignored local artifacts. Reports omit MCP's echoed executable code to avoid retaining test credentials in the summary.

## Limits

No product frontend was built. LiveKit, OpenAI, Google sign-in and S3 are not exercised as working integrations in this isolated run. Their unavailability is explicit. Real audio/video, recording, AI quality, object permissions, external delivery, production TLS, horizontal replicas and load testing still need configured services and staging. The local test does verify real Redis locks, queues, socket transport, MongoDB, SMTP capture and the browser security flow previously covered only by controlled adapters.

Tool source: [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp). Dependency sources: [Redis Windows community releases](https://github.com/redis-windows/redis-windows/releases) and [Mailpit releases](https://github.com/axllent/mailpit/releases).
