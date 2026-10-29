-- Per-run results of the records stage, one row per run and label. Written when a run's FIT file is read.
-- Labels: 1k 1mi 5k 10k hm (best time, s) | t180 t360 t720 t1200 (best distance in 3/6/12/20 min, m) | p60 p300 p1200 (best mean power, W)
--         ss_hr ss_v (steady 5-minute blocks: median HR bpm and speed m/s, n = blocks) | done (run was analysed, even if nothing qualified).
CREATE TABLE activity_efforts (
  activity_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  value REAL NOT NULL,
  n INTEGER,
  PRIMARY KEY (activity_id, label)
);

-- Derived from activity_efforts, fully rebuilt by `sync/run.ts records`. Keeps the all-time top 3 per label
-- (rank 1 to 3) and every run that set a personal best when it happened (is_pb = 1), so a PB timeline can be drawn.
CREATE TABLE best_efforts (
  label TEXT NOT NULL,
  activity_id INTEGER NOT NULL,
  value REAL NOT NULL,          -- seconds for distances, watts for power
  date TEXT NOT NULL,
  rank INTEGER,                 -- 1 to 3, null when kept only as PB history
  is_pb INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (label, activity_id)
);
