# Live project sender and email OTP

## Current status

The latest user preference is email/password login without verification. The local runtime now sets `REQUIRE_EMAIL_VERIFICATION=false`, so neither a real sender nor OTP is needed for signup/login. The sender/OTP instructions below describe the optional verification mode and remain available for future use.

The user has chosen local test email for this project. Run `npm run local:services` to capture OTP messages in Mailpit at `http://localhost:8026/`; no real Gmail account is needed for this mode. The live-sender instructions below remain available for a future switch.

The code supports real SMTP delivery and six-digit email OTP verification. A project Gmail signup was started with the display name **IntellMeet Team**, but Google requires the account owner's birthday/gender, password, possible phone verification and terms acceptance. No Gmail address has been created or confirmed yet, and no live sender credentials are configured. Do not describe the captured development inbox as live external email.

The signup tab is left for the owner to finish. Do not invent account-owner information or send passwords/Google verification codes in chat.

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
