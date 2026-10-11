# Policy preparation for IntellMeet

These are unpublished working drafts and content requirements. They describe the current backend where facts are known. Bracketed fields require the operator's actual decisions. Do not publish them as complete policies or claim compliance based on this file.

## Privacy notice — factual starting text

IntellMeet helps workspace members schedule meetings, communicate, and turn consented meeting content into transcripts, summaries and proposed tasks. The service operator is **[legal entity, registered address, privacy contact]**. Its role in relation to a workspace's meeting content is **[controller/processor responsibilities agreed with that customer]**.

The application stores account email and display name, password hashes when password login is used, verification state, optional Google identity, encrypted authenticator secrets, hashed recovery codes, sessions, and account preferences. Workspace data includes membership and roles, invitations, projects, tasks, meeting metadata, participation and connection records, chat, notes, uploaded audio, recordings, transcripts, summaries, support requests, and audit/job metadata. Session records can include a browser user-agent string. Rate-limit coordination uses IP addresses and account identifiers; deployment logging and network providers must be inventoried separately.

Server recording and AI processing require consent from everyone admitted to a standard meeting. Confidential meetings disable these server features. Withdrawing AI consent deletes the withdrawing participant's stored transcript and current meeting summary. It does not undo content already sent to a provider, downloads, previously accepted tasks, or copies made by other participants. Workspace meeting retention and authorized deletion jobs remove meeting artifacts from active application storage; backup retention, support requests, account data and operational metadata require separately documented retention policies.

Configured service providers can receive data needed to deliver their integration: SMTP for emails, Google for sign-in, LiveKit for media, S3-compatible storage for objects, and OpenAI for consented AI processing. Specify the actual provider entities, countries, subprocessors, contractual terms, retention and transfer arrangements before publishing. Workspace administrators have administrative access described in the product; do not describe an invitation-only meeting as hidden from workspace administrators.

Complete this notice with **[purposes and applicable lawful bases]**, **[retention periods by record type]**, **[rights/request procedure and identity checks]**, **[children/eligibility position]**, **[international transfers]**, **[complaint contact]**, and **[effective date/change notification]**. Verify every statement against deployed configuration and contracts.

## Cookie notice and preferences

| Cookie       | Purpose                                            | Path                        | Lifetime                                              | Safeguards                                                            |
| ------------ | -------------------------------------------------- | --------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `im_access`  | Authenticate API requests                          | `/api`                      | Configured access-token lifetime; default 600 seconds | HttpOnly, SameSite=Lax, Secure in production                          |
| `im_refresh` | Rotate access/session credentials                  | `/api/auth`                 | Configured session lifetime; default 7 days           | HttpOnly, SameSite=Lax, Secure in production; hashed value in storage |
| `im_oauth`   | Bind Google sign-in callback to browser initiation | `/api/auth/google/callback` | 10 minutes                                            | HttpOnly, SameSite=Lax, Secure in production                          |

The backend currently sets authentication cookies and does not install advertising or analytics cookies. Signed-in optional analytics and marketing preferences default to false. Updating them does not itself load tracking software or send data to analytics providers. The frontend must implement any anonymous choices, keep them consistent with signed-in settings, make withdrawal accessible, and gate nonessential scripts before they execute. Inventory future storage/SDK behavior and review applicable requirements before enabling them. Account preferences are not the recording/AI consent mechanism.

## Terms of service — decisions required

Prepare an agreement identifying **[contracting entity]**, **[eligible users and organizational authority]**, permitted use, account security responsibilities, workspace administrator powers, customer content ownership, the limited permissions needed to provide the service, acceptable use, integrations, suspension/termination procedures, export/deletion, service availability commitments if any, support, changes, applicable law, dispute process and appropriately reviewed limitations. Do not claim unlimited uptime, certified security, or error-free AI output.

There is no subscription billing or payment collection implemented. Add pricing, tax, payment timing, renewals, downgrade/cancellation, refund and dispute provisions only after those product and commercial decisions exist and their backend behavior is implemented.

## Refund and cancellation pages — conditional drafts

No paid subscription is currently implemented. Before accepting payments, define **[seller identity and contact]**, **[eligible purchases]**, **[refund window and exceptions]**, **[request process]**, **[processing timing]**, **[renewal notice]**, **[cancellation effective date]**, **[proration]**, **[access/export window]**, and **[data deletion timing]**. Confirm applicable consumer requirements with qualified review. Meeting cancellation is a scheduling action and must not be presented as subscription cancellation.

## Shipping and return/exchange pages

The current service is digital and does not ship physical goods. These pages are not applicable to this implementation. Reassess if the business starts selling equipment or other physical products; do not invent shipping or exchange operations.

## AI and service disclaimer — factual starting text

AI transcripts and summaries can contain mistakes or omit context. Review them before relying on them. Proposed actions require explicit acceptance before they become tasks. An evidence reference links a proposal to transcript material; it does not prove the proposal is correct. Connection-time analytics measure connection activity, not attention or employee productivity. Browser, network, device and integration availability affect media quality. Any contractual exclusions or limits need separate review.

## Accessibility statement — evidence required

No frontend accessibility audit has been completed. Publish a statement only after testing actual pages with keyboard navigation, visible focus, labels, error associations, zoom, contrast, screen readers, captions and usable meeting controls. Record **[standard/version and target]**, **[tested scope/date/method]**, **[known limitations]**, **[accommodation/contact route]**, and **[remediation plan]**. A WebVTT export endpoint alone does not establish live caption accessibility or compliance.

## DPA — drafting inputs

Identify the parties and controller/processor roles, processing subject and duration, instructions, data categories and subjects, confidentiality and access controls, actual technical/organizational measures, subprocessors and change process, approved processing regions, transfers, assistance with requests, incident reporting commitments, audit evidence, and return/deletion including backups. The customer content inventory above and `docs/SECURITY.md` are implementation inputs, not a signed DPA or a compliance attestation.

## Acceptable use — proposed product rules

Use only accounts and workspaces you are authorized to access. Obtain required permissions before uploading or recording other people's content. Respect meeting consent choices. Do not use the service for unlawful content, harassment, impersonation, spam, credential theft, malware, unauthorized surveillance, or attempts to bypass access and usage controls. Do not publish private meeting links, recordings, transcripts or participant information without permission. Report abuse to **[monitored abuse contact]**. The operator must define review, suspension, appeal and evidence-retention procedures before publication.

## Security policy — factual publication source

Use `docs/SECURITY.md` for implemented authentication, tenant authorization, upload, provider and deployment controls. Publish only controls verified in the running environment. Explicitly describe the difference between transport encryption and end-to-end encryption; confidential mode disables server processing but the browser/media encryption workflow still needs integration and verification. Do not claim SOC 2, ISO certification, a passed penetration test, or a tested recovery objective without evidence.

## Responsible disclosure — operator fields

Configure a monitored mailto address or HTTPS reporting form and a future expiry in `SECURITY_CONTACT` and `SECURITY_CONTACT_EXPIRES`. The backend then serves `/.well-known/security.txt`. Establish **[triage owner]**, **[scope]**, **[safe testing boundaries]**, **[acknowledgment target]**, **[coordinated disclosure process]**, and **[encryption option if offered]**. Ask reporters to include a concise reproduction, affected version/route, impact and redacted evidence. Do not solicit customer recordings or credentials. A security.txt file does not authorize penetration testing or establish a bounty.

## Community and workspace guidelines — proposed text

Treat participants respectfully. Keep discussions relevant to the workspace, respect confidentiality, and do not harass, impersonate or expose personal information. Follow host moderation and recording/AI consent choices. Report concerns through the workspace support process or **[operator abuse channel]** when an administrator is involved. Define escalation and appeals before presenting these guidelines as an enforced public policy.

## Publication completion

Assign a business/legal owner, replace every bracketed field, reconcile text with provider contracts and actual settings, review relevant legal obligations, add version/effective dates, and publish accessible frontend pages. Then test footer/account links and the relevant registration/consent flows. None of those publication steps is inferred from this draft's existence.
