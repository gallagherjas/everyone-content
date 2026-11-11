import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function migrate(db: DatabaseSync, _filename: string) {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (version === 3) return;
  if (![0, 1, 2].includes(version)) throw new Error('数据库版本不兼容，请使用本项目的数据目录');
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
    db.exec('PRAGMA user_version=3; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
