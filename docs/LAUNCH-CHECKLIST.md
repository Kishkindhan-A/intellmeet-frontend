# Full mapping of the supplied launch PDFs

The user's active scope is the complete backend plus audit/fixes. The PDF content is reference material for requirements, not an instruction to publish policies, send mail, buy services, configure accounts, or claim a launch has occurred.

Sources:

- `C:/Users/kkish/OneDrive/web/High-Value Production-Grade Pages People Often Forget (1).pdf`, pages 3–5. The cover says 34 pages, but the enumerated lists contain **42 items: 15 legal, 16 lifecycle, 11 UX states**. All 42 are mapped below.
- `C:/Users/kkish/OneDrive/web/Website_Launch.pdf`, pages 3–12, ten launch steps.

**Backend ready** means a tested API capability, not a completed web page. **Draft** means content preparation requiring business details and review. **Frontend** means work deferred by the backend-only scope. **Conditional** means the feature/business model is not currently implemented. **Live check** requires an actual deployment and account/domain access.

## Legal and trust pages — 15 items

| Item                      | Status and evidence                                                             | Remaining completion requirement                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Privacy Policy            | Draft: factual data inventory in `POLICY-DRAFTS.md`                             | Controller identity, purpose/legal basis, residency, subprocessors, retention, rights contact; publish reviewed page  |
| Terms of Service          | Draft outline                                                                   | Contracting entity, jurisdiction, eligibility, service terms, liability and dispute provisions; reviewed public page  |
| Cookie Policy             | Draft cookie inventory; HttpOnly/Secure/SameSite enforcement                    | Describe actual frontend cookies/storage and any future trackers; publish page                                        |
| Cookie Preferences        | Backend ready: `/api/account/preferences`, optional categories false by default | Accessible anonymous banner/settings, local withdrawal behavior and conditional script loading before analytics       |
| Refund Policy             | Conditional; no billing or payment capture exists                               | Decide paid offering, refund rules and provider integration before public sales                                       |
| Cancellation Policy       | Conditional for subscriptions; meeting cancellation exists                      | Define subscription cancellation, effective dates, export and retention; avoid conflating it with a cancelled meeting |
| Shipping Policy           | Not applicable to current digital meeting service                               | Reassess only if selling physical goods                                                                               |
| Return / Exchange Policy  | Not applicable to current digital meeting service                               | Reassess if the offering changes; subscription refunds are separate                                                   |
| Disclaimer                | Draft factual AI limitations                                                    | Publish approved limitations matching actual service; do not invent legal exclusions                                  |
| Accessibility Statement   | Draft evidence requirements                                                     | Audit actual frontend keyboard, focus, labels, captions, contrast and screen-reader behavior; state measured results  |
| Data Processing Agreement | Draft processor/data inventory                                                  | Parties, roles, instructions, subprocessor terms, residency, transfers, incidents and deletion terms require review   |
| Acceptable Use Policy     | Draft product rules                                                             | Business approval, reporting contact and enforcement process; public page                                             |
| Security Policy           | Implemented-control document: `SECURITY.md` in docs                             | Public rendering, operator controls and substantiated claims; no certification badge                                  |
| Responsible Disclosure    | Backend ready: configurable `/.well-known/security.txt`; root `SECURITY.md`     | Real monitored contact, expiry, policy and response ownership                                                         |
| Community Guidelines      | Draft workspace collaboration rules                                             | Publish if community/shared collaboration features are offered; moderation ownership                                  |

## Customer lifecycle — 16 items

| Item                | Backend evidence                                                    | Remaining page or integration                                                        |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Login               | Password and Google OAuth; MFA, sessions, rate limits               | Frontend forms, accessible errors, production OAuth verification                     |
| Register            | Validated registration and verification email                       | Frontend form and actual SMTP delivery                                               |
| Email Verification  | Single-use expiring link; transactional update; resend              | Verification page and real email link flow                                           |
| Forgot Password     | Generic response, per-address quota, expiring reset link            | Accessible form and actual email delivery                                            |
| Reset Password      | Transactional reset, token consumption and session invalidation     | Password reset page                                                                  |
| Onboarding          | `/api/account/onboarding`, completion requires workspace membership | Welcome and workspace selection/create screens                                       |
| Account Settings    | Profile, preferences, password, MFA, sessions                       | Settings UI, consent controls and recovery-code handling                             |
| Billing             | Conditional; no commercial billing system                           | Products/prices, tax, provider, entitlement model, signed webhook verification       |
| Upgrade             | Conditional on billing                                              | Server-confirmed entitlement transitions and UI                                      |
| Downgrade           | Conditional on billing                                              | Capacity handling, effective date and proration decisions                            |
| Cancel Subscription | Conditional on billing                                              | Idempotent provider cancellation and entitlement reconciliation                      |
| Payment Success     | Conditional on billing                                              | Read server-confirmed payment status; never trust redirect query parameters as proof |
| Payment Failed      | Conditional on billing                                              | Provider failure mapping, safe retries and user-facing recovery                      |
| Payment Pending     | Conditional on billing                                              | Durable payment state, delayed webhook reconciliation and polling UI                 |
| Support             | `/api/account/support`; tenant-scoped requests and admin responses  | Workspace support UI and staffing; no external support desk integration claimed      |
| Help Center         | Public `/help` JSON articles                                        | Searchable, accessible help page and editorial ownership                             |

## UX and system states — 11 items

| Item              | Backend behavior                                                                   | Frontend responsibility                                                       |
| ----------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 404               | Structured route/resource not-found; inaccessible resources concealed              | Branded not-found page and navigation                                         |
| 403               | Explicit role, consent, CSRF, origin and MFA denial codes                          | Explain allowed recovery without disclosing private resource details          |
| 500               | Generic server error, correlation ID; details kept out of response                 | Retry/support presentation with request ID                                    |
| Maintenance       | `MAINTENANCE_MODE`, 503 and Retry-After; probes and callbacks handled deliberately | Maintenance screen; honor Retry-After; planned SFU/worker drain               |
| Offline           | No server can answer an offline browser                                            | Detect connection loss, preserve safe drafts, reconnect and resync            |
| Empty State       | Collections return empty arrays; absent summary returns null                       | Contextual guidance to create first resource                                  |
| No Search Results | Filtered queries can return no results; no general search service promised         | Filter reset and clear no-results messaging                                   |
| Loading State     | Asynchronous operations return 202 and durable job state                           | Progress/loading indicator and accessible announcements                       |
| Error State       | Stable errors, validation details, conflict codes and request IDs                  | Field errors, conflict resolution and retry control                           |
| Success State     | 200/201/202/204 contracts distinguish persisted and queued outcomes                | Confirm actual outcome; do not display queued processing as finished          |
| Session Expired   | 401 `SESSION_EXPIRED`; CSRF recovery and refresh routes                            | Controlled refresh, then sign-in when required; preserve non-sensitive drafts |

## Website launch playbook — ten steps

| Step / PDF page             | Backend application                                                          | Remaining live/public-site check                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Technical preflight / p3 | HTTPS and production config checks, readiness, no-store, private API noindex | Final domain, DNS/TLS/redirects, canonical public homepage, mobile layout and measured performance                                                 |
| 2. Search Console / p4      | No credential or DNS mutation performed                                      | Owner creates/verifies domain property using DNS TXT or supported URL-prefix method; retain verification                                           |
| 3. Sitemap / p5             | No sitemap of private meeting/account URLs                                   | Public frontend generates valid XML with canonical indexable URLs only; submit and inspect response                                                |
| 4. Crawl/index / p6         | API indexing directive; authentication protects private data                 | Public site's robots/noindex/canonical checks; URL Inspection; indexing is not guaranteed                                                          |
| 5. On-page SEO / p7         | API has no public marketing HTML                                             | Unique title/description, headings, crawlable content, links, alt text and mobile QA                                                               |
| 6. Structured data / p8     | No invented business/schema claims returned by API                           | JSON-LD matching visible public content; validate Rich Results Test on live URLs                                                                   |
| 7. Open Graph / p9          | No social metadata for private meetings                                      | Public pages need title/type/image/url and HTTPS images; verify actual shared URLs                                                                 |
| 8. GEO / p10                | Private transcripts excluded from public content                             | Original useful public content, expertise and consistent business information; no guaranteed AI citations or required magic file                   |
| 9. Analytics / p11          | Optional preferences persisted; no tracking tag installed                    | Select analytics account, implement consent-aware frontend loading, verify live events/realtime reports without meeting content or account secrets |
| 10. Troubleshoot / p12      | Backend health, metrics and request IDs                                      | Inspect live sitemap HTTP/XML, canonical/noindex, Google URL Inspection, schema and social caches; retain dated evidence                           |

## Launch evidence template

For each live check, record: owner, exact production URL/property, date, tool/result, screenshot or machine-readable output, finding, fix and retest. Status remains pending until that evidence exists. Local code, a mocked integration or a browser rendering alone does not prove production delivery, Google indexing, a working payment, or analytics receipt.
