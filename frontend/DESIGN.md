# IntellMeet UI and UX

## Product direction

A calm workspace that connects the meeting lifecycle: prepare → consent and join → collaborate → review → act. The current identity, **Paper & Signal**, uses warm ivory working surfaces, deep forest navigation and chartreuse highlights. An original nine-bar signal mark represents individual voices coming together. Self-hosted Fraunces supplies editorial headings; DM Sans and Manrope keep controls readable. Status always includes text alongside color.

## Signature design research — 11 October 2026

Queried the public [Inspo MCP](https://inspomcp.dev/mcp) through its read-only hosted endpoint using `recommend` and `search_screens`. The focused SaaS search returned [SavvyCal](https://savvycal.com), [Amie](https://amie.so), and [Google Workspace](https://workspace.google.com). SavvyCal informed the warm green direction; Amie informed focused calendar hierarchy. [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh) informed quieter navigation and consistent action placement. Reference sites supply principles, not copied assets or proprietary fonts.

The next meeting is now the dashboard's primary action. A collapsed setup checklist reduces repeated onboarding noise. Metrics share one compact strip, secondary working surfaces remain light, and the calendar changes to a vertical agenda on mobile. The signal sculpture is original CSS geometry with no external images or tracking requests. No decorative animation competes with a video call.

The plugin directory was checked: Figma is available but unconnected and was already suggested previously. Inspo was used directly through the existing MCP SDK, with no persistent app configuration or access to private workspace data. The research requests contain generic design descriptions only.

## Research and decisions

- [Notion workspace navigation](https://www.notion.com/help/navigate-with-the-sidebar): preserve workspace context with a visible switcher and stable navigation. IntellMeet adds a local workspace search with Ctrl/Cmd K.
- [Zoom waiting room](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059359): distinguish host admission from participant entry. Keep consent explicit and show waiting-room state before media controls.
- [Slack accessibility](https://slack.com/accessibility): support keyboard navigation and assistive technology alongside pointer interaction.
- [Atlassian empty states](https://atlassian.design/components/empty-state/): explain why a view is empty and offer a relevant next action. A setup checklist reflects persisted workspace data.
- [Material foundations](https://m3.material.io/foundations/): centralize semantic colors and repeatable controls; use responsive layouts rather than shrinking desktop content.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): visible focus, labelled inputs, text status indicators, minimum target sizing, reduced motion, and reflow. These are implementation goals, not a claim of conformance certification.

## Implemented screen system

Public entry: signed-out visitors at `/` see the landing page, with sign-in at `/login` and account creation at `/register`. Email verification, recovery and OAuth paths retain their existing handling. The landing explains the before/during/after meeting lifecycle, inspired by [Zoom Meetings](https://www.zoom.com/en/products/virtual-meetings/) and [Amie's meeting-note organization](https://amie.so/documentation/features/pages). Its sample meeting is explicitly illustrative. It includes no invented customer endorsements, usage figures or pricing. Current provider limitations appear in the FAQ.

Authentication: registration, verification, sign-in, MFA and password recovery. Workspace: onboarding, dashboard, weekly agenda, searchable meetings, action board, team and invitations. Meeting: entry, consent, admission, video controls, persistent chat, versioned notes, transcript, recap and assets. Account: profile, MFA, workspace settings, notifications and support.

The weekly agenda uses local time, offers previous/next week and a return to this week, and opens the existing meeting detail. Search covers the loaded meetings, tasks and members in the current workspace, never another tenant. Results are capped at twelve; meeting/task APIs currently load up to one hundred items, so search is not a full-history search.

## Interaction states

Use an explicit busy state for writes, disable duplicate submissions, keep errors readable, and preserve conflicting note drafts. Native dialogs provide focus containment and Escape dismissal. Filter buttons expose their selected state, navigation exposes its current page, and status announcements use live regions. No synthetic AI output or inflated dashboard metrics.

## Validation and remaining launch work

Test desktop and mobile navigation, search result opening, weekly navigation, persisted task status, email verification, consent, chat, note revision conflict handling and media connectivity. Browser media tests use synthetic devices. Real multi-person camera, microphone and screen-sharing exchange, user usability sessions, screen-reader testing and a full accessibility audit remain launch checks. Company service configuration is required for AI processing and recording. No Figma MCP is connected in this environment; the design is implemented directly as reusable React and CSS components and verified with Playwright MCP.

## UI refresh — 18 October 2026

See [UI_REVIEW.md](UI_REVIEW.md) for the new interactive landing page, refreshed workspace treatment, MagicPath direction board, current tokens, browser verification and known limitations. The latest refresh uses separate metric cards in place of the earlier shared strip. Earlier research and product constraints above remain useful context.
