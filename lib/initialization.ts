import type { DatabaseSync } from 'node:sqlite';
import { InputError, type AccountConfig } from './accounts.ts';
import { PROFILE_SCHEMA_VERSION, PROFILE_SECTIONS, profileCompletion, type ProfileCompletion } from './profile.ts';
import { collectionKeywords } from '../collector/core/projection.ts';

export function recordInitialization(db: DatabaseSync, id: number, sha: string, markdown: string) {
  const state = profileCompletion(markdown);
  db.prepare(`INSERT INTO account_initialization(account_id,strategy_sha,schema_version,initialized,missing_sections)
    VALUES(?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET strategy_sha=excluded.strategy_sha,
    schema_version=excluded.schema_version,initialized=excluded.initialized,missing_sections=excluded.missing_sections`)
    .run(id, sha, PROFILE_SCHEMA_VERSION, Number(state.initialized), JSON.stringify(state.missing_sections));
  return state;
}

export function ensureInitialization(db: DatabaseSync, id: number, sha: string, read: () => string) {
  const row = db.prepare('SELECT strategy_sha,schema_version FROM account_initialization WHERE account_id=?').get(id);
  if (row?.strategy_sha !== sha || row?.schema_version !== PROFILE_SCHEMA_VERSION)
    recordInitialization(db, id, sha, read());
}

const profileState = `a.strategy_sha,i.strategy_sha checked_sha,i.schema_version,i.initialized,i.missing_sections`;
const accountProfiles = 'FROM accounts a LEFT JOIN account_initialization i ON i.account_id=a.id';
function completion(row: Record<string, unknown>): ProfileCompletion {
  if (!row.strategy_sha || row.checked_sha !== row.strategy_sha || row.schema_version !== PROFILE_SCHEMA_VERSION)
    return { initialized: false, missing_sections: [...PROFILE_SECTIONS] };
  return { initialized: row.initialized === 1, missing_sections: JSON.parse(String(row.missing_sections)) };
}
export function initializationStatus(db: DatabaseSync, id: number) {
  const row = db.prepare(`SELECT ${profileState} ${accountProfiles} WHERE a.id=?`).get(id);
  if (!row) throw new InputError('账号不存在，请重新选择', 404);
  return completion(row);
}

// 日常入口仅查SQLite，不读取画像、Git、Skill或采集响应。
export function initializationOverview(db: DatabaseSync) {
  const rows = db.prepare(`SELECT a.id,a.name,a.status,a.config,${profileState},
    EXISTS(SELECT 1 FROM collection_credentials c WHERE c.account_id=a.id) index_auth_configured
    ${accountProfiles} ORDER BY a.id`).all();
  return { app: 'everyone-content', accounts: rows.map(row => {
    const profile = completion(row);
    const index = (JSON.parse(String(row.config)) as Partial<AccountConfig>).index;
    const indexAuthConfigured = row.index_auth_configured === 1;
    const missing = [];
    if (row.status !== 'active') missing.push('active_account');
    if (!profile.initialized) missing.push('profile');
    if (!indexAuthConfigured) missing.push('index_auth');
    if (!collectionKeywords(db, Number(row.id), index?.tasks).length) missing.push('keywords');
    if (index?.discovery == null) missing.push('collection_config');
    return {
      account_id: row.id, name: row.name, status: row.status, strategy_sha: row.strategy_sha,
      ...profile, index_auth_configured: indexAuthConfigured,
      setup: { complete: missing.length === 0, missing },
    };
  }) };
}
