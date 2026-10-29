-- Results the Garmin data does not hold (races before the account started, efforts cut from a longer run). Added by hand with
-- `sync/run.ts effort <label> <time> <date> [note]`. They join best_efforts under the activity id -id, and never drive predictions older than 179 days.
CREATE TABLE manual_efforts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,   -- 1k 1mi 5k 10k hm
  value REAL NOT NULL,   -- seconds
  date TEXT NOT NULL,
  note TEXT
);
