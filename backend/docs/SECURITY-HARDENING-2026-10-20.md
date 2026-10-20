# Security hardening review — 20 October 2026

## Scope and findings

Reviewed the MERN API, browser application, Socket.IO authorization, upload checks, AI boundaries, dependency advisories, production response headers, and repository automation. This is a scoped engineering review, not a penetration-test certification or a guarantee against every attack.

The live API already used Helmet and no-store responses. The live frontend login and landing responses lacked CSP, clickjacking, MIME-sniffing, referrer and feature-permission protections. The repository had no root `.github/workflows` security checks.

## Changes

- Public Vercel headers now cover frontend pages: CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, feature Permissions Policy, and COOP `same-origin-allow-popups`. Vercel already supplies HSTS. Workspace responses are no-store, and the worker script revalidates.
- CSP permits local scripts without inline script/eval permission, blocks framing/objects, restricts form targets and base URLs, allows local fonts/images and blob media/workers, and permits LiveKit Cloud and AWS storage network endpoints. Inline styles remain necessary for the current React/LiveKit UI. Vercel websocket subdomains support the project and preview hostnames. Revisit these vendor allowlists if providers change; custom storage domains need explicit additions.
- Backend framing is denied. API Fetch Metadata checks reject cross-site requests without an explicitly approved Origin; this supplements existing CSRF tokens and exact CORS origin checks. Browser metadata is not treated as authentication, and non-browser API clients remain supported.
- Nonempty API mutation bodies require application/json. The shared request quota runs before JSON parsing and returns Retry-After on 429. Signed raw webhook handling stays separate.
- Root GitHub Actions run production/development advisory audits, expanded secret scanning, typechecks, tests and builds on pushes, pull requests and weekly. Action revisions are pinned to reviewed upstream commits; permissions are minimal. CodeQL security-extended scans are configured for public repositories. Dependabot covers both npm applications and workflow actions.
- Added a reproducible limited deployment smoke script: `node backend/scripts/security-smoke.mjs https://intellmeet-frontend-rust.vercel.app`.

## Existing controls reviewed

Argon2id password hashes; secure HttpOnly SameSite session cookies in production; short-lived JWTs with issuer/audience/algorithm checks; server-side session revocation and security versions; CSRF checks; email OTP and one-time links; MFA enrollment reauthentication and replay protection; administrator MFA requirement in production config; strict Zod schemas and UUID resource validation; membership/host/admission checks; Socket.IO authentication and event quotas; signed webhook verification; upload size/type/signature checks and short-lived signed URLs; AES-GCM protection for stored secrets; untrusted-transcript AI instructions, structured output and evidence validation; no automatic AI tool execution; generic server errors and credential-redacted request logs.

## Validation

- Full backend check: 122 tests passed, TypeScript check and backend build passed.
- Frontend production build passed. Existing meeting bundle advisory remains.
- Both full dependency audits (including development dependencies): zero known advisories at review time.
- Expanded secret scan passed for backend, frontend, deployment configuration and workflows. This scans selected working-tree files, not all Git history or third-party cloud accounts.
- Added regressions for Fetch Metadata, approved-origin compatibility, JSON-only mutations, rate limiting before parsing, framing denial and private API responses.
- Deployment smoke and browser rendering are checked after publishing; see task completion results for live outcomes.

## Remaining operator work / limits

- Vercel firewall API returned 403 for this team's scope. No CLI credentials were available. Custom WAF/bot rules were not inspected or changed; this review does not claim they are enabled. Vercel documents automatic platform DDoS mitigation, which is separate from custom WAF policy.
- Atlas broad test-network access was previously authorized until 26 October 2026, 15:26:37 UTC (20:56:37 IST). This review does not extend it. Production needs a deliberate network design with restricted stable egress/private access as appropriate.
- Rotate credentials previously shared in chat or otherwise exposed. Configure a monitored security reporting contact; this review does not invent a mailbox or SLA.
- Verify backup restore, monitoring/alert ownership, retention/legal policy, account recovery, hardware/media behavior, storage provider controls and incident response with the production operators. These cannot be established by adding npm packages.
- GitHub security workflows must actually run successfully before claiming continuous scanning is operational. Repository settings such as branch protection and private vulnerability reporting are separate from workflow source configuration.
- No production flooding, brute force, destructive tests, third-party target scans, or paid security service enrollments were performed.

## Primary research

- [OWASP HTTP headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)
- [OWASP CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [OWASP Node.js security](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
- [OWASP CSRF and Fetch Metadata](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [CISA Secure by Design](https://www.cisa.gov/news-events/alerts/2025/01/17/cisa-and-fbi-release-updated-guidance-product-security-bad-practices)
- [GitHub CodeQL](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-code-scanning)
- [GitHub workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Vercel Services routing configuration](https://vercel.com/docs/services)
- [Vercel firewall](https://vercel.com/docs/vercel-firewall)
- [LiveKit connection/firewall requirements](https://docs.livekit.io/deploy/admin/firewall/)
