# Resend verification-only testing

Without a verified domain, Resend permits `onboarding@resend.dev` to send to the email address associated with the Resend account. This setup uses SMTP over TLS on port 465. See https://resend.com/docs/send-with-smtp and https://resend.com/docs/knowledge-base/403-error-resend-dev-domain.

For the local service runner, populate the ignored `backend/.env.resend.local`:

```dotenv
RESEND_TEST_RECIPIENT=your-resend-account-email
RESEND_VERIFICATION_API_KEY=your-sending-key
```

Restart local services after saving. Only account-verification messages addressed to that exact recipient use Resend. Other recipients and other email types remain in Mailpit. Another user's token is never redirected to the account owner. Resend failures return a generic delivery error without silently falling back. Tests mock email delivery and send no external messages.

The frontend URL in verification emails remains localhost, so open those links on the machine running IntellMeet. For general user delivery, the company must configure a verified sending domain and its production email service.
