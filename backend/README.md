# IntellMeet backend

A TypeScript/Node.js backend for IntellMeet. This repository contains the API, real-time collaboration server, background worker, database models, provider integrations, tests, and deployment configuration. The React frontend is intentionally outside this delivery.

## Included

- Email verification, password login/reset/change, Google OAuth with PKCE/state/nonce, authenticator MFA, single-use recovery codes, session listing/revocation, rotating refresh cookies, and CSRF protection.
- Workspaces, owner/admin/member permissions, email invitations, ownership transfer, projects, versioned Kanban tasks, notifications, and audit history.
- Meeting scheduling, invitation-only meetings, lobby admission, meeting locks, participant removal, publishing permissions, attendance, and LiveKit tokens for video/audio/screen sharing.
- Durable, retry-safe meeting chat and mentions; collaborative notes with revision checks; authenticated Socket.IO subscriptions and reconnect history.
- Consent-controlled LiveKit recording, signed webhooks, callback reconciliation, private S3 downloads, and validated audio uploads sealed against later replacement.
- OpenAI transcription jobs, live transcript delivery from uploaded audio chunks, post-meeting summaries, evidence-backed proposed actions, and explicit human approval before creating tasks.
- Analytics based on stored activity, JSON/Markdown/WebVTT exports, retention cleanup, deletion jobs, health checks, Prometheus metrics, and structured logs.
- Docker Compose for development, a non-root application image, Kubernetes baseline, CI checks, security tests, and operational documentation.
- Account preferences and onboarding, workspace support requests and administrator responses, help articles, maintenance responses and configurable security disclosure.

The [audit report](docs/AUDIT-2026-10-10.md) records reproduced bugs, fixes, checks and deployment limitations. The [PDF checklist](docs/LAUNCH-CHECKLIST.md) maps all 42 page/state items and ten launch steps; [policy drafts](docs/POLICY-DRAFTS.md) identify the business details needed before publication.

## Quick start

For the tested Windows run without Docker, see [local startup and Playwright MCP evidence](docs/BROWSER-AUDIT.md). Use `npm run local:start`, `npm run test:browser`, and `npm run local:stop` after its one-time dependency setup.

Install Node.js 24 and Docker Desktop with Linux containers. From this directory:

```sh
npm ci
npm run setup
docker compose up --build -d
```

`setup` creates an ignored `.env` with random local credentials. It preserves an existing `.env`. Add your OpenAI API key there to enable AI processing. Missing integrations return errors rather than simulated successful results.

| Service                                   | Local URL                          |
| ----------------------------------------- | ---------------------------------- |
| API                                       | http://localhost:4000              |
| OpenAPI contract                          | http://localhost:4000/openapi.json |
| Readiness                                 | http://localhost:4000/health/ready |
| Local verification/invitation email inbox | http://localhost:8025              |
| Private S3 endpoint                       | http://localhost:9000              |

To include the local media server and recording worker:

```sh
docker compose --profile media up --build -d
```

Local media networking on Docker Desktop must be tested with actual browser participants; for internet-accessible meetings use LiveKit Cloud or configure a public SFU/TURN deployment. See [deployment guidance](docs/DEPLOYMENT.md).

To run Node directly while using containerized dependencies:

```sh
docker compose up -d mongo-init redis storage mailpit
npm run dev
```

Run `npm run dev:worker` in a second terminal. For host-run API plus local LiveKit, change the generated LiveKit webhook URL to `http://host.docker.internal:4000/webhooks/livekit`. Recreate the media service after that change.

An optional synthetic demo is available with `npm run seed` when running against the host-accessible development database. It prints a generated password once and refuses production mode. Regular registration sends verification links to Mailpit; no fixed administrator password exists.

## Verify

```sh
npm run check
npm run security:secrets
npm audit --audit-level=high
npm run validate:deploy
```

Tests start an isolated MongoDB replica set using `mongodb-memory-server`; the first run may download MongoDB 8.2.6. They exercise actual HTTP routes, MongoDB transactions/indexes, password hashing, signed access tokens, and a real Socket.IO connection. External email, Redis coordination, S3, LiveKit, and OpenAI are controlled test adapters. These tests do not claim a live cloud integration or load-test result.

## Documentation

- [API and frontend integration](docs/API.md)
- [Security controls and release checks](docs/SECURITY.md)
- [Deployment, backups, recovery, and monitoring](docs/DEPLOYMENT.md)
- [Architecture and design decisions](docs/ARCHITECTURE.md)
- [Machine-readable contract](docs/openapi.json), generated with `npm run docs:export`

## Delivery boundaries

Docker and external service credentials are required to verify the full deployed system. No frontend or external deployment has been created. Video capture, screen selection, microphone permission, rendering, and optional client-side media encryption belong to the future frontend. Confidential mode disables server AI and recording; it does **not** by itself implement end-to-end encryption.

Transcription accepts independent audio files/chunks of at most five minutes and 24 MB by default. The frontend must capture only the authenticated speaker's audio, upload each independently decodable chunk, then complete the upload. Captions appear after worker processing, not word-by-word directly from the SFU. A completed MP4 recording is stored privately; recording audio is not automatically extracted from MP4. Post-meeting summaries are automatically queued once uploaded transcription jobs finish, or can be requested explicitly. Speaker labels identify the uploader and are not biometric speaker verification.

Notes use optimistic concurrency: conflicting edits return `409` for the client to merge. This protects against lost updates without claiming a character-level CRDT editor. General file attachments, SAML/SCIM, organization billing, and calendar integrations are outside this backend's defined API. Adding an integration requires its actual authorization and credentials; installing an MCP tool is not a runtime integration.
