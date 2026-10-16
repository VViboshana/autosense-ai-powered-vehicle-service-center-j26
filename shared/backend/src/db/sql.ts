/**
 * Start of "today" in the service centre's time zone (setting app.timezone), as a CTE named `day` with one column,
 * `start`. The database server runs in UTC, so never use CURRENT_DATE for business days. Use it as:
 *   `${LOCAL_DAY} SELECT ... FROM workshop.jobs j, day WHERE j.checked_in_at >= day.start`
 */
export const LOCAL_DAY = `
  WITH tz AS (
    SELECT COALESCE((SELECT value #>> '{}' FROM app.settings WHERE setting_key = 'app.timezone'), 'Asia/Colombo') AS name
  ),
  day AS (
    SELECT (date_trunc('day', now() AT TIME ZONE tz.name) AT TIME ZONE tz.name) AS start FROM tz
  )`;
