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

### Accounts

There are no built-in accounts or passwords.

1. **First run.** While the database has no staff account, the web app shows **Set up AutoSense**. Create the System
   administrator there (a super admin: every staff screen). The page disappears once that account exists.
   On a server others can reach, set `SETUP_KEY` in `backend/.env` first; the page then asks for it.
2. **Team.** The administrator creates roles in Administration › **Roles**, ticks what each can use in **Role
   permissions**, and adds people in **Users** with a starting password, handed over privately.
3. **Customers** create their own account at `/register`, then ask to add their vehicle; staff approve it in
   Service floor › Customer vehicle requests.

Five wrong passwords lock an account; an administrator unlocks it in Administration › Users.

## Everyday commands (run in `shared/`)

| Command | Does |
|---|---|
| `npm run dev` | API and web app with live reload |
| `npm run check` | Typecheck, lint and test everything. **Run before every pull request.** |
| `npm run db:migrate` | Apply new migrations, refresh screens/roles/settings |
| `npm run db:seed` | Sample vehicles, jobs, bays and inspections (no accounts). Re-run on a new day to make the dashboard look live again |
| `npm run db:reset -- --yes` | Drop and rebuild the database with sample data (development databases only) |
| `npm run db:status -w backend` | Which migrations are applied |
| `npm run build` | Production build of both |
| `npm run format` | Format code with Prettier |

## Settings

| Where | What |
|---|---|
| `backend/.env` | Secrets and machine settings: `DATABASE_URL`, `PORT`, `ALLOWED_ORIGINS`, AI service URLs, `LOG_LEVEL`. Checked at startup; a bad value stops the API with a message saying which. See `backend/.env.example`. |
| `frontend/.env` (optional) | `API_PROXY_TARGET`, `WEB_PORT` for the dev server. |
| `app.settings` table | Business settings: time zone (Asia/Colombo), date format, currency, photo limits, bay rules, password rules (`auth.password_policy`), lockout (`auth.lockout`), session length (`auth.sessions`). Defaults in `database/reference/030_settings.sql`. Public ones reach the browser via `GET /api/app-config`. |

Never commit `.env` files, datasets, model weights (`.pt`, `.pkl`, `.onnx`), photos or camera footage.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Invalid configuration in backend/.env` | The message names the setting. Copy `.env.example` again if unsure. |
| `Could not connect to the database` | Check `DATABASE_URL`. Neon sleeps when idle: wait a few seconds and retry. |
| Page says *AutoSense couldn't start* | The API isn't running or can't reach the database. Look at the terminal running `npm run dev`. |
| Setup page doesn't appear | A staff account already exists. Sign in, or ask the administrator for an account. |
| *This account is locked* | An administrator: Administration › Users, ⋯ › Unlock (or Reset password). |
| *This request came from a page outside AutoSense* | You opened the web app on an address not in `ALLOWED_ORIGINS` (backend/.env). Add it and restart. |
| `… was changed after it was applied` | Someone edited an old migration. Add a new migration instead; on your own dev database you may `db:reset`. |
| Port 5000 or 5173 in use | `netstat -ano \| findstr :5000`, then `taskkill /PID <pid> /F`; or change `PORT` / `WEB_PORT`. |
| Dashboard shows "—" and "Connects when … is ready" | Expected: that component isn't connected yet. |
