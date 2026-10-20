# Live project sender and email OTP

## Current status (20 October 2026)

Production uses `REQUIRE_EMAIL_VERIFICATION=true` with the real sender `meetintell@gmail.com`. The default and production environment preparation template also require verification. The local services runner can explicitly use test-email mode; captured local mail is not proof of external delivery.

A controlled signup on the Vercel deployment delivered a verification message to an alias of the connected owner inbox. Gmail placed it in Spam, although the received message showed SPF, DKIM and DMARC passing. SMTP acceptance and inbox placement are distinct; inbox placement is not guaranteed by this test.

The deployed browser rejected sign-in before confirmation, accepted the delivered single-use verification link, rejected link reuse, and allowed sign-in afterward. The Gmail connector withholds OTP text, so this live check used the provided verification link. Six-digit OTP ownership, expiry, attempt limits, resend replacement and replay rejection are covered by automated tests, not claimed as a live OTP-entry test.

The suite passes 102 tests, including allowlisted SMTP diagnostic categories. Diagnostic logs never include provider messages, passwords, OTPs or recipient addresses. The SMTP secret stays in Vercel.

Existing unverified users must confirm their email before signing in. Login routes them to the verification page, where they can request a fresh code. No account was marked verified directly in MongoDB.

## After the Gmail account is created

1. Finish the provider's private setup in the open Google signup tab and record the resulting mailbox address.
2. Enable 2-Step Verification. If the account is eligible, the owner must create a Google App Password for the SMTP sender. A normal Gmail password is not appropriate. Google may restrict App Password availability; the company's approved transactional SMTP service can be used instead.
3. Put the sender configuration directly in ignored `backend/.env.mail.local`, without posting credentials in chat:

```dotenv
SMTP_URL=smtps://YOUR_SENDER%40gmail.com:YOUR_URL_ENCODED_APP_PASSWORD@smtp.gmail.com:465
EMAIL_FROM=IntellMeet <YOUR_SENDER@gmail.com>
```

Only examples are shown above. Username/password URL characters must be encoded. The real file starts blank, is ignored by Git, and is never printed by the runtime.

4. Stop the local runtime with `npm run local:stop`, then start `npm run local:live-email` from `backend/`. This mode requires a non-local authenticated `smtps://` sender. It fails when configuration is missing and does not start or fall back to Mailpit. API, MongoDB, Redis, video and storage can still run locally.
5. Register a real recipient address on the website. The recipient should receive the project sender's email, enter its OTP on `/verify-email`, and then sign in. Test actual inbox/spam placement with the sender configured; SMTP acceptance alone is not a guarantee of final delivery.

While the provider account is pending, `npm run local:await-email` keeps the backend and local dependencies available with outgoing email disabled. New verification sends return a delivery error rather than being silently captured. Existing verified users can still sign in. `npm run local:services` remains a separate development test mode; it is not real inbox delivery.

See [Google App Password requirements](https://support.google.com/accounts/answer/185833) and [SMTP configuration](https://nodemailer.com/smtp).

## OTP implementation

- Registration automatically sends a cryptographically random six-digit code to the registered address. The frontend opens the verification form, retaining only the email in browser history state; passwords are cleared.
- `POST /api/auth/verify-email-otp` accepts `{ email, code }`. Codes expire after ten minutes, allow five attempts, and are consumed once. Unknown/verified accounts and incorrect/expired codes return the same safe error.
- Each code is stored as an HMAC-SHA-256 digest scoped to the account using the server secret. A database-only attacker cannot simply hash all one million possible codes without that secret.
- Per-account attempt counters, existing send quotas and authentication IP quotas apply. Resending replaces the previous code after successful SMTP acceptance. Failed sending preserves the previous working challenge. Per-account locks serialize resend, link and OTP consumption.
- Successful OTP verification marks the account verified transactionally and removes both its code and fallback-link records. Existing secure verification links remain a compatibility fallback in the email and are invalidated after OTP use.
- The existing token collection gains the additive `verify-otp` kind and `attempts` field. Existing users/data are preserved; unverified accounts are not automatically upgraded. No destructive migration is needed.

## Checks

The updated suite passes 94 tests, including correct-account OTP verification, keyed hashes, ten-minute expiry, five-attempt exhaustion, malformed/reused codes, resend replacement, fallback-link consumption and existing authentication/security regressions. Both application builds pass; five existing frontend lint warnings and the large LiveKit chunk warning remain.

`npm run test:auth-smoke` exercises only the explicitly captured test mode and refuses to send synthetic recipients through live SMTP. It checks real local SMTP transport and OTP consumption, not external Gmail delivery. Live account creation and external-inbox verification remain pending the owner's provider setup. Browser interaction with the project was previously declined; this change has no fresh live-browser pass.

Changed files include `src/auth.ts`, `src/db.ts`, `src/emails.ts`, `src/openapi.ts`, `../frontend/src/Auth.tsx`, `scripts/local-runtime.mjs`, `scripts/auth-smoke.mjs`, `package.json`, and associated tests. The live sender file is excluded from Git.
