# Production website audit — 20 October 2026

Target: https://intellmeet-frontend-rust.vercel.app

Audit work used isolated accounts, workspaces, meetings, messages, tasks and notes. Camera and microphone stayed off. Meetings used confidential mode; recording and AI were disabled. No invitation or email was sent to another person.

## Verified in the deployed browser

- Registration and password sign-in without email OTP; authenticated session restoration after reload.
- Workspace creation and navigation.
- Task creation, self-assignment, status change to Done, and workspace search.
- Profile update, team list, account session listing, notifications screen, help page and support submission to the audit-only workspace.
- Meeting creation, assigned-host start, admission, meeting history, filters, participants, recap and meeting end.
- Chat message persisted and appeared in the meeting.
- Shared-note persistence on an ended meeting and live-note editing.
- LiveKit media-token issuance; WebRTC attempted signaling but the in-app browser rejected RTCPeerConnection.setConfiguration. Full audio/video remains unverified in Chrome/Edge or with multiple participants.

## Bugs fixed

1. Socket.io default trailing slash routed the upgrade to the frontend HTML fallback. Client and server now use addTrailingSlash=false. Live upgrade test returned a valid Engine.IO opening packet; the authenticated browser no longer showed the polling fallback warning.
2. Slow requests exposed raw browser timeout errors. The request deadline is now 45 seconds, failures use readable typed errors, and mutations are never automatically retried on network timeout. The message warns users to check whether a change was saved before retrying.
3. Invitation emails linked to /invitations/accept instead of the frontend /invite route. Corrected and covered by an assertion in the invitation acceptance test. Live external email delivery is not verified.
4. Team names stayed stale after a successful profile update. The current user's member record now updates with the profile response.
5. The shared-note unsaved warning persisted after a successful save. It now clears when the persisted revision is loaded.
6. Cold starts performed collection index setup serially. Independent collections now initialize concurrently; all index results are awaited and any failure still prevents startup.

7. Notes could be edited before their first persisted revision arrived, causing a first-save conflict. Editing now waits for that revision, and the editor is disabled while a save is in flight.

## Automated validation

101 backend, frontend API-client and security regression tests passed. Backend type checking/build and frontend production build passed. Frontend lint has no errors, with five existing warnings. Production dependency audits reported zero known vulnerabilities for both packages. Secret scanning passed. The lazy meeting bundle still exceeds Vite's 500 kB advisory threshold.

## Explicit limits

- Administrator actions still require MFA in production. This was preserved. Interactive MFA enrollment/password replacement was not performed.
- Live email receipt, invitation delivery, password-reset email, OpenAI summaries/transcription, storage uploads, recording/egress and multi-participant media were not verified. These require working provider credentials, consent and suitable browser/devices; mocked automated tests are not evidence of live provider operation.
- The earlier temporary Atlas access rule remains time limited; this audit did not extend it.
- Do not interpret this audit as a complete penetration test or a guarantee that every possible input, role and browser combination has been exercised.
