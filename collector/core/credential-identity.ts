import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { PlatformIdentity } from '../sources/platform/identity.ts';

export function credentialVersion(file: string) {
  try {
    const { dev, ino, size, mtimeNs, ctimeNs } = statSync(file, { bigint: true });
    return { revision: [dev, ino, size, mtimeNs, ctimeNs].join(':'), modifiedAt: Number(mtimeNs / 1_000_000n) };
  } catch { return null; }
}

export function identityRecord(db: DatabaseSync, provider: string, file: string, revision: string) {
  return db.prepare(`SELECT platform_account_id id,nickname name,handle,checked_at
    FROM collection_credential_identities WHERE provider=? AND auth_path=? AND revision=?`).get(provider, file, revision) as
    (Omit<PlatformIdentity, 'id'> & { id: string | null; checked_at: number }) | undefined;
}

export function credentialIdentity(db: DatabaseSync, provider: string, file: string): PlatformIdentity | null {
  const version = credentialVersion(file);
  const row = version && identityRecord(db, provider, file, version.revision);
  return row?.id ? { id: row.id, name: row.name, handle: row.handle } : null;
}
