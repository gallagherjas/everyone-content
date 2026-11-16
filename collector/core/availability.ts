import type { DatabaseSync } from 'node:sqlite';
import { AUTH_ERROR, COLLECTION_PROVIDERS, SCHEDULE_SCOPES, providerForScope, type CollectionProvider, type CollectionSchedules } from '../../lib/collection-schedule.ts';
import { loadAuth } from '../sources/douyin-index/client.ts';
import { loadSession } from '../sources/platform/session.ts';

export function connectionStatus(db: DatabaseSync, id: number, provider: string) {
  const row = db.prepare(`SELECT c.auth_path,p.error,p.paused,EXISTS(
    SELECT 1 FROM collection_tasks t
    JOIN collection_credentials same ON same.provider=t.provider AND same.scope=t.scope
    WHERE t.provider=c.provider AND (same.account_id=c.account_id OR c.provider='index' AND same.auth_path=c.auth_path)
    AND t.last_success_at IS NOT NULL
  ) verified FROM collection_credentials c LEFT JOIN collection_provider_state p ON p.provider=c.provider AND p.scope=c.scope
  WHERE c.account_id=? AND c.provider=?`).get(id, provider);
  let error = typeof row?.error === 'string' ? row.error : null;
  if (row && !AUTH_ERROR.test(error ?? '')) {
    try {
      const file = String(row.auth_path);
      if (provider === 'index') loadAuth(file, {});
      else loadSession(file);
    } catch (failure) {
      const code = (failure as Error).message;
      error = AUTH_ERROR.test(code) ? code : failure instanceof SyntaxError ? 'invalid_auth_cookie' : 'auth_required';
    }
  }
  return {
    status: !row ? 'missing' : AUTH_ERROR.test(error ?? '') ? 'expired' : row.verified ? 'verified' : 'configured',
    configured: !!row, paused: !!row?.paused, error,
  };
}

export function sourceBlocker(db: DatabaseSync, id: number, provider: CollectionProvider): string | null {
  const state = connectionStatus(db, id, provider);
  if (!state.configured) return 'auth_required';
  if (state.status === 'expired' || state.paused) return state.error ?? 'source_paused';
  return null;
}

export function collectionBlockers(db: DatabaseSync, id: number) {
  return Object.fromEntries(COLLECTION_PROVIDERS.map(provider => [provider, sourceBlocker(db, id, provider)])) as
    Record<CollectionProvider, string | null>;
}

export function availableProviders(db: DatabaseSync, id: number, only?: string, schedules?: CollectionSchedules) {
  const providers = only ? [providerForScope(only)] : COLLECTION_PROVIDERS;
  return new Set(providers.filter(provider => (!schedules ||
    SCHEDULE_SCOPES.some(scope => providerForScope(scope) === provider && schedules[scope]?.enabled))
    && !sourceBlocker(db, id, provider)));
}
