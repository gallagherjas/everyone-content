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
