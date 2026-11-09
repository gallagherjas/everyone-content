CREATE TABLE IF NOT EXISTS collection_limits (
  provider TEXT PRIMARY KEY CHECK(provider='index'),
  daily_limit INTEGER NOT NULL,
  interval_ms INTEGER NOT NULL,
  per_tick INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_schedule_runs (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  provider TEXT NOT NULL CHECK(provider='index'),
  scheduled_at TEXT NOT NULL,
  run_id INTEGER NOT NULL REFERENCES task_runs(id),
  PRIMARY KEY(account_id,provider,scheduled_at)
);
INSERT OR IGNORE INTO collection_limits VALUES ('index',30,2000,10);
CREATE TABLE IF NOT EXISTS collection_credentials (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
  auth_path TEXT NOT NULL,
  scope TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_provider_state (
  provider TEXT NOT NULL CHECK(provider='index'),
  scope TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  last_request_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(provider,scope)
);
CREATE TABLE IF NOT EXISTS collection_tasks (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider='index'),
  scope TEXT NOT NULL,
  operation TEXT NOT NULL,
  target TEXT NOT NULL,
  spec TEXT NOT NULL,
  priority REAL NOT NULL DEFAULT 1,
  interval_ms INTEGER NOT NULL,
  next_run_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  last_success_at INTEGER,
  last_success_id INTEGER,
  failures INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  disabled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS collection_due ON collection_tasks(disabled,next_run_at,lease_until);
CREATE TABLE IF NOT EXISTS collection_task_accounts (
  task_key TEXT NOT NULL REFERENCES collection_tasks(key),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  config_sha TEXT NOT NULL,
  PRIMARY KEY(task_key,account_id)
);
CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY,
  task_key TEXT REFERENCES collection_tasks(key),
  provider TEXT NOT NULL CHECK(provider='index'),
  scope TEXT NOT NULL,
  operation TEXT NOT NULL,
  target TEXT NOT NULL,
  request TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  version TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  data_path TEXT,
  data_sha TEXT,
  semantic_hash TEXT,
  changed INTEGER,
  error TEXT,
  source_key TEXT UNIQUE,
  parser_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS collection_history ON collection_runs(task_key,at_ms);
CREATE TABLE IF NOT EXISTS collection_run_accounts (
  run_id INTEGER NOT NULL REFERENCES collection_runs(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  config_sha TEXT NOT NULL,
  PRIMARY KEY(run_id,account_id)
);
CREATE TABLE IF NOT EXISTS collection_requests (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES collection_runs(id),
  provider TEXT NOT NULL CHECK(provider='index'),
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  parameters TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'reserved',
  http_status INTEGER,
  encryption TEXT,
  raw_path TEXT,
  raw_sha TEXT,
  error TEXT,
  source_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS collection_budget ON collection_requests(provider,day);
CREATE TABLE IF NOT EXISTS collection_topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS collection_author_ids (
  namespace TEXT NOT NULL,
  external_id TEXT NOT NULL,
  author_id INTEGER REFERENCES authors(id),
  evidence_run_id INTEGER REFERENCES collection_runs(id),
  PRIMARY KEY(namespace,external_id)
);
CREATE TABLE IF NOT EXISTS collection_observations (
  run_id INTEGER NOT NULL REFERENCES collection_runs(id),
  kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  effective_at TEXT,
  window TEXT,
  metrics TEXT NOT NULL,
  PRIMARY KEY(run_id,kind,object_id,dimension)
);
