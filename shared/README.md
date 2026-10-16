# AutoSense web app

The one web app for all four AutoSense components: a React frontend, an Express API and a PostgreSQL database.
The AI models run as separate Python services in each member's folder; the API calls them, the browser never does.

```
Browser ──► frontend (React, :5173) ──/api──► backend (Express, :5000) ──► PostgreSQL (Neon)
                                                   └──► AI services (FastAPI): damage :8001 · occupancy :8002
```

| Folder | What it is |
|---|---|
| `frontend/` | React 19 + TypeScript + Vite. AdminLTE 4 layout with the AutoSense theme (`src/theme/autosense.css`). |
| `backend/` | Express 5 + TypeScript. Every response uses one envelope; every protected route checks a screen permission. |
| `database/` | SQL: `migrations/` (schema), `reference/` (screens, roles, settings), `seeds/` (sample data). |
| `docs/DEVELOPING.md` | How to add a table, an API route, a screen and a menu item. **Read this before your first change.** |

## Run it

You need **Node.js 22.9 or later** (`node -v`) and the team's database connection string (ask the team lead; it is never
committed).

```bash
cd shared
npm install                                   # installs frontend and backend together
cp backend/.env.example backend/.env          # then paste DATABASE_URL into backend/.env
npm run db:migrate                            # creates or updates the tables (safe to run any time)
npm run db:seed                               # sample users, vehicles, bays and today's jobs (development only)
npm run dev                                   # API on :5000 and web app on http://localhost:5173
```

Open http://localhost:5173. Check the API at http://localhost:5000/api/health — `database` must be `up`.

On Windows PowerShell use `Copy-Item backend/.env.example backend/.env` instead of `cp`.

### Who am I signed in as?

Sign-in is the next feature. Until then the API treats every request as `DEV_USER` from `backend/.env`. Change it and
restart `npm run dev` to see the app as another role:

| DEV_USER | Role | Sees |
|---|---|---|
| `admin` | System administrator (super admin) | Everything |
| `nimal.perera` | Service manager | All operational screens, reports, audit log |
| `dilani.fernando`, `ruwan.silva` | Service advisor | Check-in, new inspection, history, bays, forecasts |
| `ishara.silva` | Technician | Inspections incl. review, bays, forecasts, safety alerts |

All sample users have the password `Demo@1234` (used once sign-in exists).

## Everyday commands (run in `shared/`)

| Command | Does |
|---|---|
| `npm run dev` | API and web app with live reload |
| `npm run check` | Typecheck, lint and test everything. **Run before every pull request.** |
| `npm run db:migrate` | Apply new migrations, refresh screens/roles/settings |
| `npm run db:seed` | Refresh the sample day (re-run it on a new day to make the dashboard look live again) |
| `npm run db:reset -- --yes` | Drop and rebuild the database with sample data (development databases only) |
| `npm run db:status -w backend` | Which migrations are applied |
| `npm run build` | Production build of both |
| `npm run format` | Format code with Prettier |

## Settings

| Where | What |
|---|---|
| `backend/.env` | Secrets and machine settings: `DATABASE_URL`, `PORT`, `DEV_USER`, AI service URLs, `LOG_LEVEL`. Checked at startup; a bad value stops the API with a message saying which. See `backend/.env.example`. |
| `frontend/.env` (optional) | `API_PROXY_TARGET`, `WEB_PORT` for the dev server. |
| `app.settings` table | Business settings: time zone (Asia/Colombo), date format, currency, photo limits, bay rules. Defaults in `database/reference/030_settings.sql`. Public ones reach the browser via `GET /api/app-config`. |

Never commit `.env` files, datasets, model weights (`.pt`, `.pkl`, `.onnx`), photos or camera footage.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Invalid configuration in backend/.env` | The message names the setting. Copy `.env.example` again if unsure. |
| `Could not connect to the database` | Check `DATABASE_URL`. Neon sleeps when idle: wait a few seconds and retry. |
| Page says *AutoSense couldn't start* | The API isn't running or can't reach the database. Look at the terminal running `npm run dev`. |
| `DEV_USER "…" is not an active user` | Run `npm run db:seed`, or set `DEV_USER` to one of the users above. |
| `… was changed after it was applied` | Someone edited an old migration. Add a new migration instead; on your own dev database you may `db:reset`. |
| Port 5000 or 5173 in use | `netstat -ano \| findstr :5000`, then `taskkill /PID <pid> /F`; or change `PORT` / `WEB_PORT`. |
| Dashboard shows "—" and "Connects when … is ready" | Expected: that component isn't connected yet. |
