# Security reporting

Do not post credentials, customer information, or private meeting content in public issues.

Operators must configure a monitored `SECURITY_CONTACT` and `SECURITY_CONTACT_EXPIRES` to publish a reporting channel at `/.well-known/security.txt`. Until that is configured, use GitHub private vulnerability reporting if the repository owner has enabled it. Do not assume a reporting inbox exists.

See [security controls](backend/docs/SECURITY.md) and [current hardening review](backend/docs/SECURITY-HARDENING-2026-10-20.md). No bounty or response SLA is promised.
