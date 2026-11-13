import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function migrate(db: DatabaseSync, _filename: string) {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (version === 4) return;
  if (![0, 1, 2, 3].includes(version)) throw new Error('数据库版本不兼容，请使用本项目的数据目录');
  db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE');
  try {
    for (const name of ['schema.sql', 'accounts.sql', 'collection.sql'])
      db.exec(readFileSync(new URL(name, import.meta.url), 'utf8').replace('PRAGMA journal_mode = WAL;', ''));
    // v3：移除博主采集源与作品时序快照；指标事实保留在collection_observations与content_snapshots。
    db.exec(`DROP TABLE IF EXISTS snapshots;
      CREATE TABLE account_sources_v3 (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        kind TEXT NOT NULL CHECK(kind='keyword'),
        source_key TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','paused')),
        note TEXT NOT NULL DEFAULT '',
        UNIQUE(account_id, kind, source_key)
      );
      INSERT INTO account_sources_v3 SELECT id,account_id,kind,source_key,name,status,note
        FROM account_sources WHERE kind='keyword' AND status IN ('ready','paused');
      DROP TABLE account_sources;
      ALTER TABLE account_sources_v3 RENAME TO account_sources;`);
    // v4：多平台采集——provider 约束放开，凭证按 (账号, 来源) 登记，seed 三个创作后台的预算。
    db.exec(`CREATE TABLE collection_limits_v4 (provider TEXT PRIMARY KEY, daily_limit INTEGER NOT NULL, interval_ms INTEGER NOT NULL, per_tick INTEGER NOT NULL);
      INSERT INTO collection_limits_v4 SELECT provider,daily_limit,interval_ms,per_tick FROM collection_limits;
      DROP TABLE collection_limits;
      ALTER TABLE collection_limits_v4 RENAME TO collection_limits;
      INSERT OR IGNORE INTO collection_limits VALUES
        ('index',30,2000,10),('douyin',10,3600000,1),('xhs',10,3600000,1),('bili',10,3600000,1);
      CREATE TABLE collection_schedule_runs_v4 (
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        provider TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        run_id INTEGER NOT NULL REFERENCES task_runs(id),
        PRIMARY KEY(account_id,provider,scheduled_at)
      );
      INSERT INTO collection_schedule_runs_v4 SELECT account_id,provider,scheduled_at,run_id FROM collection_schedule_runs;
      DROP TABLE collection_schedule_runs;
      ALTER TABLE collection_schedule_runs_v4 RENAME TO collection_schedule_runs;
      CREATE TABLE collection_provider_state_v4 (provider TEXT NOT NULL, scope TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0, error TEXT, last_request_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(provider,scope));
      INSERT INTO collection_provider_state_v4 SELECT provider,scope,paused,error,last_request_at FROM collection_provider_state;
      DROP TABLE collection_provider_state;
      ALTER TABLE collection_provider_state_v4 RENAME TO collection_provider_state;
      CREATE TABLE collection_credentials_v4 (
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        provider TEXT NOT NULL DEFAULT 'index',
        auth_path TEXT NOT NULL,
        scope TEXT NOT NULL,
        PRIMARY KEY(account_id,provider)
      );
      INSERT INTO collection_credentials_v4 SELECT account_id,'index',auth_path,scope FROM collection_credentials;
      DROP TABLE collection_credentials;
      ALTER TABLE collection_credentials_v4 RENAME TO collection_credentials;
      CREATE TABLE collection_tasks_v4 (
        key TEXT PRIMARY KEY, provider TEXT NOT NULL, scope TEXT NOT NULL, operation TEXT NOT NULL, target TEXT NOT NULL,
        spec TEXT NOT NULL, priority REAL NOT NULL DEFAULT 1, interval_ms INTEGER NOT NULL, next_run_at INTEGER NOT NULL DEFAULT 0,
        lease_until INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, last_success_at INTEGER, last_success_id INTEGER,
        failures INTEGER NOT NULL DEFAULT 0, error TEXT, disabled INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO collection_tasks_v4 SELECT key,provider,scope,operation,target,spec,priority,interval_ms,next_run_at,lease_until,lease_owner,last_success_at,last_success_id,failures,error,disabled FROM collection_tasks;
      DROP TABLE collection_tasks;
      ALTER TABLE collection_tasks_v4 RENAME TO collection_tasks;
      CREATE INDEX IF NOT EXISTS collection_due ON collection_tasks(disabled,next_run_at,lease_until);
      CREATE TABLE collection_runs_v4 (
        id INTEGER PRIMARY KEY, task_key TEXT REFERENCES collection_tasks(key), provider TEXT NOT NULL, scope TEXT NOT NULL,
        operation TEXT NOT NULL, target TEXT NOT NULL, request TEXT NOT NULL DEFAULT '{}', observed_at TEXT NOT NULL,
        at_ms INTEGER NOT NULL, version TEXT, status TEXT NOT NULL DEFAULT 'running', data_path TEXT, data_sha TEXT,
        semantic_hash TEXT, changed INTEGER, error TEXT, source_key TEXT UNIQUE, parser_version INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO collection_runs_v4 SELECT id,task_key,provider,scope,operation,target,request,observed_at,at_ms,version,status,data_path,data_sha,semantic_hash,changed,error,source_key,parser_version FROM collection_runs;
      DROP TABLE collection_runs;
      ALTER TABLE collection_runs_v4 RENAME TO collection_runs;
      CREATE INDEX IF NOT EXISTS collection_history ON collection_runs(task_key,at_ms);
      CREATE TABLE collection_requests_v4 (
        id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES collection_runs(id), provider TEXT NOT NULL, scope TEXT NOT NULL,
        day TEXT NOT NULL, at_ms INTEGER NOT NULL, endpoint TEXT NOT NULL, parameters TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'reserved', http_status INTEGER, encryption TEXT, raw_path TEXT, raw_sha TEXT,
        error TEXT, source_key TEXT UNIQUE
      );
      INSERT INTO collection_requests_v4 SELECT id,run_id,provider,scope,day,at_ms,endpoint,parameters,status,http_status,encryption,raw_path,raw_sha,error,source_key FROM collection_requests;
      DROP TABLE collection_requests;
      ALTER TABLE collection_requests_v4 RENAME TO collection_requests;
      CREATE INDEX IF NOT EXISTS collection_budget ON collection_requests(provider,day);`);
    db.exec('PRAGMA user_version=4; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
