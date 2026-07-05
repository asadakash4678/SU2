-- ============================================================
-- SUMS — PostgreSQL schema
-- Document-style clinical records in JSONB (mirrors the client
-- data model) with relational users/audit for security & integrity.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  desig         TEXT,
  emp           TEXT,
  contact       TEXT,
  email         TEXT,
  pw_hash       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',      -- active|locked|deactivated|archived
  must_change   BOOLEAN NOT NULL DEFAULT false,
  perm_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  session_epoch BIGINT NOT NULL DEFAULT 0,
  failed        INT NOT NULL DEFAULT 0,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT
);

-- Generic clinical record store. One row per record; `data` holds the
-- full object the client uses. `version` powers optimistic-concurrency
-- conflict handling for simultaneous multi-user edits.
CREATE TABLE IF NOT EXISTS records (
  id            TEXT PRIMARY KEY,
  collection    TEXT NOT NULL,                       -- patients|notes|surgeries|meds|mar|labs|io|drains|orders|tasks|chat|photos|timeline|notifications
  data          JSONB NOT NULL,
  version       INT NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection);
CREATE INDEX IF NOT EXISTS idx_records_updated ON records(updated_at);

-- Append-only, immutable audit log (§4.13). No UPDATE/DELETE ever issued.
CREATE TABLE IF NOT EXISTS audit (
  id       TEXT PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  uid      TEXT,
  uname    TEXT,
  role     TEXT,
  action   TEXT NOT NULL,
  detail   TEXT,
  device   TEXT,
  ip       TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);

-- Small key/value config (ward settings + permission matrix).
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
