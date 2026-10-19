# IntellMeet Atlas setup

Atlas setup completed through the owner's signed-in dashboard on 2026-10-19:

- Reused the owner's existing empty Free cluster, Cluster0; no paid upgrade applied.
- Created database intellmeet and its initial empty users collection.
- Created intellmeet_app with readWrite restricted to the intellmeet database.
- Confirmed the current client IP is already present in the Atlas IP access list.
- Generated a new application password through Atlas; credentials are not in Git.

Production follow-up on 2026-10-19: replaced Vercel's MONGODB_URI Secret with the
owner's Cluster0/intellmeet connection using intellmeet_app, then redeployed.
The production /health/ready check returned 200 with status ready, verifying MongoDB
and Redis readiness. /api/auth/config returned 200; unauthenticated /api/auth/me and
an invalid login returned 401 as expected. The signup form loads its policy and enables
submission without an outage banner.

At the owner's explicit request, the test network rule 0.0.0.0/0 expires automatically
at 2026-10-26T15:26:37Z (26 October, 8:56 p.m. IST). It permits connection attempts
from all IPv4 addresses; TLS, authentication and the database-scoped role still apply.
The existing laptop IP rule remains. This is an expiring deployment-test configuration.

The ignored local production file is separate from Vercel's secret settings and is not
automatically synchronized. Credentials are never committed to Git.

A single controlled audit registration reached the application but returned 503
MAIL_UNAVAILABLE. The audit account is unverified; successful email delivery and
verified sign-in remain pending SMTP correction. Do not treat readiness as full signup
verification or disable verification to hide the delivery failure.

Preserve the separate existing database administrator user. Do not grant atlasAdmin
to the application account, disable TLS verification, or commit the connection string.
