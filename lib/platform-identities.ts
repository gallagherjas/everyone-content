import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { loadAuth } from '../collector/sources/douyin-index/client.ts';
import { loadSession } from '../collector/sources/platform/session.ts';
import { fetchPlatformIdentity, type PlatformIdentity } from '../collector/sources/platform/identity.ts';
import { credentialBinding } from '../collector/core/settings.ts';
import type { CollectionProvider } from './collection-schedule.ts';
import { connectionStatus } from '../collector/core/availability.ts';

function credentialRevision(file: string) {
  try {
    const { dev, ino, size, mtimeNs, ctimeNs } = statSync(file, { bigint: true });
    return [dev, ino, size, mtimeNs, ctimeNs].join(':');
  } catch { return null; }
}

function identityRecord(db: DatabaseSync, provider: CollectionProvider, file: string, revision: string) {
  return db.prepare(`SELECT platform_account_id id,nickname name,handle,checked_at
    FROM collection_credential_identities WHERE provider=? AND auth_path=? AND revision=?`).get(provider, file, revision) as
    (Omit<PlatformIdentity, 'id'> & { id: string | null; checked_at: number }) | undefined;
}

export function credentialIdentity(db: DatabaseSync, provider: CollectionProvider, file: string): PlatformIdentity | null {
  const revision = credentialRevision(file);
  const row = revision && identityRecord(db, provider, file, revision);
  return row && row.id ? { id: row.id, name: row.name, handle: row.handle } : null;
}

function recordIdentity(db: DatabaseSync, provider: CollectionProvider, file: string, revision: string, identity: PlatformIdentity | null) {
  db.prepare(`INSERT INTO collection_credential_identities VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(provider,auth_path) DO UPDATE SET revision=excluded.revision,
    platform_account_id=excluded.platform_account_id,nickname=excluded.nickname,handle=excluded.handle,checked_at=excluded.checked_at`)
    .run(provider, file, revision, identity?.id ?? null, identity?.name ?? null, identity?.handle ?? null, Date.now());
}

export function copyCredentialIdentity(db: DatabaseSync, provider: CollectionProvider, from: string, to: string) {
  const identity = credentialIdentity(db, provider, from), revision = credentialRevision(to);
  if (identity && revision) recordIdentity(db, provider, to, revision, identity);
}

export function removeUnusedCredentialIdentities(db: DatabaseSync) {
  db.exec(`DELETE FROM collection_credential_identities AS i WHERE NOT EXISTS (
    SELECT 1 FROM collection_credentials c WHERE c.provider=i.provider AND c.auth_path=i.auth_path
  )`);
}

const lookups = new Map<string, Promise<void>>();
const FAILED_RETRY_MS = 60_000;

export async function resolveCredentialIdentity(db: DatabaseSync, accountId: number, provider: CollectionProvider,
  identify = fetchPlatformIdentity) {
  const credential = credentialBinding(db, accountId, provider);
  if (!credential) return;
  const file = credential.auth_path, revision = credentialRevision(file);
  if (!revision) return;
  const cached = identityRecord(db, provider, file, revision);
  if (cached?.id || cached && Date.now() - cached.checked_at < FAILED_RETRY_MS) return;
  const state = connectionStatus(db, accountId, provider);
  if (state.status === 'expired') return;

  const key = JSON.stringify([provider, file, revision]);
  const pending = lookups.get(key);
  if (pending) return pending;
  const read = async () => {
    let auth;
    try { auth = provider === 'index' ? loadAuth(file, {}) : loadSession(file); }
    catch { return; }
    const identity = await identify(provider, auth).catch(() => null);
    if (revision === credentialRevision(file) &&
      db.prepare('SELECT 1 FROM collection_credentials WHERE provider=? AND auth_path=?').get(provider, file))
      recordIdentity(db, provider, file, revision, identity);
  };
  const work = read().finally(() => lookups.delete(key));
  lookups.set(key, work);
  await work;
}
