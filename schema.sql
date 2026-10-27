CREATE TABLE IF NOT EXISTS teachers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- "ali" and "Ali" count as duplicates
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Class names (K1, K2, ...). Each day's timetable has one row per class or per combined group.
CREATE TABLE IF NOT EXISTS classes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Seeded only while the table is empty, so re-running this file doesn't bring back removed classes.
-- The ids match DEFAULT_CLASSES and LEGACY_ROWS in src/lib/config.ts.
INSERT INTO classes (id, name)
SELECT column1, column2 FROM (VALUES
  ('k1', 'K1'), ('k2', 'K2'), ('k3', 'K3'), ('k4', 'K4'), ('k5', 'K5'),
  ('k6', 'K6'), ('k7', 'K7'), ('k8', 'K8'), ('k9', 'K9'), ('k10', 'K10'),
  ('k11', 'K11'), ('k12', 'K12'), ('k13', 'K13'), ('k14', 'K14'), ('k15', 'K15'))
WHERE NOT EXISTS (SELECT 1 FROM classes);
