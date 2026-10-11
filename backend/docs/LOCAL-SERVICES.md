# Local service setup

This Windows setup runs development services on loopback addresses. It uses its own MongoDB database and credentials and does not use the team's MongoDB URI or cloud credentials from `.env`.

Run `powershell -NoProfile -File scripts/setup-local.ps1` once to download checksum-pinned official LiveKit, SeaweedFS and Mailpit releases and the development Redis build. Run `npm run local:services` to build and start the API, worker, MongoDB replica set, Redis, LiveKit, SeaweedFS S3 and Mailpit. Run `npm run test:local-services` to check the services.

| Service              | Address                            |
| -------------------- | ---------------------------------- |
| API readiness        | http://localhost:4000/health/ready |
| Captured email inbox | http://localhost:8026              |
| Redis                | 127.0.0.1:6380                     |
| Local MongoDB        | 127.0.0.1:27018                    |
| LiveKit signaling    | ws://127.0.0.1:7880                |
| S3 storage           | http://127.0.0.1:9000              |

Generated local service credentials and configurations are kept under ignored `.data/local-run/`. Do not commit or share them. The runner supplies them directly to the API and worker. S3 requires authentication; SMTP captures messages locally without external delivery. Services and logs remain under this workspace; no Windows system service is installed.

The service check verifies API readiness, authenticated Redis and worker heartbeat, LiveKit room creation and signed participant tokens, S3 presigned upload/download and conditional object sealing, anonymous S3 rejection, and SMTP delivery to the local inbox. It retains test files and captured email. It does not verify browser WebRTC media exchange. LiveKit recording requires a separate Linux egress service and is not configured here. OpenAI and Google OAuth remain disabled; real provider credentials are needed to test them.

`npm run local:start` continues to run the original isolated audit environment with media and storage disabled. Stop either runtime with `npm run local:stop`; stopping retains data. The user's instruction is to keep this setup until they say **remove deploy**. That phrase should trigger a review of the local setup for removal; do not delete the team's database or company resources.

The company still owns production credentials and deployment. These loopback settings are for development, not a production deployment.
