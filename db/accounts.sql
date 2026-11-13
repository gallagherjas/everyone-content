CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'douyin',
  profile_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  config TEXT NOT NULL,
  strategy_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS account_initialization (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
  strategy_sha TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  initialized INTEGER NOT NULL CHECK(initialized IN (0,1)),
  missing_sections TEXT NOT NULL CHECK(json_valid(missing_sections))
);
CREATE TABLE IF NOT EXISTS account_sources (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  kind TEXT NOT NULL CHECK(kind IN ('keyword','blogger','blogger_search')),
  source_key TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','paused')),
  note TEXT NOT NULL DEFAULT '',
  options TEXT NOT NULL DEFAULT '',
  UNIQUE(account_id, kind, source_key)
);
CREATE TABLE IF NOT EXISTS account_works (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  work_id INTEGER NOT NULL REFERENCES works(id),
  reason TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(account_id, work_id)
);
CREATE TABLE IF NOT EXISTS task_runs (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  pid INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  log TEXT NOT NULL DEFAULT '',
  progress INTEGER
);
CREATE INDEX IF NOT EXISTS idx_task_runs_account ON task_runs(account_id, task, id);
CREATE TABLE IF NOT EXISTS content_snapshots (
  content_id INTEGER NOT NULL REFERENCES contents(id),
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  metrics TEXT NOT NULL,
  PRIMARY KEY(content_id, ts)
);
CREATE TABLE IF NOT EXISTS strategy_audit (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  action TEXT NOT NULL,
  sha TEXT NOT NULL,
  note TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 用户登记的已发布作品。
CREATE TABLE IF NOT EXISTS contents (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'published',
  published_url TEXT,
  published_at TEXT,
  strategy_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contents_account ON contents(account_id,status);
