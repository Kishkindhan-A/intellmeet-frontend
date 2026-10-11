# Reporting security issues

Do not put credentials, personal data, or customer meeting content in public issues.

Production operators must configure a monitored reporting address or HTTPS form using `SECURITY_CONTACT`, together with `SECURITY_CONTACT_EXPIRES`. The deployment publishes that channel at `/.well-known/security.txt`. If no valid contact has been configured, the endpoint returns 404; a reporting address has not been invented for this repository.

Reports should identify the affected version and route, impact, reproduction steps, and minimal redacted evidence. The operator must establish triage ownership and disclosure terms before launch. This repository does not promise a bounty, response SLA, or permission to test third-party systems.

See [implemented controls and release checks](docs/SECURITY.md), [the local audit](docs/AUDIT-2026-10-10.md), and [policy preparation](docs/POLICY-DRAFTS.md).
