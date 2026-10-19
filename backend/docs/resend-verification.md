# Retired personal-recipient test route

The former account-owner-only Resend route was removed on 19 October 2026. All users now receive their own verification message through the configured `SMTP_URL` sender. No recipient is redirected to the account owner, and sender choice no longer depends on the recipient address.

`RESEND_TEST_RECIPIENT`, `RESEND_VERIFICATION_API_KEY` and `.env.resend.local` are no longer read. Existing ignored files were retained and are unused. Do not follow the previous setup instructions for these settings.

Use [EMAIL_VERIFICATION.md](EMAIL_VERIFICATION.md) for current SMTP configuration and testing. A Resend account can still be used as a standard SMTP sender with an appropriately verified sending domain and credentials supplied by the company; it is not a special personal-email route.
