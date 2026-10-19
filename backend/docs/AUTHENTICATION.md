# IntellMeet authentication integration

Updated 19 October 2026.

Current local-project preference: `REQUIRE_EMAIL_VERIFICATION=false`. Signup creates an account and the frontend immediately signs in with its email/password. Existing pending accounts can also sign in without OTP. No verification email is sent or verification claim added to account records. `GET /api/auth/config` supplies this policy to the frontend. Passwords, MFA when enrolled, session/CSRF checks and quotas remain enforced. The local runner sets this preference; production configuration requires the flag to be true. The verification workflows below remain available when enabled.

This mode passed 96 automated tests and six live local checks, including registration, password login without OTP, incorrect-password denial, protected access and logout invalidation. Both builds pass. The earlier testing cooldown expired before the final live check.

The subsequent [automatic email verification update](EMAIL_VERIFICATION.md) adds branded HTML mail, automatic link checking, coordinated resend replacement and uniform recipient-specific SMTP. Its final suite passes 89 tests; the 80-test/12-check figures below describe the preceding authentication integration.

## Architecture and scope

The existing React 19 / TypeScript / Vite frontend and Node.js / Express 5 backend remain in use. MongoDB and Mongoose store accounts, sessions and single-use tokens; Redis coordinates rate limits. The existing Paper & Signal components and responsive styles are reused. No new packages, second backend, or replacement database were introduced.

The account identifier is email. Username sign-in is not introduced because the existing schema has no usernames. Workspace owner/admin/member authorization remains enforced by the existing backend membership policy.

## Changes

- Registration and reset forms require password confirmation and support password-manager autocomplete, accessible labels, bounded inputs, pending states and safe notifications.
- Login, registration, forgotten-password, reset, verification and OAuth completion have explicit URLs. Browser history updates with each form. Logged-out private entry points redirect to login; `/profile` returns to the account screen after login. Redirect destinations are fixed internal paths.
- Link tokens are read without mutating location during render, so React StrictMode cannot erase them during repeated initialization. The fragment is removed after mounting; the token is held only in component memory. Reloading after removal requires opening the original email link again. Tokens never appear in rendered HTML.
- Profile changes update the signed-in name immediately. Profile and security settings are available before creating a workspace.
- Password changes require the current password and an MFA/recovery code when MFA is enabled. All sessions are revoked after a successful change or reset.
- Account settings list active devices and allow individual sign-out. Lists identify the current session and exclude refresh hashes and CSRF secrets.
- Expired authentication triggers one coordinated refresh, then returns to login with an expiry message if restoration fails. Visible tabs recheck account/session state on focus and once per minute. Temporary network errors preserve the local identity until the server can be checked again. Protected data always requires server authorization.
- Sign-out clears in-memory credentials and broadcasts a sign-out signal to other open tabs, without storing tokens in localStorage. CSRF rejection can recover a token rotated by another tab and retry once; authorization retry is also bounded.
- Email normalization trims and lowercases addresses. The unique-email index remains the final duplicate-account guard. Concurrent registration races return the same generic accepted response and do not replace account data.
- Failed email delivery returns `503 MAIL_UNAVAILABLE`, suppresses provider details and removes the undelivered token. Successful generic recovery responses do not claim that an ineligible or nonexistent account received email.

## Database and migrations

No schema migration or data deletion is required by this change. Existing collections and indexes are reused:

| Collection    | Authentication fields and guarantees                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Users         | Unique normalized email, name, Argon2id password hash, verified status, MFA state, security version and timestamps                          |
| Sessions      | User ID, hashed refresh token and CSRF value, encrypted recoverable CSRF value, absolute expiry, revocation timestamp and device user-agent |
| OneTimeTokens | Unique token hash, kind, user ID and expiry; plaintext token is sent only through the delivery workflow                                     |
| Memberships   | Unique workspace/user pair and owner/admin/member role                                                                                      |

The existing `ensureIndexes()` startup procedure creates missing indexes and idempotently backfills security versions for old accounts/sessions. It does not drop indexes or overwrite user accounts. MongoDB must support transactions (a replica set or Atlas). Expiration checks run in application queries even before MongoDB TTL cleanup.

## Session and password security

- Password hashing uses Argon2id with 19,456 KiB memory, two iterations and one lane. Passwords accept 12–128 characters without arbitrary composition rules.
- Access credentials last 600 seconds by default (`ACCESS_TOKEN_SECONDS`, allowed 60–900). Refresh sessions expire after seven days by default (`SESSION_DAYS`). Every authenticated request checks the database session, revocation and credential version.
- Access and refresh cookies are HttpOnly, SameSite=Lax, scoped to API paths, and Secure in production. The browser keeps short-lived access/CSRF credentials in memory for API and realtime use. Refresh credentials are never exposed to JavaScript.
- Refresh rotation detects reuse. Password changes/reset revoke all sessions; logout revokes the current session. MFA enrollment and workspace privileges retain their existing backend controls.
- Cookie-authenticated mutations require a session-bound CSRF header. Exact configured CORS origins are enforced. JSON validation rejects Mongo operator objects and unexpected fields; React escapes user-controlled text.
- Authentication has IP quotas, login has an account quota, and verification/reset delivery has per-account quotas. Unknown-account and wrong-password login errors share a response. Generic registration/recovery responses reduce account disclosure; no constant-time email-delivery guarantee is claimed.
- Reset links expire after 30 minutes; verification links expire after 24 hours. Both are single-use, random, stored as hashes and checked for expiry during consumption. Reset is transactional and revokes sessions.

Reference guidance: [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), and [Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Frontend URLs

| URL                       | Purpose                                             |
| ------------------------- | --------------------------------------------------- |
| `/login`                  | Email/password login; optional MFA or recovery code |
| `/register`               | Name, email, password and confirmation              |
| `/forgot-password`        | Request recovery email                              |
| `/reset-password#token=…` | Consume email reset link                            |
| `/verify-email#token=…`   | Confirm account email                               |
| `/auth/callback#ticket=…` | Existing Google OAuth completion                    |
| `/workspace`              | Authenticated workspace                             |
| `/profile`, `/settings`   | Authenticated profile and security settings         |
| `/invite#token=…`         | Existing invitation acceptance retained             |

Existing dashboard navigation, meetings, video, chat, action items and support remain in place.

## API endpoints

All paths below use the `/api/auth` prefix. Authenticated mutations sent with cookies also require `X-CSRF-Token`.

| Method and path                                                | Purpose                                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /register`                                               | Validate input, create an unverified account, send verification link; generic 202 on existing account |
| `POST /login`                                                  | Verify password, verified status and MFA, then issue a revocable session                              |
| `POST /verify-email`                                           | Consume a verification token                                                                          |
| `POST /resend-verification`                                    | Request another verification message if eligible and within quota                                     |
| `POST /forgot-password`                                        | Request a reset email if eligible and within quota                                                    |
| `POST /reset-password`                                         | Consume a reset token, replace hash and revoke sessions                                               |
| `GET /csrf`                                                    | Recover CSRF using the valid refresh cookie                                                           |
| `POST /refresh`                                                | Rotate refresh and CSRF credentials                                                                   |
| `POST /logout`                                                 | Revoke current session and clear cookies                                                              |
| `GET /me`                                                      | Read permitted profile fields                                                                         |
| `PATCH /me`                                                    | Update display name only                                                                              |
| `POST /change-password`                                        | Reauthenticate, change password and revoke all sessions                                               |
| `GET /sessions`                                                | List own active devices and current session ID                                                        |
| `DELETE /sessions/:sessionId`                                  | Revoke an owned session; other users' sessions are unaffected                                         |
| `POST /mfa/setup`, `/mfa/confirm`, `/mfa/disable`              | Existing authenticator lifecycle                                                                      |
| `GET /google`, `GET /google/callback`, `POST /google/complete` | Existing optional Google OAuth flow                                                                   |

## Setup and execution

1. Install the existing dependencies with `npm ci` in both `backend/` and `frontend/`. Node.js 24 is required by the backend.
2. For the Windows local test stack, run `npm run local:services` from `backend/`. It starts the API, worker, local MongoDB replica set, Redis, Mailpit, LiveKit and S3-compatible storage. Development data is retained. Use `npm run local:stop` to stop the runtime.
3. Run `npm run dev` from `frontend/`; open `http://localhost:5173/`. Captured test emails are at `http://localhost:8026/` and backend readiness at `http://localhost:4000/health/ready`.
4. For company environments, use the placeholder-only `backend/.env.example` and `frontend/.env.example`. Generate independent secrets with the existing setup workflow; do not use placeholder values. Configure `MONGODB_URI`, `REDIS_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `SMTP_URL`, `EMAIL_FROM`, `APP_URL`, `API_URL` and exact `CORS_ORIGINS`. The frontend requires no provider secrets.
5. Production requires HTTPS, valid SMTP, administrator MFA and the existing production configuration validations. Use a same-origin API reverse proxy or frontend/API hosts on the same site for the SameSite=Lax session design. Unrelated cross-site domains are not supported by this cookie configuration. Hosting must rewrite frontend routes to `index.html` while routing `/api` and realtime requests to the backend.

Production credentials, DNS, mail domain verification and deployment remain company-managed. Local captured SMTP is a real development delivery service; it is not production email delivery.

## Verification

Automated checks completed on 19 October 2026:

- Backend `npm run check`: typecheck, 80 tests across four files, and build passed. After the final frontend-only refinements, the 14 frontend logic/form tests were rerun and passed.
- Frontend `npm run lint` and `npm run build` passed. Lint retains five existing warnings (mixed Fast Refresh exports and effect/state patterns); Vite retains the large lazy-loaded LiveKit chunk warning.
- Secret scanning passed for backend sources/tests/scripts/docs and frontend sources/examples.
- `npm run test:auth-smoke` passed 12 checks against the restarted local API and real captured SMTP: registration/duplicate handling, unverified and incorrect login denial, email verification, cookie access, CSRF rejection, refresh rotation, profile/device identification, reset with session revocation, token reuse rejection, password replacement and logout. It creates only a synthetic `example.test` account and retains that local test data. Credentials and tokens are not printed.
- Regression coverage includes registration and concurrent duplicates, valid/incorrect login, protected access, logout and refresh invalidation, single-use/expired reset and verification tokens, absolute/JWT expiry, profile field restrictions, session ownership, password-change reauthentication, rate limits, cookie flags, failed mail delivery and existing workspace isolation.
- Frontend tests exercise in-memory credentials, bounded refresh/CSRF retries, concurrent restoration, cross-tab sign-out, network-failure behavior, confirmation fields, autocomplete and direct/missing-token recovery form rendering. These are Node-based logic/render tests, not browser layout tests.

Browser access to localhost was declined during this task. The current changes therefore still need live desktop/tablet/mobile interaction and visual checks, especially email-link completion, password-manager behavior, keyboard focus and multi-tab behavior in target browsers. No claim of a new live-browser pass or accessibility certification is made. Existing project screenshots predate this authentication change.

## Files changed for authentication

- `frontend/src/Auth.tsx`: route-aware forms, confirmation, link handling and notifications.
- `frontend/src/navigation.ts`: small History API integration without new routing dependencies.
- `frontend/src/App.tsx`: guarded entry, profile synchronization, expiry handling and visibility checks.
- `frontend/src/api.ts`: bounded credential recovery and cross-tab session clearing.
- `frontend/src/Pages.tsx`: profile synchronization, password changes and device sessions.
- `frontend/src/ui.tsx`, `frontend/src/WorkspacePolish.css`: disabled submission support and account/form styling.
- `backend/src/auth.ts`, `backend/src/lib.ts`: duplicate-race handling, normalized identifiers, safe mail failures and current-session identification.
- `backend/.env.example`: explicit issuer/audience defaults; all secrets remain placeholders.
- `backend/tests/backend.test.ts`, `backend/tests/frontend-api.test.ts`, `backend/tests/frontend-forms.test.tsx`: integration and frontend regressions.
- `backend/scripts/auth-smoke.mjs`, `backend/package.json`: repeatable live local authentication/SMTP check, available through `npm run test:auth-smoke`.
- This document: API, data model, setup, security and handover details.

Earlier UI changes, screenshots, README edits and the backend project document were preserved.

## Company release checklist

- Use HTTPS and Secure cookies; configure exact same-site frontend/API origins and the correct proxy hop count.
- Supply fresh managed secrets, least-privilege MongoDB/Redis access and working authenticated SMTP.
- Enforce administrator MFA and verify email/reset links use the final HTTPS app URL.
- Complete the live-browser checks above and review session/rate-limit behavior behind the company's proxy.
- Run both builds, the test suite and secret/dependency scans in CI; monitor failed login and mail-delivery events without logging credentials or link tokens.
