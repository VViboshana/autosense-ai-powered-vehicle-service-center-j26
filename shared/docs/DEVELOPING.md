# Developing AutoSense

How the web app is put together, and the steps for adding to it. Follow the recipes so every member's screens look,
behave and are protected the same way.

## Who owns what

| Area | Database schema | API module | Screens (`frontend/src/modules/`) | AI service |
|---|---|---|---|---|
| Shared (users, roles, jobs, dashboard) | `app`, `workshop` | `access`, `navigation`, `jobs`, `dashboard`, `system` | `dashboard`, `system` | — |
| C1 Bay occupancy | `occupancy` | `occupancy` | `occupancy` | `member-1-occupancy/` |
| C2 Damage assessment | `damage` | `inspections` | `inspections` | `member-2-damage-assessment/` |
| C3 Predictive maintenance | `maintenance` | `maintenance` | `maintenance` | `member-3-predictive-maintenance/` |
| C4 Security & safety | `security` | `security` | `safety` | `member-4-anomaly-detection/` |

Change your own area freely. Changes to shared areas (the theme, layout, `app`/`workshop` tables, `lib/`, `http/`)
go through a pull request the team can see.

## The rules

1. **One response envelope.** Every API response is `{ success, data, requestId }` or
   `{ success: false, error: { code, message, details? }, requestId }`. Use `sendOk()` and throw the errors in
   `backend/src/http/errors.ts`; never `res.json()` a bare object.
2. **Every protected route checks a screen code.** `requireScreen('INSPECTION_REVIEW')`, with the same code the screen uses.
3. **Repositories hold the SQL; routes stay thin.** Always use parameters (`$1`), never build SQL from user text.
   Sort and filter only on columns you list in code.
4. **Validate input with zod** (`parse(schema, req.query)`) in the route.
5. **Schema changes are new migration files.** Never edit a migration that has been pushed.
6. **Every widget shows loading, empty and error states** (`Skeleton`, `EmptyState`, `ErrorState`), and lists are
   paged on the server (`Page<T>`, page sizes 10/20/50/100).
7. **Colours only through theme tokens** (`--as-*` in `autosense.css`); no hex values in components.
   Green, amber, red and blue mean state, not decoration.
8. **Times and money through `lib/format.ts`**: dates `dd/MM/yyyy`, times 24-hour in Asia/Colombo, LKR with two decimals.
9. **Label sample data** in the UI and never present it as real results. Never invent model metrics.
10. **AI predictions are suggestions.** Show confidence as model confidence, not as a probability of being right,
    and let staff confirm or correct.
11. Run `npm run check` before every pull request. Commit messages: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.

## Recipe: add a table

1. Create `shared/database/migrations/NNNN_<what>.sql` with the next number (e.g. `0006_damage_reviews.sql`).
   Put tables in your schema: `CREATE TABLE damage.review_notes (...)`.
2. Use `serial`/`bigserial` keys, `timestamptz` for times, `CHECK` constraints for fixed value lists,
   and reference `app.users (user_id)` for who did something.
3. `npm run db:migrate`. Commit the file. Teammates get it with their next `db:migrate`.

Reference data the app needs to work (lookup lists, defaults) goes in `database/reference/` and must be safe to re-run
(`INSERT ... ON CONFLICT ... DO NOTHING/UPDATE`). Sample data goes in `database/seeds/`.

## Recipe: add an API route

```
backend/src/modules/<module>/
  <module>.repository.ts   SQL in, typed objects out (accepts `db: Db`)
  <module>.routes.ts       Router: requireScreen + parse input + call repository + sendOk
  <module>.test.ts         tests for anything with logic
```

```ts
// backend/src/modules/inspections/inspections.routes.ts
export function inspectionsRoutes(db: Db) {
  const router = Router();
  router.get('/', requireScreen('INSPECTION_HISTORY'), async (req, res) => {
    const filter = parse(listQuery, req.query);          // 400 VALIDATION_FAILED on bad input
    sendOk(res, await listInspections(db, filter));      // Page<InspectionListItem>
  });
  return router;
}
```

Mount it in `backend/src/app.ts` after `currentUser`: `app.use('/api/inspections', inspectionsRoutes(db));`

Errors: throw `new NotFoundError('Inspection not found.')`, `new BusinessRuleError('ALREADY_CONFIRMED', '…')`, etc.
The user sees the message, so write it for them.

Calling an AI service: add a client in `backend/src/integrations/ml/` with a timeout, and turn failures into
`ServiceUnavailableError('DAMAGE_SERVICE_UNAVAILABLE', 'The damage service is not responding.')`. Never return a
made-up result when the model fails.

## Recipe: add a screen and its menu item

1. **Register it** in `database/reference/010_screens.sql` (code, name, url, parent section, Bootstrap icon, order,
   owner). A function without its own page (e.g. *confirm inspections*) has `show_on_menu = false`.
2. **Grant it** to roles in `database/reference/020_roles.sql`, then `npm run db:migrate`.
   The menu item appears for those roles straight away and opens a "being built" page.
3. **Build the page** in `frontend/src/modules/<module>/<Name>Page.tsx`:

   ```tsx
   export function ReviewQueuePage() {
     const { data, error, loading, reload } = useApi<Page<InspectionListItem>>('/inspections', { status: 'awaiting_review' });
     return (
       <>
         <PageHeader title="Review queue" subtitle="Inspections waiting for a technician" />
         <div className="app-content"><div className="container-fluid">
           <Card icon="bi-clipboard-check" title="Waiting for review">
             {error && !data ? <ErrorState inline error={error} onRetry={reload} />
               : loading ? <Skeleton width="60%" />
               : data!.records.length === 0 ? <EmptyState title="Nothing to review" />
               : <table className="table as-table">…</table>}
           </Card>
         </div></div>
       </>
     );
   }
   ```

4. **Route it** in `frontend/src/app/screens.tsx`: `{ code: 'INSPECTION_REVIEW', path: '/inspections/review', element: <ReviewQueuePage /> }`.
   The path must equal the url in `010_screens.sql`. The route is guarded by the code automatically.
5. Hide buttons the user can't use: `const { can } = useSession(); can('INSPECTION_CONFIRM') && <button …>`.
   The API checks again; hiding a button is a convenience, not security.

Building blocks: `Card`, `StatusPill`, `Skeleton` / `EmptyState` / `ErrorState`, `Dropdown`, `PageHeader`;
classes `as-table`, `as-toolbar`, `as-grid-foot`, `as-kpis` (see the dashboard module for working examples).

## How access control works

Adapted from the CleanBooks user-management model:

- `app.screens` is the registry of every screen and function. Its parent/child rows also build the menu
  (section headers, expandable groups, links; three levels at most).
- `app.roles` + `app.role_screens` say which screens each role may use. Grants are switched off with `is_active`,
  never deleted.
- Each user (`app.users`) has one role. Super admins may use everything.
- On each request the API loads `req.user` with the user's screen codes; `requireScreen()` checks them.
  `GET /api/me` and `GET /api/navigation/menu` give the browser the same information.
- **Next:** sign-in replaces `DEV_USER` inside `middleware/currentUser.ts` (tables `user_sessions`, `refresh_tokens`
  and `password_history` already exist). Routes and screens won't need to change.

## Connecting your component

Your AI service publishes results to the API as one of the agreed events (`bay.state`, `inspection.report`,
`job.forecast`, `security.alert`); the API stores them in `app.events` and in your schema. The dashboard shows
"Connects when … is ready" for your queues until your module reports `connected: true`
(`backend/src/modules/dashboard/dashboard.repository.ts`).
