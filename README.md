# IntellMeet

The backend project, configuration templates, tests, and documentation are in [`backend/`](backend/).

Run backend commands from that folder:

```sh
cd backend
npm ci
npm run check
```

See [backend setup](backend/README.md) and [local services](backend/docs/LOCAL-SERVICES.md).

The React frontend is in [`frontend/`](frontend/). Run `npm ci` and `npm run dev` from that folder, then open http://localhost:5173. See [frontend setup](frontend/README.md).

GitHub Actions workflows remain in `.github/workflows/`, the location required by GitHub.
