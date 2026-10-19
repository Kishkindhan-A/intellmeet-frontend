# Deployment audit — 2026-10-19

Target: https://intellmeet-frontend-rust.vercel.app
Story: public signup -> authentication API -> MongoDB -> account/session -> workspace.

## Evidence

| Boundary | Result |
| --- | --- |
| Landing page | Loads; one h1, image alt attributes present, no broken in-page anchors |
| Product preview | Meeting recap control changes the sample preview and pressed state |
| Responsive layout | No horizontal overflow at 1280 px or 390 px viewport width |
| Signup form | Labels and password-manager autocomplete attributes present |
| Deployed API | /health/ready returns HTTP 500 FUNCTION_INVOCATION_FAILED |
| Database from Vercel | Runtime logs show MongooseServerSelectionError / ReplicaSetNoPrimary |
| Network configuration | Owner confirms only the laptop IP was added to teammate's Atlas allowlist |

## Corrections

- Render public authentication forms without waiting for the session restore request.
- Replace the misleading local-services banner with a deployment-neutral service error.
- Offer a user-triggered account-settings retry after a failed request; registration
  remains disabled until the verification policy has loaded successfully.
- Reject successful HTML/invalid JSON API responses instead of passing null to callers.
- Show a safe message for a failed function and never automatically retry signup writes.

Validation: frontend production build passed; 98 tests passed, including two new API
failure regressions. Lint has no errors and five existing warnings. The existing lazy
meeting bundle still triggers the 500 kB size advisory.

## Remaining blockers and limits

The teammate's Atlas configuration must permit the deployed backend's outbound network.
The laptop's allowlist entry does not allow Vercel. Do not bypass TLS or authentication
to work around the network restriction.

Signup, email verification, authenticated workspaces, video, files and AI have not been
verified end-to-end on this deployment. Redis credentials are saved but the backend's
startup currently stops at MongoDB. SMTP credentials and actual delivery are unverified.
Public-page checks and passing tests are not evidence that those live flows work.
