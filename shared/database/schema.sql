-- Draft schema for the future dynamic home page. Not used yet.
-- Mirrors the shape of shared/api/homeContent.json.

CREATE TABLE IF NOT EXISTS components (
  id          TEXT PRIMARY KEY,           -- c1..c4
  number      SMALLINT NOT NULL,
  name        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  publishes   TEXT NOT NULL,              -- event name
  owner       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'In development'
);

CREATE TABLE IF NOT EXISTS bays (
  id          TEXT PRIMARY KEY,           -- B1..B8
  status      TEXT NOT NULL CHECK (status IN ('free', 'busy', 'waiting')),
  vehicle     TEXT,
  job         TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_alerts (
  id          TEXT PRIMARY KEY,
  threat      TEXT NOT NULL,              -- fire, smoke, weapon, unauthorised_access, vehicle_tampering, loitering
  severity    TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  bay_id      TEXT REFERENCES bays(id),
  affected    TEXT NOT NULL CHECK (affected IN ('vehicle', 'people', 'both', 'premises')),
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
