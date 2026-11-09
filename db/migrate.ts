import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { defaultSchedules } from '../lib/collection-schedule.ts';

export const DEFAULT_CONFIG = {
  schedules: defaultSchedules(),
  index: { discovery: null, tasks: [] },
};

export function migrate(db: DatabaseSync, _filename: string) {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (version === 1) return;
  if (version !== 0) throw new Error('数据库版本不兼容，请使用本项目的数据目录');
  db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE');
  try {
    for (const name of ['schema.sql', 'accounts.sql', 'collection.sql'])
      db.exec(readFileSync(new URL(name, import.meta.url), 'utf8').replace('PRAGMA journal_mode = WAL;', ''));
    if (!db.prepare('SELECT 1 FROM accounts LIMIT 1').get())
      db.prepare('INSERT INTO accounts(name,config) VALUES(?,?)').run('默认账号', JSON.stringify(DEFAULT_CONFIG));
    db.exec('PRAGMA user_version=1; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
