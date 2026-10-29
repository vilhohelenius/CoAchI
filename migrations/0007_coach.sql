-- Coach: chat history, monthly spend, planned load and the cached "Explain this" texts. Notes live in coach_notes (0001).
CREATE TABLE coach_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL
);

-- One row per month (YYYY-MM). usd is computed in code from the token counts and the price constants.
CREATE TABLE coach_usage (
  month TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  usd REAL NOT NULL DEFAULT 0
);

CREATE TABLE planned_load (
  date TEXT PRIMARY KEY,
  load REAL NOT NULL,               -- 0 = rest day
  label TEXT
);

CREATE TABLE explain_cache (
  metric TEXT NOT NULL,
  date TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (metric, date)
);
