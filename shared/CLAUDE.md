# AutoSense — project memory for Claude Code

AutoSense is a SLIIT IT4010 research project: an AI-powered vehicle service centre management system.
Four AI components share data through an event bus. This folder (`shared/` in the group repo) is the **web application** (PERN stack).
All paths below are relative to `shared/`. Do not modify the `member-*` folders from web-app tasks.

## Components and events (do not rename)
| ID | Component | Publishes | Uses |
|---|---|---|---|
| c1 | Bay Occupancy & Queue Prediction | `bay.state` | `job.forecast` |
| c2 | Vehicle Damage Assessment | `inspection.report` | — |
| c3 | Predictive Maintenance & Duration Forecasting | `job.forecast` | `inspection.report` |
| c4 | Vehicle Security & Disaster Detection | `security.alert` | `bay.state` |

Component 4 threats: fire, smoke, weapon, unauthorised_access, vehicle_tampering, loitering.
Severity: low, medium, high, critical. Affected: vehicle, people, both, premises.

## Stack
- `frontend/` React 18 + Vite + React Router. CSS Modules + design tokens in `frontend/src/styles/tokens.css`.
- `backend/` Node 20 + Express 4 (ES modules). PostgreSQL via `pg` (`backend/src/db/pool.js`). Schema in `database/schema.sql`.
- `api/homeContent.json` — current home page data (static, marked `isSampleData: true`).
- npm workspaces. Scripts (run from `shared/`): `npm run dev`, `npm run build`, `npm run lint`.

## How data flows (keep this pattern for every page)
Component → hook (`frontend/src/hooks/`) → service (`frontend/src/services/`) → static JSON **or** `GET /api/...`.
- `VITE_USE_API=false` (default): services return the static JSON.
- `VITE_USE_API=true`: services call Express, which will read PostgreSQL.
- The JSON shape is the contract. When moving to the database, the API must return the SAME shape.
  Never change a shape in only one place: update `api/homeContent.json`, the service, the route and `database/schema.sql` together.

## Rules
1. Components are presentational: data comes in through props only. No `fetch` inside components.
2. Colours, fonts, spacing only through CSS variables in `tokens.css`. No hard-coded hex in components.
3. One component per file in `frontend/src/components/` with a matching `*.module.css`.
4. Keep pages responsive (works at 390 px wide, no horizontal scroll) and accessible (semantic HTML, focus states, alt text).
5. Sample data must stay clearly labelled as sample data in the UI.
6. Never commit `.env`, real customer data, CCTV images or model weights.
7. Run `npm run lint` and `npm run build` before saying a task is done.
8. Small, focused commits using Conventional Commits: `feat:`, `fix:`, `style:`, `refactor:`, `docs:`, `chore:`.
9. Ask before adding a new dependency. Prefer what is already installed.

## Not built yet (do not invent)
Authentication, real-time updates (WebSocket/MQTT), the event bus, ML model integration, real database data.
