# IntellMeet Atlas setup

Atlas setup completed through the owner's signed-in dashboard on 2026-10-19:

- Reused the owner's existing empty Free cluster, Cluster0; no paid upgrade applied.
- Created database intellmeet and its initial empty users collection.
- Created intellmeet_app with readWrite restricted to the intellmeet database.
- Confirmed the current client IP is already present in the Atlas IP access list.
- Generated a new application password through Atlas; credentials are not in Git.

Pending: save the new URI to the ignored backend/.env.vercel.production.local,
verify an authenticated application connection, configure production network access,
and import the URI into Vercel Production environment settings before redeploying.
Atlas Data Explorer successfully opened the empty collection; this does not establish
that the Node backend or the Vercel deployment can connect.

Preserve the separate existing database administrator user. Do not grant atlasAdmin
to the application account, disable TLS verification, or commit the connection string.
