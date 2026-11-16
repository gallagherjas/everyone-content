import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { BEIJING_OFFSET_MS, COLLECTION_DAY_MS, collectionDay, nextCollectionDay, parseCollectionDay } from '../lib/time.ts';

function migrateBeijingDays(db: DatabaseSync) {
  const offset = BEIJING_OFFSET_MS / 1000;
  db.prepare(`UPDATE collection_requests SET day=date(at_ms/1000.0+?, 'unixepoch')
    WHERE day<>date(at_ms/1000.0+?, 'unixepoch')`).run(offset,offset);

  const runs = db.prepare(`SELECT r.id,r.task_key,r.provider,r.scope,r.status,r.version,r.at_ms,t.last_success_at
    FROM collection_runs r LEFT JOIN collection_tasks t ON t.last_success_id=r.id AND t.key=r.task_key
    WHERE r.status IN ('ok','cached') AND (r.operation='account_snapshot' OR r.operation IN ('topic_dates','author_dates'))
    ORDER BY r.id`).all();
  const savedVersions = new Map<string,string>();
  const versionRun = db.prepare('UPDATE collection_runs SET version=? WHERE id=?');
  const versionObservation = db.prepare("UPDATE collection_observations SET effective_at=? WHERE run_id=? AND kind='account'");
  for (const run of runs) {
    const key = JSON.stringify([run.task_key,run.provider,run.scope,run.version]);
    const version = run.status==='ok' ? collectionDay(Number(run.last_success_at??run.at_ms)) : savedVersions.get(key);
    if (!version) continue;
    if (run.status==='ok') savedVersions.set(key,version);
    if (version===run.version) continue;
    versionRun.run(version,run.id);
    if (run.provider!=='index') versionObservation.run(version,run.id);
  }

  // 只迁移旧换日边界生成的计划，按原成功或额度耗尽记录确定新的日期。
  const tasks = db.prepare(`SELECT t.key,t.error,r.at_ms,r.version,r.operation,
      CASE WHEN t.last_success_id=r.id THEN t.last_success_at END last_success_at
    FROM collection_tasks t JOIN collection_runs r ON r.id=(
      SELECT id FROM collection_runs WHERE task_key=t.key
        AND ((t.error IS NULL AND status IN ('ok','cached')) OR status='deferred' AND error=t.error)
      ORDER BY id DESC LIMIT 1
    ) WHERE t.next_run_at>0 AND t.next_run_at%?=0 AND t.disabled=0 AND t.lease_until<=?
      AND (t.error IS NULL OR t.error='daily_budget_exhausted')`).all(COLLECTION_DAY_MS,Date.now());
  const reschedule = db.prepare('UPDATE collection_tasks SET next_run_at=? WHERE key=?');
  for (const task of tasks) {
    const version = String(task.version??'');
    const at = !task.error && (task.operation==='account_snapshot'||task.operation==='topic_dates'||task.operation==='author_dates')
      && /^\d{4}-\d{2}-\d{2}$/.test(version) ? parseCollectionDay(version) : Number(task.last_success_at??task.at_ms);
    if (Number.isFinite(at)) reschedule.run(nextCollectionDay(at),task.key);
  }
}

export function migrate(db: DatabaseSync, _filename: string) {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (version === 9) return;
  if (![0, 1, 2, 3, 4, 5, 6, 7, 8].includes(version)) throw new Error('数据库版本不兼容，请使用本项目的数据目录');
  db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE');
  try {
    // v4 及更早：跑基线建表并逐步升到 v4；v4 库只需追平 v5，避免重复执行 v3/v4 重建。
    if (version < 4) {
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
    }
    // v5：博主链路回归——kind 放开到 keyword/blogger/blogger_search，新增 options 存每博主采集开关。
    if (version < 5) db.exec(`CREATE TABLE account_sources_v5 (
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
    INSERT INTO account_sources_v5 SELECT id,account_id,kind,source_key,name,status,note,'' FROM account_sources;
    DROP TABLE account_sources;
    ALTER TABLE account_sources_v5 RENAME TO account_sources;`);
    // v6：成功后的滚动等待缩短至采集日边界，保留已经安排的提前复查和失败退避。
    if (version < 6) {
      const successful = db.prepare(`SELECT t.key,r.at_ms,r.version,r.provider FROM collection_tasks t
        JOIN collection_runs r ON r.id=t.last_success_id AND r.task_key=t.key
        WHERE t.disabled=0 AND t.error IS NULL AND t.lease_until<=? AND r.status='ok'`).all(Date.now());
      const reschedule = db.prepare('UPDATE collection_tasks SET next_run_at=? WHERE key=? AND next_run_at>?');
      for (const row of successful) {
        const version = String(row.version ?? '');
        const at = row.provider !== 'index' && /^\d{4}-\d{2}-\d{2}$/.test(version)
          ? Date.parse(version) : Number(row.at_ms);
        if (Number.isFinite(at)) {
          const next = (Math.floor(at/COLLECTION_DAY_MS)+1)*COLLECTION_DAY_MS;
          reschedule.run(next,row.key,next);
        }
      }
    }
    if (version < 7) migrateBeijingDays(db);
    // v8：从采集队列移除博主有效日期，保留历史查询记录。
    if (version < 8) db.exec(`DELETE FROM collection_task_accounts WHERE task_key IN (
      SELECT key FROM collection_tasks WHERE provider='index' AND operation='author_dates'
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS collection_credential_identities (
      provider TEXT NOT NULL,
      auth_path TEXT NOT NULL,
      revision TEXT NOT NULL,
      platform_account_id TEXT,
      nickname TEXT,
      handle TEXT,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY(provider,auth_path)
    ); PRAGMA user_version=9; COMMIT`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
