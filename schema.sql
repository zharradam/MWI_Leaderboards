-- One row per leaderboard per scrape; rows holds the leaderboard's player rows as JSON.
-- Keeps D1 free-tier writes tiny (~36 rows per run instead of ~3,600).
CREATE TABLE IF NOT EXISTS snapshots (
  type       TEXT NOT NULL,
  category   TEXT NOT NULL,
  fetched_at TEXT NOT NULL, -- ISO 8601 UTC
  rows       TEXT NOT NULL, -- JSON: [[name, totalXp], ...] in rank order
  PRIMARY KEY (type, category, fetched_at)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS snapshots_fetched_at ON snapshots (fetched_at);
