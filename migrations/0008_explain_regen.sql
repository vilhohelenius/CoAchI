-- Regenerations of "Explain this" per metric per day, capped in code (REGEN_LIMIT).
CREATE TABLE explain_regen (
  metric TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (metric, day)
);
