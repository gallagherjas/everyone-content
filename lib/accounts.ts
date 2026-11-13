import type { DatabaseSync } from 'node:sqlite';
import { indexConfig } from '../collector/core/config.ts';
import type { CollectionPolicy } from '../collector/core/discovery.ts';
import { defaultSchedules, validateSchedules, type CollectionSchedules } from './collection-schedule.ts';

export class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export interface AccountConfig {
  schedules: CollectionSchedules;
  index: {
    discovery: CollectionPolicy | null;
    tasks: { type: string; id?: string; keyword?: string; name?: string }[];
  };
}
export interface Account {
  id: number;
  name: string;
  platform: string;
  profile_url: string;
  status: 'active' | 'archived';
  config: AccountConfig;
  strategy_sha: string | null;
  created_at: string;
}
export interface Source {
  id: number;
  account_id: number;
  kind: 'keyword';
  source_key: string;
  name: string;
  status: string;
  note: string;
}
export function account(db: DatabaseSync, id: number): Account {
  const r = db.prepare('SELECT * FROM accounts WHERE id=?').get(id) as
    | (Omit<Account, 'config'> & { config: string })
    | undefined;
  if (!r) throw new InputError('账号不存在，请重新选择', 404);
  // 旧账号配置缺新来源的键：读取时补默认定时，保存时经 validateConfig 落全。
  const config = JSON.parse(r.config);
  return { ...r, config: { ...config, schedules: { ...defaultSchedules(), ...config.schedules } } };
}
export function activeAccount(db: DatabaseSync, id: number) {
  const a = account(db, id);
  if (a.status !== 'active') throw new InputError('该账号已归档，请先恢复', 409);
  return a;
}
export function listAccounts(db: DatabaseSync): Account[] {
  return (db.prepare('SELECT id FROM accounts ORDER BY id').all() as { id: number }[]).map((r) =>
    account(db, r.id),
  );
}
export function sources(db: DatabaseSync, id: number): Source[] {
  return db
    .prepare('SELECT * FROM account_sources WHERE account_id=? ORDER BY id')
    .all(id) as unknown as Source[];
}
export function validateConfig(value: unknown): AccountConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('配置格式无效');
  const cfg = value as AccountConfig;
  let schedules: CollectionSchedules;
  try { schedules = validateSchedules(cfg.schedules); }
  catch (error) { throw new InputError((error as Error).message); }
  let index;
  try {
    index = indexConfig(cfg.index);
  } catch {
    throw new InputError('指数配置无效：话题最多5个、点赞至少100，请检查关键词和数量上限。');
  }
  return {
    schedules,
    index,
  };
}
export function createAccount(db: DatabaseSync, name: unknown) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
    throw new InputError('账号名称须为 1–80 字');
  // 新账号默认不开启采集，先配置关键词，再由用户启用。
  const config: AccountConfig = { schedules: defaultSchedules(), index: { discovery: null, tasks: [] } };
  const id = Number(
    db
      .prepare('INSERT INTO accounts(name,config) VALUES(?,?)')
      .run(name.trim(), JSON.stringify(config)).lastInsertRowid,
  );
  return account(db, id);
}
export function linkWork(db: DatabaseSync, accountId: number, workId: number, reason: string) {
  db.prepare(`INSERT OR IGNORE INTO account_works(account_id,work_id,reason)
    SELECT ?,id,? FROM works WHERE id=?`).run(accountId, reason, workId);
}
export function matchKeywords(db: DatabaseSync, a: Account) {
  for (const s of sources(db, a.id).filter(s => s.kind === 'keyword' && s.status === 'ready'))
    db.prepare(`INSERT OR IGNORE INTO account_works(account_id,work_id,reason)
      SELECT ?,id,? FROM works WHERE instr(lower(COALESCE(title,'')),lower(?))>0
      AND EXISTS(SELECT 1 FROM account_works aw WHERE aw.work_id=works.id AND aw.account_id=?)`)
      .run(a.id, `keyword:${s.name}`, s.source_key, a.id);
}
