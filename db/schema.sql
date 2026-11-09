-- 抖音指数作品、作者和指标事实。

PRAGMA journal_mode = WAL;

-- 作者资料
CREATE TABLE IF NOT EXISTS authors (
  id             INTEGER PRIMARY KEY,
  platform       TEXT NOT NULL DEFAULT 'douyin',
  author_id      TEXT NOT NULL,                -- sec_uid
  name           TEXT,
  follower_count INTEGER,
  last_seen_at   TEXT,
  UNIQUE(platform, author_id)
);

-- 外部作品
CREATE TABLE IF NOT EXISTS works (
  id            INTEGER PRIMARY KEY,
  platform      TEXT NOT NULL DEFAULT 'douyin',
  author_id     TEXT,                          -- sec_uid
  url           TEXT NOT NULL UNIQUE,
  title         TEXT,
  published_at  TEXT,                          -- 作品发布时间
  reason        TEXT,                          -- 入库原因:采集来源
  status        TEXT NOT NULL DEFAULT 'live',  -- live | gone(下架/私密)
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_works_status ON works(status);

-- 作品时序快照
CREATE TABLE IF NOT EXISTS snapshots (
  work_id  INTEGER NOT NULL REFERENCES works(id),
  ts       TEXT NOT NULL DEFAULT (datetime('now')),
  metrics  TEXT NOT NULL,                      -- JSON: {views,likes,comments,shares,collects}
  source TEXT NOT NULL DEFAULT 'index',
  capture_id INTEGER REFERENCES collection_runs(id),
  metric_at TEXT,
  PRIMARY KEY (work_id, ts)
);
