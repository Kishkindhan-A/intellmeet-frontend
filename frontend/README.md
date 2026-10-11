# IntellMeet frontend

React, TypeScript, Vite, LiveKit, and Socket.IO client application. Uses the existing backend APIs with HttpOnly cookies, memory-only access/CSRF tokens, and serialized refresh using Web Locks.

## Run locally

From `backend/`, run `npm run local:services`. From `frontend/`, run `npm ci` and `npm run dev`. Open http://localhost:5173. The development proxy forwards `/api` and `/socket.io` to port 4000. New accounts must verify email through the local Mailpit inbox at http://localhost:8026 before signing in.

`npm run build` checks TypeScript and builds static assets. `npm run lint` runs Oxlint. `npm audit --audit-level=high` checks known dependency vulnerabilities.

The UI includes registration, verification, sign-in and password reset, workspace creation and switching, dashboard counts from stored data, meeting scheduling and host start/end, explicit participant consent, waiting-room admission, camera/microphone/screen-sharing controls, persistent chat, versioned shared notes, meeting recap/transcript/asset views, action-item creation and status updates, team invitations, MFA enrollment, workspace settings, notifications, and support submission.

## Configuration and limits

Only browser-safe public URLs may go in `.env`. Set `VITE_API_URL` and `VITE_SOCKET_URL` for a production API, or reverse-proxy them on the application origin. Never place OpenAI, LiveKit, storage, email, MongoDB, or Redis secrets in the frontend. Company deployment must serve HTTPS, support SPA fallback for email/OAuth paths, proxy WebSockets, and configure backend `APP_URL`, `API_URL`, and CORS for the actual origins.

The local backend uses an isolated local database. Team MongoDB configuration remains saved in `backend/.env`. OpenAI/Google OAuth and recording egress are not configured in the local services. AI is never simulated. A recap remains empty until actual processing produces stored output. The media bundle loads only when a meeting is opened.

Current lists show up to 100 meetings/tasks and 30 recent messages. There is no automatic microphone capture/transcription loop, recording control, advanced moderation, project editor, or full administration console in this first frontend. Do not treat it as an independently audited production release. Check actual browser audio/video/screen-share exchange, production provider integrations, accessibility, tenant isolation, and cross-tab refresh behavior before launch.

The local frontend verification account and workspace are synthetic test data, retained under the user's instruction to keep local tests until they request removal. Never reuse the test account for real work.
