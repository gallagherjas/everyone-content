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
import { DOUYIN_PROFILE_URL, douyinAccountName } from '../collector/sources/platform/snapshot.ts';

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
  } catch (error) {
    removeUnusedIndexSession(db, file, directory);
    throw error;
  }
  removeUnusedIndexSession(db, previous, directory);
}

export async function reuseIndexSession(db: DatabaseSync, id: number, sourceId: number, directory = DATA,
  identify?: (auth: IndexAuth) => Promise<string | undefined>) {
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
    if (shared !== source.auth_path) {
      const auth = loadAuth(source.auth_path, {});
      auth.accountName ??= await identify?.(auth).catch(() => undefined);
      activeAccount(db, id);
      activeAccount(db, sourceId);
      writePrivateAuth(shared, auth);
    }
    atomic(db, () => {
      db.prepare("UPDATE collection_credentials SET auth_path=? WHERE provider='index' AND auth_path=?").run(shared, source.auth_path);
      const scope = bindCredential(db, id, 'index', shared);
      resumeSource(db, id, 'index', scope, true);
    });
  } catch (error) {
    if (shared !== source.auth_path) removeUnusedIndexSession(db, shared, directory);
    throw error;
  }
  if (shared !== source.auth_path) removeUnusedIndexSession(db, source.auth_path, directory);
  removeUnusedIndexSession(db, previous, directory);
}

export async function identifyIndexAccount(auth: IndexAuth): Promise<string | undefined> {
  const response = await fetch(DOUYIN_PROFILE_URL, {
    headers: { cookie: auth.cookie, referer: new URL('/', DOUYIN_PROFILE_URL).href,
      ...(auth.userAgent ? { 'user-agent': auth.userAgent } : {}) },
    redirect: 'error', signal: AbortSignal.timeout(4000),
  });
  if (response.ok) return douyinAccountName(await response.json());
  await response.body?.cancel();
}

export function indexSessionDetails(db: DatabaseSync, id: number) {
  const bindings = db.prepare(`SELECT a.id,a.name,a.status,c.auth_path FROM collection_credentials c
    JOIN accounts a ON a.id=c.account_id WHERE c.provider='index' ORDER BY a.id`).all() as
    { id: number; name: string; status: string; auth_path: string }[];
  const current = bindings.find(row => row.id === id);
  const accountNameFor = (file: string) => {
    try { return loadAuth(file, {}).accountName ?? null; }
    catch { return null; }
  };
  const used = new Set<string>();
  const reuseAccounts = bindings.flatMap(row => {
    if (row.status !== 'active' || row.auth_path === current?.auth_path || used.has(row.auth_path) || sourceBlocker(db, row.id, 'index')) return [];
    used.add(row.auth_path);
    return [{ id: row.id, name: row.name, account_name: accountNameFor(row.auth_path) }];
  });
  return {
    account_name: current ? accountNameFor(current.auth_path) : null,
    session_accounts: current ? bindings.filter(row => row.auth_path === current.auth_path).map(row => row.name) : [],
    reuse_accounts: reuseAccounts,
  };
}
