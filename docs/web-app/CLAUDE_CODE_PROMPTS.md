# Claude Code prompts — AutoSense web app

Run these in the Claude Code panel in VS Code, with the repo open. The web app lives in `shared/`;
`shared/CLAUDE.md` loads when Claude works on files there. Run npm commands from `shared/`. Do one prompt at a time, check the result in the browser, then commit.

---

## 0. Check setup
```
Read shared/CLAUDE.md and shared/README.md. In 5 bullets tell me the stack, the folder structure and the data-flow rule.
Then, from shared/, run npm install, npm run lint and npm run build, and tell me if anything fails. Don't change code.
```

## 1. Run and review the home page
```
Start the app with npm run dev. Review shared/frontend/src for anything that breaks the rules in shared/CLAUDE.md
(hard-coded colours, fetch inside components, missing alt/labels, layout problems below 390 px).
List the issues first, then fix them after I say yes.
```

## 2. Add a page section (example)
```
Add a "Team" section to the home page, after "How it works".
Put the data in shared/api/homeContent.json under "team" (name, component number, role).
Follow the existing pattern: data → useHomeContent → HomePage → new Team component with its own module.css.
Use the Section component. Run lint and build when done.
```

## 3. Switch the home page to the API
```
Set VITE_USE_API=true in shared/frontend/.env, start both client and server, and confirm the home page
loads from GET /api/home with no visual change. Add a loading skeleton instead of the plain
"Loading AutoSense…" text. Don't change the JSON shape.
```

## 4. Prepare PostgreSQL (when the team is ready)
```
Using shared/database/schema.sql, add a seed script (shared/backend/src/db/seed.js) that inserts the sample
components, bays and alerts from shared/api/homeContent.json. Then change GET /api/home to build the
same JSON shape from PostgreSQL, falling back to the static JSON if the database is not configured.
Add npm scripts and explain how to run it. Ask before adding any dependency.
```

## 5. Before every commit
```
Run npm run lint and npm run build. Show me git status and a one-line Conventional Commit message
for these changes. Don't commit until I approve.
```
