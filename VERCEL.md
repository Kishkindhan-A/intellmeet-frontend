# IntellMeet on Vercel Services

Configuration is prepared for review; no deployment has been performed.
Import the repository with its root directory set to the repository root, not frontend/.
Use Node.js 24 and enable Fluid compute and the applicable Services/WebSocket/Daemon betas.

## Routing and communication

- frontend: static Vite SPA at /, with service-local fallback to index.html for deep links.
- backend: Express HTTP server at /api/*, /socket.io/*, /webhooks/*, /health/*,
  and /.well-known/security.txt. Prefixes are preserved by Vercel.
- worker: private continuous BullMQ daemon; proposed one instance in bom1 (Mumbai).
  Daemons currently run in production only; previews need a separately managed worker
  if queued jobs are to execute. Confirm regional availability before deployment.
- /metrics, /openapi.json and backend /help have no public backend rewrite.
  /help belongs to the frontend UI. Do not expose metrics without its bearer token.

No service bindings are needed: the frontend contains browser code, not server-side
functions. Browser fetches use /api; Socket.IO uses the shared origin /socket.io.
Neither backend nor worker calls the frontend or the other process over HTTP.
They coordinate through external MongoDB and Redis/BullMQ. Vercel service bindings
are runtime HTTP URLs, not database, Redis, SMTP, media or S3 credentials.
Do not invent or manually assign a bound URL, or expose one through VITE_* variables.

The Vercel entrypoint exports the Node HTTP server without calling listen(). Existing
server.ts and local-runtime scripts remain the standalone development path. Socket.IO
already uses WebSocket-only transport, resubscribes on connect, reloads state and uses
the Redis adapter across instances. Connections can close at function duration limits.

The backend's `outputDirectory` must remain `"."`. Without this override, the Vercel
Services builder searches generated dist/ for a conventional entrypoint and may select
dist/app.js (the app factory) instead of src/vercel.ts (the initialized HTTP server).
It can also flatten that generated file outside its ESM package context, producing
`SyntaxError: Cannot use import statement outside a module` in /var/task/app.js.
Using the service root keeps the explicit TypeScript entrypoint on the source bundling
path and preserves module/dependency handling. Do not set the backend output to dist.

## Environment

Configure values in Vercel's environment settings, never Git. Use backend/.env.example
as the full inventory. APP_URL and API_URL are the same public HTTPS origin, without
/api. Set CORS_ORIGINS to the exact allowed public origins. Preview URLs need their own
matching values; do not use wildcard credentialed origins.

Required: MONGODB_URI (reachable Atlas/replica set), REDIS_URL (TCP/TLS Redis compatible
with BullMQ and Socket.IO pub/sub), strong JWT_SECRET, ENCRYPTION_KEY, METRICS_TOKEN,
REQUIRE_ADMIN_MFA=true and REQUIRE_EMAIL_VERIFICATION=false. Email verification is optional; SMTP_URL and EMAIL_FROM are needed for email-dependent features such as password reset.

Set REQUIRE_EMAIL_VERIFICATION=false in existing Vercel Production settings and redeploy. New accounts sign in immediately after registration; existing unverified accounts can sign in with their correct password. Email addresses remain unverified in the database.
Current production validation requires real email verification and SMTP; local testing
without email is not a production configuration. Set TRUST_PROXY_HOPS to the verified
proxy topology rather than trusting arbitrary forwarded addresses.

For meeting/AI/file features configure externally hosted LiveKit and egress, OpenAI,
and S3 with browser upload CORS. They are not provisioned by vercel.json. Use public
HTTPS/WSS endpoints where browsers connect, not Docker names or localhost. The worker
must share database, Redis, secrets and provider configuration with the backend.
Leave VITE_API_URL and VITE_SOCKET_URL unset for shared-domain routing.

### Missing production secrets

If runtime logs report `JWT_SECRET` or `ENCRYPTION_KEY` as undefined, the application
has loaded but Vercel Production variables are missing. Fix the Vercel environment;
do not commit secrets, add hardcoded defaults, or weaken configuration validation.

From backend/, run `npm run vercel:prepare-env -- https://intellmeet-frontend-rust.vercel.app`.
This creates the ignored `.env.vercel.production.local` with fresh JWT, encryption and
metrics secrets, HTTPS origins and production security flags. It never overwrites an
existing file or prints secrets. Fill in MONGODB_URI, REDIS_URL, SMTP_URL and EMAIL_FROM
with the actual cloud provider values. Do not import local MongoDB/Redis or captured
email addresses into a cloud deployment. For an existing production database, retain
its original encryption key and signing secret rather than replacing them with new ones.

In this project's Vercel Environment Variables page, import the completed private file
for Production. Store secret values as Secret; keep them server-side, without VITE_
prefixes. Redeploy after saving: existing deployments retain their previous variables.
The backend and worker need the same relevant values. A connected Vercel account must
have access to the team that owns this project before an assistant can apply them.

## Verification

Run npm ci in backend/ and frontend/, then their builds and backend tests.
Use a current Vercel CLI from the repository root: `vercel dev -L` (or `vercel dev`).
The CLI runs the two services but does not run daemons locally. Run the worker through
Docker or the existing local runtime using the same development database and Redis.
Do not run it with live production credentials: backend startup performs index creation
and credential-version backfills. Use isolated development MongoDB and Redis.
Check /api/auth/config, /health/ready, /login deep links, CSRF cookies, Socket.IO
reconnections, authenticated webhooks and worker job completion. A successful local
build alone does not verify Vercel routing, beta access, daemon containers or credentials.

Preparation checks: both builds and all 96 tests passed. Vercel CLI 64.5.0 recognized
both services, but its Windows file watcher encountered EBUSY on a running local
storage database lock. End-to-end Vercel dev routing and daemon execution are not yet
verified. Stop the standalone local services before repeating the Vercel dev check.

References: https://vercel.com/docs/services,
https://vercel.com/docs/services/bindings,
https://vercel.com/docs/services/routing,
https://vercel.com/docs/functions/websockets,
https://vercel.com/docs/daemons.
