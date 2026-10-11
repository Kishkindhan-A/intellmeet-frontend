# Architecture decisions

## Modular application

Express 5 and TypeScript serve REST APIs. Socket.IO handles collaboration only; LiveKit handles media routing and NAT traversal. MongoDB stores durable records and Redis supports quotas, cross-node events, coordination and BullMQ jobs. The worker runs separately so provider latency does not occupy API requests.

| Module                               | Responsibility                                                  |
| ------------------------------------ | --------------------------------------------------------------- |
| `config.ts`                          | Validated configuration and production minimums                 |
| `db.ts`                              | Schemas and unique/query indexes                                |
| `auth.ts`                            | Accounts, sessions, OAuth, MFA and recovery                     |
| `policy.ts`                          | Shared workspace/meeting/host/admission checks                  |
| `workspaces.ts`                      | Membership, projects, tasks, notifications, audit and analytics |
| `meetings.ts`                        | Lifecycle, lobby, grants, consent, recording and exports        |
| `assets.ts`                          | Private upload reservation, validation, sealing and download    |
| `collaboration.ts`                   | Durable messages and versioned notes                            |
| `realtime.ts`                        | Authorized socket subscriptions and events                      |
| `webhooks.ts`                        | Signed LiveKit callbacks and recording finalization             |
| `jobs.ts`                            | Transcription, summaries, retention and recovery                |
| `providers.ts` / `ports.ts`          | Concrete integrations and testable boundaries                   |
| `app.ts` / `server.ts` / `worker.ts` | HTTP assembly and service lifecycles                            |

## Data and permission model

Users are global identities; membership is scoped to a workspace. A workspace has exactly one designated owner. Meetings belong to a workspace and hold host/visibility/lifecycle policy. Participant records carry admission, publishing and consent state. Every object reference is validated against its tenant, including job context and task assignments.

The workspace is the administrative trust boundary: owners/admins can moderate and inspect meetings. Ordinary members cannot read invitation-only meetings without being invited. During a live meeting, waiting ordinary members cannot access chat, notes, transcripts, summaries, assets or media tokens. Removed participants remain denied by a durable participant record.

Tenant-scoped authorization is enforced in service functions reused by HTTP and socket handlers. Read operations do not trust workspace IDs supplied by clients to establish membership. Query operators are constructed by server code after schema parsing; no request body is forwarded as a Mongo filter/update.

## Consistency

- MongoDB transactions cover workspace creation, ownership transfer and invitation consumption.
- Redis resource locks serialize meeting admission/consent/recording coordination and job acceptance. Database conditional updates and unique indexes protect important persistence invariants independently.
- Notes/tasks use revision/version compare-and-swap and return explicit conflicts.
- Message client IDs, unique transcript asset IDs and unique action IDs make retries safe.
- Persisted jobs survive enqueue failures. Provider calls may run again after a worker crash; their output persistence is deduplicated. Do not promise exactly-once billing by external providers.
- Socket events can be lost during disconnects. REST snapshots/history remain authoritative.

## AI boundaries

The worker processes independently decodable audio chunks. It does not impersonate a meeting participant or silently capture microphones. Output is persisted only after rechecking current permissions and processing policy. The model has no action tools. Summaries expose evidence references, and proposed actions become tasks only after host approval.

Chunk transcription avoids loading full multi-hour recordings into API memory. Limits cap chunk size, duration, transcript size, concurrency and daily workspace jobs. Long transcript summaries are generated in bounded groups; no model-specific context-window assumption is required. Customer/provider limits and budgets must still be configured for production.

## Deliberate choices

Argon2id is used instead of the brief's bcrypt suggestion. LiveKit SFU is used instead of browser mesh networking. S3-compatible storage permits private local SeaweedFS development and managed production storage. Notes use explicit revision conflicts instead of adding an unimplemented CRDT dependency. Optional alternatives researched earlier are not all installed together.

The supplied PDFs are source requirements/context, not instructions that override the user's request. Internship submission/report/video requirements and any institutional restriction on AI-generated submissions are separate from this backend's runtime behavior and were not implemented as application features.
