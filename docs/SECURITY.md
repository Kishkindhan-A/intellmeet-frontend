# Security controls and release checks

This is an implemented application baseline, with explicit deployment responsibilities. It is not a security certification, penetration-test result, or promise of zero vulnerabilities. The design targets relevant OWASP ASVS Level 2 controls.

## Implemented controls

| Area             | Backend enforcement                                                                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords        | Argon2id, 19 MiB memory, two iterations, one lane; 12–128-character enrollment/reset policy; no plaintext password storage                                                                                                                      |
| Sessions         | Signed short-lived HS256 JWTs with issuer/audience/algorithm checks; database lookup each request/event; fixed absolute session expiry; hashed refresh tokens; atomic rotation and replay revocation                                            |
| Browser requests | HttpOnly cookies, Secure in production, SameSite=Lax, explicit CORS origins, CSRF verification for cookie mutations, no-store responses                                                                                                         |
| Account recovery | Single-use expiring reset/verification/invitation tokens stored as hashes; generic account-discovery responses; per-email/IP quotas; reset revokes sessions                                                                                     |
| MFA              | TOTP, encrypted secrets using AES-256-GCM, step-up for enrollment, replay window guard, hashed one-use recovery codes; production admin actions require MFA                                                                                     |
| OAuth            | Google authorization-code flow with PKCE, random state/nonce, cookie binding, verified signed ID token, fixed redirect, one-use completion ticket; no automatic email account linking                                                           |
| Authorization    | Workspace membership on every scoped request; meeting visibility/admission checks; owner-only transfer/role changes; scoped task/project references; no global superuser endpoint                                                               |
| Real-time        | Explicit origins, access-token handshake, per-event reauthentication/authorization/schema validation/quotas, bounded packets, expiry disconnect, cross-node revocation                                                                          |
| SFU              | Server-selected identity/room/grants, 60-second join tokens, capacity cap, host-controlled publishing, participant removal, trusted webhook validation                                                                                          |
| Storage          | Generated object keys, private bucket, five-minute upload and one-minute download capabilities, exact metadata/size checks, audio magic checks, conditional ETag sealing, attachment downloads, deletion jobs                                   |
| AI               | Server-only key, explicit consent/workspace policy, worker reauthorization before processing and persistence, untrusted transcript instructions, no model tools, strict output schema, source evidence validation, human-approved task creation |
| Inputs           | Strict Zod schemas, request/body/file/string/array limits, escaped search regex, no user-supplied MongoDB operators, no arbitrary provider URLs, no shell commands in runtime                                                                   |
| Abuse/cost       | Redis-backed API/auth/socket/email/invitation/upload/AI limits; workspace creation limit; bounded transcription/summary sizes; worker concurrency and retry caps                                                                                |
| Operations       | Request IDs, redacted structured logs, safe public errors, tenant-scoped audit records, readiness/liveness, protected Prometheus metrics, graceful shutdown                                                                                     |
| Delivery         | Lockfile, TypeScript checks, integration tests, dependency audit, secret scanning, non-root image, restricted Kubernetes pods and default-deny networking                                                                                       |

## Threats exercised by regression tests

The test suite covers cross-workspace access, role escalation, invitations bound to email, owner removal, CSRF, disallowed origins, refresh reuse, reset reuse and revocation, MFA recovery replay, lobby media gating, recording/AI consent, confidential-mode processing denial, lost note/task updates, duplicate message/AI jobs, invalid uploads, private downloads, consent withdrawal while the AI call runs, invented evidence, signed-webhook rejection/deduplication, deletion, metrics access, and real socket event reauthorization.

The main integration suite uses real MongoDB and HTTP/socket transport; provider boundary adapters are controlled doubles. Real Redis failover, S3 IAM, LiveKit/TURN behavior, OpenAI account/model availability, email delivery and OAuth provider behavior require staging verification. CI configuration is supplied; a remote CI run is not implied by its presence.

## Privacy and media boundaries

- TLS/WebRTC transport encryption is distinct from end-to-end media encryption. `confidential` prevents server recording/AI, but the future client must implement and verify E2EE key distribution before the product advertises E2EE. Server-processed meetings must be labeled accordingly.
- Self-hosted LiveKit removal does not invalidate a cached join token. A 60-second issuance lifetime limits new joins; verified join callbacks and reconciliation remove unauthorized participants. These controls are not instantaneous cryptographic revocation. For strict revocation, use a compatible LiveKit Cloud deployment with `LIVEKIT_CLOUD=true` and validate token-cutoff behavior. This backend supplies `revokeTokenTs` on removal in that mode.
- Revoking consent cannot retract audio already sent to a provider or erase copies already downloaded. Withdrawal prevents subsequent authorized processing/persistence and removes the speaker's current transcript plus current summary. Previously accepted tasks and private recordings remain until separately deleted/retained according to workspace policy. Make this visible in the future UI.
- Existing signed download URLs remain usable for up to 60 seconds after membership revocation unless the object is deleted. Upload URLs can remain usable for five minutes, but completion copies validated bytes into a separately sealed object. Configure a bucket lifecycle to remove orphaned `pending/` objects after one day.
- Audio signature checks detect basic type mismatches, not malicious media payloads. General file attachments are not accepted. Isolate the transcription/provider pipeline and keep media SDKs/decoders patched.
- Retention purges stored meeting messages, notes, transcripts, summaries, recordings and meeting-derived tasks. A minimal meeting tombstone plus job/audit metadata remains for accountability. Backups have an independent documented retention period; purge/restore procedures must honor deletion requests.
- OpenAI requests use `store:false` for Responses. This does not create an organization-level zero-retention agreement. Confirm applicable endpoint retention, residency and contractual requirements before processing real enterprise data.

## Required deployment controls

1. Use HTTPS for app/API, WSS/TLS for internet media, TLS and authentication for managed MongoDB/Redis, and private networking. Do not expose development database, Redis, Mailpit or storage-console ports publicly.
2. Store secrets in a secret manager; use separate development/staging/production accounts. Keep the API and worker under least-privilege identities. Restrict S3 to the selected private bucket/prefix. Use separate migration credentials if production runtime cannot create indexes.
3. Enable S3 Block Public Access, encryption at rest/KMS, lifecycle cleanup for unfinished uploads, access logging, and a tested bucket CORS policy restricted to your application origin. Scope pre-signed PUT permissions to upload staging prefixes and final object mutations to the backend.
4. Put the API behind a gateway/WAF with request, connection and DDoS controls. Configure `TRUST_PROXY_HOPS` to the **actual** proxy topology; never trust arbitrary forwarded IP headers. Restrict `/metrics` and provider callbacks at the network layer in addition to their application authentication.
5. Use Redis authentication, TLS and `noeviction` for reliable jobs. Avoid sharing Redis with untrusted applications. Restrict outbound traffic to selected MongoDB, Redis, S3, SMTP, Google, OpenAI and media endpoints; no general arbitrary fetch endpoint exists.
6. Enforce MFA for production administrators; restrict who may create public signups through your gateway if deployment is invitation-only. Configure enterprise identity lifecycle outside Google OAuth if SAML/SCIM is required.
7. Export audit events to access-controlled immutable storage. Database audit records alone are not tamper-proof against database administrators. Exclude transcripts, raw prompts, cookies and authorization values from external error tracking.
8. Encrypt backups and test restoration in an isolated environment. Define RPO/RTO, deletion retention, incident ownership, rollback procedures and provider spend alerts.
9. Scan release images and infrastructure configuration, run authenticated DAST against your own isolated staging environment, and commission a penetration test before enterprise use. Do not scan third-party systems without authorization.

## Release gate

- `npm run check`, formatting, secret scan, YAML validation and dependency audit pass.
- No unresolved exploitable critical/high findings, cross-tenant access, exposed secrets, public media objects, or authentication bypass.
- Real provider smoke tests cover two independent workspaces, removed participants, a recording, audio transcription, summary approval, email verification/reset, Google MFA login, and signed callback replay.
- Confirm backup restoration, deletion/lifecycle behavior, log redaction, queue recovery, horizontal socket revocation, and overload behavior.
- Load-test the intended participant and meeting capacity. No 5,000-participant or 10,000-meeting claim follows from this implementation.

## Primary references

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
- [OWASP prompt injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [LiveKit tokens and grants](https://docs.livekit.io/frontends/reference/tokens-grants/)
- [LiveKit encryption](https://docs.livekit.io/transport/encryption/)
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
- [AWS S3 security practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
- [Kubernetes security checklist](https://kubernetes.io/docs/concepts/security/security-checklist/)

## Audit hardening

Password reset and verification token consumption now commit atomically with their account updates. Password and MFA changes invalidate sessions through account security versions, including sessions created from credentials verified before the change. MFA enrollment atomically selects one pending secret/recovery-code set and consumes the current TOTP counter.

Meeting/asset locks coordinate upload completion, deletion, cleanup, leave, chat and purge writes. Recording stop uses a conditional update so delayed responses cannot overwrite completed state; active recording assets cannot be deleted. Failed room closure is persisted for worker retry, and repeated failed-job retry requests deduplicate by their parent job. These controls have local regression coverage; provider effects and distributed lock-loss behavior still require staging tests.

Account preferences, support requests, and onboarding are authorized per user/workspace. Support listing and responses for an entire workspace require administrator permission and production MFA. Optional tracking choices default off, and no tracking integration is enabled by the backend. Public indexing headers do not substitute for access controls.
