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

Mount it in `backend/src/app.ts` after `authenticate`: `app.use('/api/inspections', inspectionsRoutes(pool));`

Errors: throw `new NotFoundError('Inspection not found.')`, `new BusinessRuleError('ALREADY_CONFIRMED', '…')`, etc.
The user sees the message, so write it for them.

Calling an AI service: add a client in `backend/src/integrations/ml/` with a timeout, and turn failures into
`ServiceUnavailableError('DAMAGE_SERVICE_UNAVAILABLE', 'The damage service is not responding.')`. Never return a
made-up result when the model fails.

## Recipe: add a screen and its menu item

1. **Register it** in `database/reference/010_screens.sql`: code, name, url, parent section, Bootstrap icon, order, and
   - `feature`: `occupancy` · `damage` · `maintenance` · `security` · `shared` (groups it in Role permissions),
   - `access_level`: `use` (daily work) · `manage` (setup of your feature) · `admin` (users, roles, settings),
   - `audience`: `staff`, or `customer` for the customer pages.

   An action without its own page (e.g. *confirm inspections*) has `show_on_menu = false` and is called a function.
2. **Grant it.** Shipped roles pick it up automatically on `npm run db:migrate`: System administrator gets every staff
   screen, Staff gets every `use` screen, Customer gets every customer screen. For other roles, tick it in
   Administration › Role permissions. The menu item then appears and opens a "being built" page.
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

Adapted from the CleanBooks user-management model, without tenants or branches:

- **Two kinds of user.** Staff use the staff app (sidebar) and work on every vehicle. Customers (vehicle owners) sign
  up themselves and only see `/my`: their own vehicles, and only after staff approve the vehicle request.
- **Screens.** `app.screens` registers every screen and function, with its feature, access level and audience. Its
  parent/child rows also build the menu (section headers, expandable groups, links; three levels at most).
- **Roles.** `app.roles` + `app.role_screens`. Shipped: System administrator, Staff, Customer. Administrators create
  more staff roles and tick their screens in Role permissions. A role only ever gets screens of its own audience.
  Grants are switched off with `is_active`, never deleted. Super admins use every staff screen whatever their role.
- **Sign-in.** `POST /api/auth/login` checks the password (scrypt), then creates a session: a random token in an
  HttpOnly cookie, its SHA-256 hash in `app.user_sessions`. Sessions end on sign-out, after `auth.sessions.maxHours`,
  after `idleMinutes` without activity, when the password changes, or when the account is deactivated.
  Five wrong passwords lock the account (`auth.lockout`). Password rules: `auth.password_policy`.
- **Every request.** `middleware/authenticate.ts` turns the cookie into `req.user` (screens, user type, customer id).
  Then each route decides:
  - staff routes: `requireScreen('CODE', …)`;
  - customer routes (`/api/my/*`): `requireCustomer()` and **every query filtered by `req.user.customerId`**. Never take
    a customer id from the request, and show a vehicle only through an approved `workshop.vehicle_claims` row.
- **Cross-site protection.** Changes (POST/PUT/PATCH/DELETE) are only accepted from `ALLOWED_ORIGINS`.
- **Audit.** Sign-ins, lockouts and every change to users, roles, permissions and vehicle requests go to
  `app.audit_log` via `lib/audit.ts`. Use it for your own important changes too.
- **Customer pages.** Routed in `frontend/src/app/App.tsx` under `/my` (`CustomerLayout`). What a customer sees about
  your feature must be confirmed, customer-safe information (e.g. a confirmed inspection, never the raw AI result).

## Connecting your component

Your AI service publishes results to the API as one of the agreed events (`bay.state`, `inspection.report`,
`job.forecast`, `security.alert`); the API stores them in `app.events` and in your schema. The dashboard shows
"Connects when … is ready" for your queues until your module reports `connected: true`
(`backend/src/modules/dashboard/dashboard.repository.ts`).
