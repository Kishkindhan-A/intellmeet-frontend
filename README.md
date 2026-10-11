# IntellMeet Frontend

This is the React + TypeScript frontend for IntellMeet. It provides the user-facing app for authentication, workspace management, meeting flows, notifications, and collaborative meeting utilities.

## Stack

- React 19
- TypeScript
- Vite
- LiveKit client
- Socket.IO client
- Oxlint for linting

## Prerequisites

- Node.js 24+
- A running backend instance
- Access to the app API and socket server

## Local development

From the repository root:

```bash
cd frontend
npm install
npm run dev
```

Then open:

- http://127.0.0.1:5173

The Vite dev server proxies:

- /api -> http://127.0.0.1:4000
- /socket.io -> http://127.0.0.1:4000 (WebSocket)

If you want to run the full local stack, start the backend services first:

```bash
cd backend
npm install
npm run local:services
```

## Environment variables

The frontend reads its API base from the `VITE_API_URL` environment variable. If it is not set, it defaults to `/api`.

Example:

```bash
VITE_API_URL=http://127.0.0.1:4000/api
```

Do not store secrets or private credentials in the frontend. Only browser-safe public values should be exposed here.

## Scripts

```bash
npm run dev      # start Vite dev server
npm run build    # type-check and build production assets
npm run lint     # run Oxlint
npm run preview  # preview the production build locally
npm audit --audit-level=high
```

## What this frontend includes

- sign up, sign in, password reset, and email verification
- secure session handling with refresh and CSRF support
- workspace creation and switching
- meeting scheduling and room lifecycle
- waiting-room and participant consent flows
- video, audio, and screen-sharing controls
- shared notes and meeting chat
- action items and recap views
- notifications and support submission

## Notes

This app is designed to work against the backend API and real meeting infrastructure. For local development, the backend should be running and configured correctly before opening the frontend.

For production deployments, serve the app over HTTPS and ensure your reverse proxy or hosting platform forwards API and WebSocket traffic correctly.

