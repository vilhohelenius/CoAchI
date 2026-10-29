-- Derived tables, fully rebuilt from raw rows by `sync/run.ts recompute`. Writes are upserts on the primary key.

ALTER TABLE activities ADD COLUMN load REAL;          -- our TRIMP-style load, 100 = 1 h at LTHR. Not Garmin's EPOC load.
ALTER TABLE activities ADD COLUMN load_source TEXT;   -- zones|avg_hr|rpe

CREATE TABLE load_daily (
  date TEXT PRIMARY KEY,
  load REAL NOT NULL,
  ctl REAL, atl REAL, tsb REAL, tsb_end REAL,
  acwr REAL, ramp7 REAL,
  status TEXT,
  warming_up INTEGER NOT NULL DEFAULT 0
);

-- Flexible per-day metrics. value for single numbers, json for structured ones.
-- Keys: load.<sport>, zsec.<sport>, hrv, recovery, sleep, readiness, goals, projection.
CREATE TABLE metric_daily (
  date TEXT NOT NULL,
  key TEXT NOT NULL,
  value REAL,
  json TEXT,
  PRIMARY KEY (date, key)
);
