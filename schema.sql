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

-- One row per hourly market read: the +0 order book totals of every item trading at 50M or more.
CREATE TABLE IF NOT EXISTS market (
  fetched_at TEXT PRIMARY KEY, -- ISO 8601 UTC
  rows       TEXT NOT NULL     -- JSON: [[itemHrid, listedQty, bestAsk, wantedQty, bestBid, avgPrice, volume, pricesAt], ...]
) WITHOUT ROWID;
