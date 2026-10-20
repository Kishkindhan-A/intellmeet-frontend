# Browser integration

## Delivered

- Browser Back/Forward, meaningful workspace URLs, meeting/workspace deep links, tab titles, native navigation links, and safe return-to-page after sign-in.
- Keyboard shortcuts and shortcut guide; typing, dialogs, and meetings preserve their controls.
- Per-device reduced motion and compact spacing, automatic preference saving, reset, and cross-tab preference synchronization.
- Installable app manifest with PNG icons, standalone display, Meetings/Action items app shortcuts, optional native install prompt, and browser-specific installation guidance.
- Offline banner plus a public offline navigation fallback. Only `/offline.html` is cached. APIs, app HTML, credentials, and meeting content are never stored by the worker. No offline writes or automatic mutation replay.
- Camera/microphone permission diagnostics and an explicit device-test button. Test streams stop immediately after success; no recording or upload.
- Explicit opt-in desktop alerts for new unread workspace notifications while an authenticated tab remains open. Polls once per minute. Existing notifications do not trigger an initial burst. Alert content is generic, and permission failures are nonfatal. These are not closed-app Web Push notifications.
- Native sharing where supported, clipboard fallback with failure guidance, fullscreen with rejection handling, and print controls/styles. Link sharing includes only workspace and meeting query parameters, never invitation/reset tokens.
- Unsaved meeting notes warn on refresh/close where supported. Drafts survive in-app meeting navigation in this tab's memory and clear on session end; they are not written to persistent browser storage. This does not guarantee recovery after a crash or forced mobile termination.

## Browser limits

The website cannot set browser-wide shortcuts, privacy settings, default browser, extensions, download location, or grant/revoke camera/microphone permission. Users control these in browser/OS settings. Install, notification, share and fullscreen availability varies by browser and embedding environment; unsupported actions have fallbacks or are omitted. `navigator.onLine` is a connectivity hint, not proof the API is reachable.

Background push when closed, calendar-provider synchronization, and browser extensions are separate integrations and are not implemented here. The public offline fallback intentionally does not provide cached private workspaces or offline editing.

## Verification

- Frontend TypeScript/Vite build and lint completed; existing lint and meeting bundle size advisories remain.
- Automated coverage checks worker API/third-party exclusions, offline fallback, cross-tab preference validation, session draft clearing, navigation history deduplication and safe post-login destinations.
- Browser preview verified permission diagnostics, clipboard success, fullscreen enter/exit, preference persistence/reset, Back/Forward and reload.
- Native install dialogs, notification delivery across actual devices, camera/microphone hardware, OS share targets, and print output require device-specific checks; permission prompts were not automatically accepted during testing.

## Research sources

- [Google Meet keyboard shortcuts](https://support.google.com/meet/answer/9298571)
- [Teams browser device troubleshooting](https://support.microsoft.com/en-us/teams/troubleshooting/troubleshoot-device-features-in-microsoft-teams-on-the-web)
- [MDN installable web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [MDN Permissions API](https://developer.mozilla.org/en-US/docs/Web/API/Permissions_API)
- [MDN Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
- [MDN fullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen)
- [MDN beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)
- [web.dev installation](https://web.dev/learn/pwa/installation)
