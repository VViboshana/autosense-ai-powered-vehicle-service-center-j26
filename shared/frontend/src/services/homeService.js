// Single place that decides where home-page data comes from.
// Today: the static JSON in shared/api. Later: the Express API (GET /api/home),
// which will read from PostgreSQL. The shape of the data stays the same,
// so no page or component has to change when we switch.
import staticHomeContent from '@shared/api/homeContent.json';

const USE_API = import.meta.env.VITE_USE_API === 'true';

export async function getHomeContent() {
  if (!USE_API) return staticHomeContent;

  const res = await fetch('/api/home');
  if (!res.ok) throw new Error(`Could not load home content (HTTP ${res.status})`);
  return res.json();
}
