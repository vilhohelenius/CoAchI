-- Shoes are entered by hand (Garmin sends no gear). Mileage is never stored: start_km + the distance of the assigned activities.
-- `since` is the first day the default shoe is auto-assigned to runs that have no shoe, so old history keeps no shoe.
CREATE TABLE shoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT,
  default_for TEXT CHECK (default_for IS NULL OR default_for = 'run'),
  start_km REAL NOT NULL DEFAULT 0,   -- mileage before it was added here
  retire_km REAL NOT NULL DEFAULT 800,
  retired_on TEXT,
  notes TEXT,
  since TEXT NOT NULL
);
ALTER TABLE activities ADD COLUMN shoe_id INTEGER;
CREATE INDEX activities_shoe ON activities(shoe_id);
