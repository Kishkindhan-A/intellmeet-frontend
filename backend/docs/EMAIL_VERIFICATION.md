# Automatic email verification

Implemented 19 October 2026 in the existing React/Vite, Express, MongoDB and Nodemailer system. No new backend, user collection, dependencies, or destructive database migration were introduced.

The later [live sender and OTP update](LIVE_EMAIL_OTP.md) adds a six-digit, ten-minute OTP as the primary registration flow and preserves links as a compatibility fallback. It also provides an explicit live SMTP runtime mode and a no-email mode while the real sender is pending. The link-flow details and test totals below describe the preceding version.

## What happens

1. `POST /api/auth/register` validates name, normalized email and password, creates the account with the existing `verified: false` field, and automatically sends to that account's email address.
2. A cryptographically random 256-bit token is generated for that account. Only its SHA-256 hash, account ID, kind and 24-hour expiry are stored in `OneTimeTokens`. The token is not included in API responses or logs.
3. A branded HTML email and a plain-text alternative are sent through the configured SMTP service. The email includes a welcome message, IntellMeet branding, a Verify Email Address button, expiry notice, fallback URL and instructions for unsolicited emails. User names and link attributes are HTML-escaped.
4. The link uses `APP_URL` and `/verify-email#token=…`. The page automatically attempts validation once per mount, including React StrictMode replay, and provides an explicit retry. The fragment is removed after initialization and held only in component memory.
5. `POST /api/auth/verify-email` validates the hash, expiry and token kind, then transactionally verifies only the token's account and consumes its outstanding verification links. Client-supplied account IDs are rejected.
6. The login page shows a verification-success message. Password login remains blocked with `EMAIL_UNVERIFIED` until the server-side account flag is true.

Invalid, expired and previously consumed links use a safe explanatory error. The verification page has a return-to-login action and a resend form with the account email. Signup and login also offer resend. Registration and resend responses remain generic to avoid disclosing whether another email has an account.

## Resend and failures

`POST /api/auth/resend-verification` accepts `{ email }`. It looks up the unverified account and sends to the address stored on that account. It never sends another user's token to a personal or administrative inbox.

- Verification sending is limited to three requests per address per hour, alongside the existing authentication IP quota. The UI also waits 30 seconds before another resend. Server limits remain authoritative when the UI is bypassed.
- A fresh token replaces older verification links only after SMTP accepts the new message. Delivery failure removes the newly created token, preserves the older working link and returns a safe `503 MAIL_UNAVAILABLE` error.
- Verification and resend use the same per-account Redis lock, preventing a verify/resend race. Concurrent operations can receive `409 BUSY` and should retry shortly.
- Already verified or unknown addresses get the same generic resend response and no message. Existing verified accounts remain verified; existing unverified accounts are never automatically upgraded.
- SMTP acceptance confirms the sending server accepted the recipient/message. It does not guarantee final inbox placement; production delivery and bounce monitoring belong to the sender's service.

## Sender configuration

All recipients now use one SMTP sender configured with `SMTP_URL` and `EMAIL_FROM`. No recipient override, personal-email forwarding, or API-key-specific fallback remains. The former `RESEND_TEST_RECIPIENT`, `RESEND_VERIFICATION_API_KEY` and `.env.resend.local` route is retired; existing ignored local files were preserved but are unused.

Recipients may use Gmail, Outlook, Yahoo or company domains; they do not supply their mailbox credentials. The sender is configured once by the company. Provider quotas, sender-domain policy, mailbox validity and spam filtering still apply.

Required backend environment values are documented with placeholders in `.env.example`:

```dotenv
APP_URL=https://meet.example.com
API_URL=https://api.example.com
CORS_ORIGINS=https://meet.example.com
EMAIL_FROM=IntellMeet <no-reply@example.com>
SMTP_URL=smtps://YOUR_SMTP_USERNAME:YOUR_URL_ENCODED_SMTP_PASSWORD@smtp.example.com:465
```

Production transport requires TLS and certificate validation, disables transport debug logging, and has bounded connection/read timeouts. Configure the permitted sender address and any required SPF/DKIM/DMARC/domain verification with the email provider. Do not put SMTP credentials in frontend variables or commit them.

For an eligible Gmail sender, enable 2-Step Verification, create a Google App Password and use an encoded SMTP URL, for example:

```dotenv
SMTP_URL=smtps://YOUR_SENDER%40gmail.com:YOUR_URL_ENCODED_APP_PASSWORD@smtp.gmail.com:465
EMAIL_FROM=IntellMeet <YOUR_SENDER@gmail.com>
```

Use an App Password where Google permits it, never a normal Google password. Organization policy or Advanced Protection may prevent App Passwords; use the company's approved SMTP provider in that case. Encode username/password URL characters before storing them. Never ask recipients for their passwords. See [Google App Password guidance](https://support.google.com/accounts/answer/185833) and [Nodemailer SMTP configuration](https://nodemailer.com/smtp).

Production SMTP credentials and deployment remain company-managed. Without a configured sender, the code returns a delivery/configuration error rather than claiming email was sent. The local runtime deliberately uses captured SMTP, not real external inbox delivery.

## Database and compatibility

The existing `User.verified`, unique normalized-email index and hashed `OneTimeTokens` storage are reused. No new migration or user backfill is needed. A MongoDB replica set or Atlas is required for transactions; Redis is required for quotas and coordination. Existing links remain valid until consumed, expired, or replaced by a successful resend. User data and existing accounts are retained.

## Run and test

1. Run `npm run local:services` from `backend/`, and `npm run dev` from `frontend/`.
2. Open `http://localhost:5173/register`, register two different test addresses, and inspect `http://localhost:8026/`. Both messages should have their own To address and different branded verification links. The local inbox captures messages for test recipients instead of sending them externally.
3. Attempt login before verification: it must fail. Open one account's link: the page should verify it and return to login. That account can now sign in; the other remains unverified.
4. On the other account, use Resend verification email. The newest accepted link should work; the older link and token reuse should fail. Check spam filtering and actual recipient delivery separately using the company SMTP service after configuration.
5. Run `npm run check` from `backend/` for automated tests/typecheck/build; run `npm run lint` and `npm run build` from `frontend/`.
6. Run `npm run test:auth-smoke` from `backend/` for real local API/captured-SMTP checks with two synthetic `example.test` recipients. Test accounts/messages are retained and credentials/tokens are not printed.

Automated coverage includes recipient routing across provider-address formats, distinct and hashed tokens, correct-account verification, reused/expired links, unverified-login denial, resends, quotas, concurrent verify/resend, failure preservation/retry, HTML escaping, missing SMTP, TLS settings and the existing authentication/workspace regressions. The final test run passed 89 tests. Both builds pass; five existing frontend lint warnings and the existing LiveKit bundle warning remain.

The restarted local runtime also passed all 14 live API/captured-SMTP smoke checks, including two distinct HTML verification messages, recipient separation, resend replacement, token reuse rejection and verifying only the intended account.

Live browser access was previously declined and was not retried. Automatic verification and resend controls are implemented and form rendering is tested, but this change has no fresh live-browser visual/interaction pass or email-client rendering certification. Real Gmail/Outlook/Yahoo inbox delivery cannot be claimed before company SMTP configuration and delivery checks.

## Files

- `src/emails.ts`: branded HTML/plain-text verification template.
- `src/mailer.ts`, `src/ports.ts`: recipient-specific SMTP delivery, acceptance checks and HTML support.
- `src/auth.ts`: coordinated resend replacement, verification consumption and failure handling.
- `src/config.ts`, `.env.example`, `scripts/local-runtime.mjs`: uniform SMTP configuration and removal of the old personal-only route.
- `../frontend/src/Auth.tsx`: automatic link validation, retry/resend forms and resend delay.
- `tests/mailer.test.ts`, `tests/backend.test.ts`, `tests/frontend-forms.test.tsx`, `scripts/auth-smoke.mjs`: regression and local delivery checks.
- This document and `docs/resend-verification.md`: current setup and retired-route notice.
