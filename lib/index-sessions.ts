import type { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA } from './strategies.ts';
import { activeAccount, InputError } from './accounts.ts';
import { CollectionStore, atomic } from '../collector/core/store.ts';
import { sourceBlocker } from '../collector/core/availability.ts';
import { bindCredential, credentialBinding, registerAuth, resumeSource } from '../collector/core/settings.ts';
import { loadAuth, type IndexAuth } from '../collector/sources/douyin-index/client.ts';
import { writePrivateAuth } from '../collector/sources/platform/session.ts';
import { platformAccountLabel } from '../collector/sources/platform/identity.ts';
import { credentialIdentity } from '../collector/core/credential-identity.ts';
import { copyCredentialIdentity, removeUnusedCredentialIdentities } from './platform-identities.ts';

const sessionFolder = (directory: string) => join(directory, 'authorization', 'index-sessions');
const managedFile = (file: string, directory: string) => dirname(dirname(file)) === sessionFolder(directory)
  && /^[a-f0-9-]{36}$/.test(basename(dirname(file)))
  && file === join(dirname(file), 'index.json');
const newSessionFile = (directory: string) => join(sessionFolder(directory), randomUUID(), 'index.json');

export function removeUnusedIndexSession(db: DatabaseSync, file?: string, directory = DATA) {
  if (!file || db.prepare('SELECT 1 FROM collection_credentials WHERE auth_path=?').get(file)) return;
  if (managedFile(file, directory)) rmSync(dirname(file), { recursive: true, force: true });
  else if (dirname(dirname(file)) === join(directory, 'authorization') && /^\d+$/.test(basename(dirname(file)))
    && file === join(dirname(file), 'index.json'))
    rmSync(file, { force: true });
}

export function saveIndexSession(db: DatabaseSync, id: number, auth: IndexAuth, directory = DATA) {
  const previous = credentialBinding(db, id, 'index')?.auth_path;
  const file = newSessionFile(directory);
  try {
    writePrivateAuth(file, auth);
    registerAuth(new CollectionStore(db, directory), id, file);
    removeUnusedCredentialIdentities(db);
  } catch (error) {
    removeUnusedIndexSession(db, file, directory);
    throw error;
  }
  removeUnusedIndexSession(db, previous, directory);
}

export function reuseIndexSession(db: DatabaseSync, id: number, sourceId: number, directory = DATA) {
  activeAccount(db, id);
  if (sourceId === id) throw new InputError('请选择其他帐号');
  activeAccount(db, sourceId);
  const source = credentialBinding(db, sourceId, 'index');
  if (!source || sourceBlocker(db, sourceId, 'index'))
    throw new InputError('所选帐号的抖音指数会话当前不可用。', 409);
  const previous = credentialBinding(db, id, 'index')?.auth_path;
  if (previous === source.auth_path) return;
  const shared = managedFile(source.auth_path, directory) ? source.auth_path : newSessionFile(directory);
  try {
    if (shared !== source.auth_path) writePrivateAuth(shared, loadAuth(source.auth_path, {}));
    atomic(db, () => {
      db.prepare("UPDATE collection_credentials SET auth_path=? WHERE provider='index' AND auth_path=?").run(shared, source.auth_path);
      const scope = bindCredential(db, id, 'index', shared);
      resumeSource(db, id, 'index', scope, true);
      if (shared !== source.auth_path) copyCredentialIdentity(db, 'index', source.auth_path, shared);
      removeUnusedCredentialIdentities(db);
    });
  } catch (error) {
    if (shared !== source.auth_path) removeUnusedIndexSession(db, shared, directory);
    throw error;
  }
  if (shared !== source.auth_path) removeUnusedIndexSession(db, source.auth_path, directory);
  removeUnusedIndexSession(db, previous, directory);
}

export function indexSessionDetails(db: DatabaseSync, id: number) {
  const bindings = db.prepare(`SELECT a.id,a.name,a.status,c.auth_path FROM collection_credentials c
    JOIN accounts a ON a.id=c.account_id WHERE c.provider='index' ORDER BY a.id`).all() as
    { id: number; name: string; status: string; auth_path: string }[];
  const current = bindings.find(row => row.id === id);
  const used = new Set<string>();
  const reuseAccounts = bindings.flatMap(row => {
    if (row.status !== 'active' || row.auth_path === current?.auth_path || used.has(row.auth_path) || sourceBlocker(db, row.id, 'index')) return [];
    used.add(row.auth_path);
    return [{ id: row.id, name: row.name, account_name: platformAccountLabel(credentialIdentity(db, 'index', row.auth_path)) }];
  });
  return {
    session_accounts: current ? bindings.filter(row => row.auth_path === current.auth_path).map(row => row.name) : [],
    reuse_accounts: reuseAccounts,
  };
}
