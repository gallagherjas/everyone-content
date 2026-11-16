import type { DatabaseSync } from 'node:sqlite';
import { credentialVersion, identityRecord } from './credential-identity.ts';

export const platformBudgetKey = (id: string) => `platform:${id}`;
export const sessionBudgetKey = (revision: string) => `session:${revision}`;

export function credentialBudgetKey(db: DatabaseSync, provider: string, file: string, version = credentialVersion(file)) {
  if (!version) return null;
  const id = identityRecord(db, provider, file, version.revision)?.id;
  return id ? platformBudgetKey(id) : sessionBudgetKey(version.revision);
}

export function dailyBudget(db: DatabaseSync, provider: string, key: string | null, day: string) {
  return db.prepare(`SELECT COALESCE(b.daily_limit,l.daily_limit) daily_limit,l.per_tick,
      (SELECT COUNT(*) FROM collection_requests WHERE provider=l.provider AND budget_key=? AND day=?) used
    FROM collection_limits l LEFT JOIN collection_daily_limits b ON b.provider=l.provider AND b.budget_key=?
    WHERE l.provider=?`).get(key, day, key, provider) as
    { daily_limit: number; per_tick: number; used: number };
}

export function moveSessionBudget(db: DatabaseSync, provider: string, revision: string, key: string) {
  const previous = sessionBudgetKey(revision);
  if (previous === key) return;
  db.prepare('UPDATE collection_requests SET budget_key=? WHERE provider=? AND budget_key=?').run(key, provider, previous);
  db.prepare(`INSERT INTO collection_daily_limits(provider,budget_key,daily_limit,updated_at)
    SELECT provider,?,daily_limit,updated_at FROM collection_daily_limits WHERE provider=? AND budget_key=?
    ON CONFLICT(provider,budget_key) DO UPDATE SET daily_limit=excluded.daily_limit,updated_at=excluded.updated_at
    WHERE excluded.updated_at>=collection_daily_limits.updated_at`).run(key, provider, previous);
  db.prepare('DELETE FROM collection_daily_limits WHERE provider=? AND budget_key=?').run(provider, previous);
}
