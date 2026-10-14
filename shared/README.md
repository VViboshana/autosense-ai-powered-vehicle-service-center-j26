# AutoSense

AI-powered intelligent vehicle service centre management system — SLIIT IT4010 Research Project (2026).

Four AI components connected by a shared event bus:

| # | Component | Event |
|---|---|---|
| 1 | Bay Occupancy & Queue Prediction | `bay.state` |
| 2 | Vehicle Damage Assessment | `inspection.report` |
| 3 | Predictive Maintenance & Duration Forecasting | `job.forecast` |
| 4 | Vehicle Security & Disaster Detection | `security.alert` |

## Tech stack
PostgreSQL · Express.js · React (Vite) · Node.js

## Project structure
The web app lives in the repo's `shared/` folder (member folders are untouched):
```
shared/
├── package.json       npm workspaces root (frontend + backend)
├── frontend/          React app (home page, future dashboards)
│   └── src/
│       ├── pages/         one file per route
│       ├── components/    UI pieces (+ .module.css)
│       ├── hooks/         data hooks used by pages
│       ├── services/      where data comes from (static JSON or API)
│       └── styles/        design tokens + global styles
├── backend/           Express API
│   └── src/
│       ├── routes/        /api/health, /api/home
│       └── db/            PostgreSQL pool + init script
├── api/               homeContent.json (current static data = API contract)
├── database/          schema.sql
└── utils/
```
Claude Code prompts for this app: `docs/web-app/CLAUDE_CODE_PROMPTS.md`.

## Getting started
Requires Node.js 20+.

```bash
cd shared
npm install
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
npm run dev          # client: http://localhost:5173  ·  API: http://localhost:5000
```

Check the API: http://localhost:5000/api/health

## Static now, dynamic later
The home page reads `shared/api/homeContent.json` through `frontend/src/services/homeService.js`.
Set `VITE_USE_API=true` in `frontend/.env` to load the same data from `GET /api/home` instead.
Later the route will read PostgreSQL (`shared/database/schema.sql`) and return the same JSON shape.

## Database (later)
```bash
# from shared/, after installing PostgreSQL and setting DATABASE_URL in backend/.env
npm run db:init -w backend
```

## Team
| Component | Member |
|---|---|
| 1 | Harindya N H |
| 2 | Edirisinghe M D |
| 3 | Munasinghe |
| 4 | Viboshana T G V (group leader) |
