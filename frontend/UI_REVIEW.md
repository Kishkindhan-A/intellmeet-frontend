# IntellMeet — Paper & Signal UI

## Direction

The interface pairs warm ivory surfaces with forest green navigation and restrained lime accents. Manrope gives navigation and controls a precise voice; Fraunces adds warmth to key headings. Original CSS artwork represents many voices coming together. Fonts are served locally; the new landing page does not depend on remote images.

| Token | Value | Purpose |
| --- | --- | --- |
| Canvas | `#F8F7F2` | Main page background |
| Surface | `#FFFEFA` | Cards and dialogs |
| Forest | `#253C32` | Brand and primary text direction |
| Primary control | `#304B36` | Authenticated primary actions |
| Lime | `#D8ED9A` | Selected navigation and accents |
| Border | `#DEE3D5` | Quiet separation |

## Research and tools

Reviewed during implementation:

- [Linear features](https://linear.app/features): clear hierarchy, restrained chrome, focused workflows.
- [Whereby meetings](https://whereby.com/information/meetings): recognizable meeting controls and straightforward participant flows.
- [Mobbin](https://mobbin.com): reference for navigation and product interaction patterns. No paid screenshots or source designs were copied.

These observations informed an original design, rather than a reproduction of any reference. Plugin discovery identified Figma and MagicPath; MagicPath became available and was used for a private design-direction board. Figma was not connected or used. Browser MCP with Playwright locators was used to inspect and exercise the implementation.

## Implemented experience

- A new landing page with custom ribbon artwork, workflow storytelling, responsive navigation, expandable FAQs, and account entry points.
- An interactive product tour with workspace, meeting, and recap views. Microphone/camera toggles are explicitly simulated and do not access devices. Action-item completion is local preview state. Sample data is labeled.
- A consistent visual treatment across the existing real account, dashboard, meeting, action-item, team, settings, help, and notification screens.
- Improved modal labeling, visible focus treatment, reduced-motion support, and hidden mobile navigation removed from focus/visibility when closed.
- Actual account and workspace flows continue to use the existing backend APIs. The landing preview is not a replacement for authenticated product behavior.

## Files

- `src/StudioLanding.tsx` and `src/StudioLanding.css`: public page and interactive sample workspace.
- `src/WorkspacePolish.css`: shared styling for the authenticated application and account screens.
- `src/App.tsx`: activates the new landing and shared styles.
- `src/ui.tsx`: accessible dialog names.
- `src/index.css`: avoids minimum-width overflow when a narrow viewport has a scrollbar.

## Verification — 18 October 2026

Browser checks used the local frontend and local test backend, with a synthetic account and workspace:

- Registration, captured-email verification, login, and workspace creation.
- Meeting creation, dashboard update, search result filtering, and opening the real meeting preparation screen.
- Mobile action-item creation, owner assignment, and moving the saved item to Done.
- Product tour navigation, microphone/camera preview toggles, recap transition, action completion, agenda dialog, and Escape dismissal.
- Mobile navigation, FAQ expansion, registration navigation, and password visibility.
- Visual inspection at desktop, 390px mobile, and 320px narrow widths. Mobile dashboard has no horizontal overflow.

Issues corrected during review: excessive mobile heading wrapping, mismatched agenda-dialog title, low contrast on the meeting preparation screen, narrow-viewport minimum width, and offscreen mobile navigation remaining discoverable.

`npm run build` passes. `npm run lint` exits successfully with five existing warnings: one mixed-export Fast Refresh warning and four effect/state warnings. Vite reports the existing large lazy-loaded LiveKit meeting chunk (about 690 KB minified). These are follow-up maintenance/performance items, not a clean-warning report.

Screenshots are in `design-review/`. This is a UI and interaction review, not a full accessibility certification, penetration test, or production-service validation. Real multi-participant media, recording/egress, production email, and AI provider calls were not tested during this UI pass. Production credentials and deployment remain company-managed.

## Run locally

From `frontend/`, run `npm install` if needed, then `npm run dev`. Open `http://localhost:5173/`.

For the existing Windows test services, run `npm run local:services` from `backend/`. The first cold start may need a retry if startup exceeds the local runtime's readiness timeout. Local test data remains separate from production. Existing test services and configuration have been retained.
