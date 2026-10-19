# Hosted Redis setup

Created an Upstash Redis database named intellmeet on 2026-10-19.

- Plan: Free; no payment method or paid upgrade selected.
- Primary region: AWS us-east-1 (N. Virginia).
- TLS enabled; application uses the authenticated rediss:// TCP URL.
- Eviction disabled to preserve BullMQ jobs and coordination data.
- Saved REDIS_URL as a Secret scoped to Vercel Production.
- Saved EMAIL_FROM as a Production Config variable for the chosen Gmail sender.

Credentials are intentionally absent from this document and Git. The private local
production file does not automatically sync from dashboard changes. Obtain its Redis
value from the provider console only if local cloud-service testing is needed.

Saving a variable does not change existing Vercel deployments; deploy again to apply
it. Verify /health/ready and /api/auth/config on the production domain. SMTP sender
configuration alone does not verify Gmail app-password authentication or delivery.
