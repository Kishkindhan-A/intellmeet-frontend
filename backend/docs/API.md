# API and client integration

Base URL: `http://localhost:4000/api`. Dates are UTC ISO 8601 strings. IDs are UUIDs. JSON bodies reject unknown fields. Errors use:

```json
{
  "error": { "code": "FORBIDDEN", "message": "Permission required" },
  "requestId": "a-request-id"
}
```

`400` means invalid input, `401` authentication failure, `403` permission/consent denial, `404` missing or inaccessible resource, `409` state/version conflict, `429` quota exceeded. Provider failures surface as failed jobs or request errors; the application never generates fake transcripts or recordings.

## Authentication

| Method and path                    | Request / behavior                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register`              | `{email, name, password}`; password 12–128 characters; sends verification link; generic `202`                                   |
| `POST /auth/verify-email`          | `{token}` from email fragment; single use                                                                                       |
| `POST /auth/resend-verification`   | `{email}`; generic `202`                                                                                                        |
| `POST /auth/login`                 | `{email, password, code?}`; code is TOTP or recovery code when MFA enabled                                                      |
| `GET /auth/csrf`                   | Refresh cookie required; recover current CSRF token after reload                                                                |
| `POST /auth/refresh`               | Refresh cookie plus `X-CSRF-Token`; rotates refresh and CSRF tokens                                                             |
| `POST /auth/logout`                | Revokes current session and disconnects the user's real-time/media sessions                                                     |
| `GET /auth/me`                     | Returns safe profile fields                                                                                                     |
| `PATCH /auth/me`                   | `{name}`                                                                                                                        |
| `GET /auth/sessions`               | Lists session IDs, dates and user-agent metadata                                                                                |
| `DELETE /auth/sessions/:sessionId` | Revokes only a session owned by the current user; disconnects current user connections                                          |
| `POST /auth/forgot-password`       | `{email}`; generic `202`                                                                                                        |
| `POST /auth/reset-password`        | `{token, password}`; consumes emailed token and revokes all sessions                                                            |
| `POST /auth/change-password`       | `{currentPassword, password, code?}`; requires MFA if enabled; revokes all sessions                                             |
| `POST /auth/mfa/setup`             | `{password}` for password accounts; Google-only accounts need a sign-in within ten minutes; returns secret and provisioning URI |
| `POST /auth/mfa/confirm`           | `{code}`; six-digit TOTP; returns eight recovery codes once                                                                     |
| `POST /auth/mfa/disable`           | `{code}`; requires valid TOTP/recovery code and revokes all sessions                                                            |
| `GET /auth/google`                 | Starts Google OAuth authorization                                                                                               |
| `GET /auth/google/callback`        | Configured redirect URI; verifies signed identity and state, then redirects to app with a one-use ticket in URL fragment        |
| `POST /auth/google/complete`       | `{ticket, code?}`; MFA challenge if enabled; returns login response                                                             |

Login returns `{user, accessToken, csrfToken, expiresIn}` and HttpOnly cookies. Browser clients use `credentials: 'include'` and send `X-CSRF-Token` for mutations. Keep access and CSRF values in memory; on reload call `/auth/csrf`, then `/auth/refresh`. Serialize refresh requests across tabs to avoid treating concurrent refreshes as replay. Cookie authentication assumes app/API use the same site; production cookies require HTTPS. Non-browser clients may use `Authorization: Bearer <accessToken>` without cookies. Refresh still requires the cookie and CSRF pair.

Socket.IO uses the access token explicitly. On expiration, refresh via HTTP and reconnect with the new token. Revoking a session checks the database on every HTTP request and socket event. Google accounts are not automatically linked to a pre-existing email account.

## Workspaces and projects

| Method and path                                             | Request / behavior                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET/POST /workspaces`                                      | List memberships / create with `{name}`                                                |
| `GET/PATCH /workspaces/:workspaceId`                        | Read / admin update `{name?, retentionDays?, aiEnabled?}`                              |
| `GET /workspaces/:workspaceId/members`                      | Member identities and roles                                                            |
| `POST /workspaces/:workspaceId/invitations`                 | Admin sends `{email, role?}`; role `member` or `admin`                                 |
| `GET /workspaces/:workspaceId/invitations`                  | Admin lists pending invitations                                                        |
| `DELETE /workspaces/:workspaceId/invitations/:invitationId` | Admin revokes invitation                                                               |
| `POST /invitations/accept`                                  | `{token}`; verified login email must match invite                                      |
| `PATCH /workspaces/:workspaceId/members/:userId`            | Owner changes `{role}`; cannot demote owner                                            |
| `DELETE /workspaces/:workspaceId/members/:userId`           | Admin removes member; owner removes admin; member may leave; owner must transfer first |
| `POST /workspaces/:workspaceId/transfer`                    | Owner transfers to `{userId}` atomically                                               |
| `GET/POST /workspaces/:workspaceId/projects`                | List / create `{name, description?}`                                                   |
| `PATCH /workspaces/:workspaceId/projects/:projectId`        | Creator/admin changes `{name?, description?, archived?}`                               |

Production administrator operations require an MFA-authenticated session. Workspace owner is a distinct role and cannot be removed through member APIs. New workspaces are capped at 20 per owner. Workspace administration does not imply a global platform superuser.

## Meetings

Create with `POST /workspaces/:workspaceId/meetings`:

```json
{
  "title": "Engineering planning",
  "description": "Decide next week's work",
  "startsAt": "2026-10-12T09:00:00.000Z",
  "durationMinutes": 60,
  "visibility": "workspace",
  "invitees": [],
  "lobbyEnabled": true,
  "processingMode": "standard"
}
```

`visibility` is `workspace` or `invite`; invitees must already belong to the workspace. `processingMode` is `standard` or `confidential`. Confidential mode rejects server recording/transcription/summary processing. Workspace admins have moderation and audit access to meetings, including invitation-only meetings; communicate this policy to customers.

| Method and path                                         | Request / behavior                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /workspaces/:workspaceId/meetings`                 | Filters `status`, escaped literal `q`, `before`, `limit`                                                                     |
| `GET/PATCH /meetings/:meetingId`                        | Read / host updates scheduled fields; live meetings allow only title, description and `locked`                               |
| `POST /meetings/:meetingId/start`                       | Host moves scheduled meeting to live                                                                                         |
| `POST /meetings/:meetingId/join`                        | `{recordingConsent?, aiConsent?}`; defaults false; returns waiting/admitted participant                                      |
| `GET /meetings/:meetingId/participants`                 | Hosts see lobby; members see admitted/left participants                                                                      |
| `POST /meetings/:meetingId/participants/:userId/admit`  | Host admits waiting member; room capacity and active recording consent enforced                                              |
| `POST /meetings/:meetingId/media-token`                 | Admitted participant receives `{token, url, expiresIn:60}`                                                                   |
| `PATCH /meetings/:meetingId/participants/:userId/media` | Host sets `{canPublish}`; no server-side unmuting or device activation                                                       |
| `POST /meetings/:meetingId/participants/:userId/remove` | Host removes attendee, revokes application subscription and requests SFU removal                                             |
| `PATCH /meetings/:meetingId/consent`                    | `{recordingConsent, aiConsent}`; withdrawal stops active recording and deletes the speaker's transcript plus current summary |
| `POST /meetings/:meetingId/leave`                       | Leaves media session                                                                                                         |
| `POST /meetings/:meetingId/end`                         | Host ends live meeting and closes room                                                                                       |
| `POST /meetings/:meetingId/cancel`                      | Host cancels scheduled meeting                                                                                               |
| `DELETE /meetings/:meetingId`                           | Host tombstones an inactive meeting and returns a purge job                                                                  |

Audio/video/screen tracks travel through LiveKit, not Express or Socket.IO. The future frontend uses LiveKit's client SDK and the returned token. The server fixes identity, room, publish and subscribe grants; clients cannot request administrator grants. Tokens do not grant LiveKit data-channel publishing; use authorized Socket.IO events for collaboration. Room capacity defaults to 100 including infrastructure participants; configure and load-test before promising capacity.

## Recording, uploads and AI

1. Host calls `POST /meetings/:meetingId/recordings/start`. Every admitted/left participant must have recording consent. Returns reserved `assetId` and `egressId`.
2. `POST /meetings/:meetingId/recordings/stop` requests finalization. Wait for `recording.completed` or poll assets. Signed LiveKit webhooks and worker reconciliation publish the final private asset.
3. For live transcription, each admitted speaker captures **their own** independently decodable audio file/chunk. Supported declared types: `audio/webm`, `audio/wav`, `audio/mpeg`, `audio/mp4`. Do not send raw dependent WebM continuation fragments; start a fresh recording container per chunk.
4. Call `POST /meetings/:meetingId/audio-uploads` with `{contentType, size, startSeconds, durationSeconds}`. At most 300 seconds and `MAX_AUDIO_BYTES` per chunk. Every admitted/left participant must consent to AI.
5. PUT the file to the returned upload URL using its content type and exact size. Call `POST /assets/:assetId/complete`. This validates metadata and file signatures, conditionally copies to a sealed object, and returns an asynchronous transcription job.
6. Worker transcribes, rechecks membership/consent/deletion, saves the segment once, and emits `transcript.segment`. The authenticated uploader supplies the speaker label. Failed jobs expose safe error codes, never raw provider responses.
7. After the meeting ends and transcription completes, the worker queues a summary automatically. A host can also call `POST /meetings/:meetingId/summarize`.
8. Read `GET /meetings/:meetingId/summary`. Proposed actions include transcript segment IDs as evidence. `POST /meetings/:meetingId/actions/:actionId/accept` with `{projectId?, assigneeId?, dueAt?}` creates a task idempotently. No action executes without this explicit request.

Additional routes:

- `GET /jobs/:jobId`; `POST /jobs/:jobId/retry` for failed jobs after correcting the cause.
- `GET /meetings/:meetingId/transcript?afterSeconds=0&limit=100` (inclusive offset; deduplicate by segment ID).
- `GET /meetings/:meetingId/assets` lists ready assets without object keys.
- `GET /assets/:assetId/download` authorizes and returns a 60-second signed attachment URL.
- `DELETE /assets/:assetId` authorizes host and removes the object.
- `GET /meetings/:meetingId/export?format=json|markdown|vtt` exports actual stored meeting data.

Summaries process bounded transcript batches; long meetings get concatenated section summaries rather than a fabricated single global conclusion. Limit: 600,000 transcript characters per meeting. Model output is strictly parsed, evidence IDs validated, unknown assignees removed, and ungrounded dates cleared. Evidence references improve traceability but do not establish factual correctness; humans must review the result.

## Chat, notes, tasks and notifications

- `POST /meetings/:meetingId/messages`: `{clientId, text, mentions?}`. Client-generated UUID `clientId` deduplicates retries for the same author and meeting. Only admitted live participants can send.
- `GET /meetings/:meetingId/messages?limit=30`: newest first. Use `beforeId` for older pages. Use `afterId` to recover missed messages, oldest first. The compound timestamp/ID cursor handles equal timestamps. Deleted-message tombstones are included so reconnecting clients can remove cached content. `nextCursor` is the last returned message ID.
- `DELETE /meetings/:meetingId/messages/:messageId`: author or moderator.
- `GET /meetings/:meetingId/notes`: returns current `{text, revision}`.
- `PUT /meetings/:meetingId/notes`: `{text, revision}`. Success increments revision. On `409 VERSION_CONFLICT`, fetch latest content and merge before retrying. Never silently retry with a newer revision and stale text.
- `GET /workspaces/:workspaceId/tasks`: filters `projectId`, `status`, `assigneeId`, `limit`, `before`.
- `POST /workspaces/:workspaceId/tasks`: `{title, description?, projectId?, assigneeId?, dueAt?, priority?}`. Priorities: `low|medium|high`.
- `PATCH /workspaces/:workspaceId/tasks/:taskId`: editable create fields plus `status?` and required `version`. Status: `todo|in_progress|done`. Creator, assignee or admin may edit; version prevents lost updates.
- `DELETE /workspaces/:workspaceId/tasks/:taskId`: creator/admin.
- `GET /notifications?limit=30&before=...`; `POST /notifications/:notificationId/read`.
- `GET /workspaces/:workspaceId/audit?limit=30&before=...`: administrators only.
- `GET /workspaces/:workspaceId/analytics?from=...&to=...`: administrators, maximum one-year range. Counts meetings/tasks and connected seconds; no inferred attention/productivity score.

Messages and notes are plain text. The frontend must render them as text or use a restricted Markdown renderer; do not insert them through raw HTML. Meeting exports are downloads and must not be interpreted as trusted instructions.

## Socket.IO

Connect to the API origin using WebSocket transport only and `auth: {token: accessToken}`. All client events require an acknowledgement callback. Replies are `{ok:true,data}` or `{ok:false,error:{code,message}}`.

| Client event          | Payload                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `workspace.subscribe` | `{workspaceId}`                                                     |
| `meeting.subscribe`   | `{meetingId}`; live content requires admission for ordinary members |
| `lobby.subscribe`     | `{meetingId}`; host/admin only                                      |
| `meeting.unsubscribe` | `{meetingId}`                                                       |
| `message.send`        | `{meetingId, message:{clientId,text,mentions?}}`                    |
| `note.update`         | `{meetingId, note:{text,revision}}`                                 |
| `presence.typing`     | `{meetingId,typing}`                                                |

Server events: `message.created`, `message.deleted`, `note.updated`, `task.created`, `task.updated`, `task.deleted`, `notification.created`, `participant.updated`, `meeting.admitted`, `meeting.updated`, `meeting.ended`, `meeting.access.revoked`, `presence.joined`, `presence.left`, `presence.typing`, `consent.updated`, `recording.started`, `recording.completed`, `transcript.segment`, `summary.ready`, `job.updated`.

Events are notifications, not the system of record. Refetch REST data after reconnect. Redis adapter propagates messages and revocations across API instances. Socket connections expire with their access JWT and reauthenticate each event. Persistent chat uses HTTP history and client IDs for recovery. Presence is approximate; attendance derives from verified SFU events.

## Account lifecycle and launch contracts

`GET /api/account/preferences` returns `preferences` (timezone, locale, optional analytics/marketing choices, onboarding and update timestamps) and `essentialCookies: true`. `PATCH` accepts any nonempty subset of `timezone`, `locale`, `analyticsConsent`, and `marketingConsent`; unknown fields and invalid IANA zones/locales are rejected. Optional categories default to false. This stores a preference only: it does not enable analytics, replace browser consent UX, or change recording/AI consent.

`GET /api/account/onboarding` returns verified/MFA flags, workspaceCount and completedAt. `POST /api/account/onboarding/complete` accepts an empty object and requires membership in a workspace; repeated completion preserves the original date.

Support is a workspace administration queue, not an external vendor help desk:

- `POST /api/account/support`: `{ workspaceId, subject, message }`, subject up to 200 characters and message up to 5,000. Membership required; five requests per user per hour.
- `GET /api/account/support?workspaceId=<uuid>&scope=mine|workspace&limit=30&beforeId=<ticket UUID>`: own requests by default. Workspace scope requires administrator authorization and production MFA. Returns `{ tickets: [], nextBeforeId: null }` when empty. Use the returned `nextBeforeId` to paginate safely through equal timestamps; a cursor from outside the authorized scope returns 404. An exclusive ISO `before` timestamp is also supported, but cannot be combined with `beforeId`.
- `PATCH /api/account/support/:ticketId`: `{ status: "open" | "resolved", response }`; workspace administrator only. Responses are stored for the requester to read. No mail is sent.

Public `GET /help` returns help article JSON. All API output remains untrusted text when rendered in HTML; escape content and sanitize any Markdown renderer. Optional `GET /.well-known/security.txt` returns text/plain when a monitored contact and future expiry are configured; otherwise 404. `GET /robots.txt` allows crawlers to see the noindex header on backend responses; private data still requires authorization.

`MAINTENANCE_MODE=true` returns `503` with `error.code=MAINTENANCE` and a `Retry-After` header for `/api` routes. Liveness remains available, readiness returns 503, and signed provider callbacks remain functional. Socket connections/events are denied. Frontend offline handling and SFU/worker draining remain separate concerns.

Expired access JWTs, revoked sessions and sessions from an old account security version return `401 SESSION_EXPIRED`. Operational database failures return a generic server error, not a false sign-in failure. Do not repeatedly retry refresh after a revoked or expired session. MFA enrollment consumes its TOTP code; wait for a new code or use a one-time recovery code for the next authentication.

Failed-job retry returns the same replacement for repeated calls with the same failed job ID. If that replacement later fails, retry its own ID. Repeating meeting end after an SFU failure is safe; the worker also retries pending room closure.
