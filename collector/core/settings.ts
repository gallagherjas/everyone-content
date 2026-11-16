import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { indexConfig } from './config.ts';
import { atomic, type CollectionStore } from './store.ts';
import { loadAuth } from '../sources/douyin-index/client.ts';
import { loadSession } from '../sources/platform/session.ts';
function activeAccount(db: DatabaseSync,id: number): any {
  const a=db.prepare("SELECT * FROM accounts WHERE id=? AND status='active'").get(id) as any;
  if(!a)throw new Error('必须明确指定一个启用的账号');return a;
}
export function configureIndex(store: CollectionStore,accountId: number,file: string): void {
  const db=store.db,a=activeAccount(db,accountId),input=JSON.parse(readFileSync(file,'utf8')),config=JSON.parse(a.config);
  config.index=indexConfig({discovery:input.discovery??null,tasks:input.tasks??[]});
  atomic(db,()=>{
    db.prepare('UPDATE accounts SET config=? WHERE id=?').run(JSON.stringify(config),accountId);
    for(const word of new Set([...(input.discovery?.seedKeywords??[]),...(input.tasks??[]).filter((t: any)=>t.keyword).map((t: any)=>t.keyword)]))
      db.prepare("INSERT OR IGNORE INTO account_sources(account_id,kind,source_key,name) VALUES(?,'keyword',?,?)").run(accountId,word,word);
  });
}
export function registerAuth(store: CollectionStore,accountId: number,path: string,provider = 'index'): void {
  activeAccount(store.db,accountId);
  const db=store.db, file=resolve(path);
  if (provider === 'index') loadAuth(file, {});
  else loadSession(file);
  atomic(db,()=>{
    const previous = credentialBinding(db, accountId, provider);
    bindCredential(db, accountId, provider, file);
    if (provider === 'index') {
      if (previous) db.prepare("UPDATE collection_credentials SET auth_path=? WHERE provider='index' AND auth_path=?")
        .run(file, previous.auth_path);
      for (const row of db.prepare("SELECT account_id,scope FROM collection_credentials WHERE provider='index' AND auth_path=?").all(file))
        resumeSource(db, Number(row.account_id), provider, String(row.scope), true);
    } else {
      resumeSource(db, accountId, provider, `account:${accountId}`, true);
    }
  });
}

export function credentialBinding(db: DatabaseSync, accountId: number, provider: string) {
  return db.prepare('SELECT auth_path,scope FROM collection_credentials WHERE account_id=? AND provider=?').get(accountId, provider) as
    { auth_path: string; scope: string } | undefined;
}

export function bindCredential(db: DatabaseSync, accountId: number, provider: string, file: string) {
  const scope = `account:${accountId}`;
  db.prepare(`INSERT INTO collection_credentials VALUES(?,?,?,?) ON CONFLICT(account_id,provider) DO UPDATE SET auth_path=excluded.auth_path,scope=excluded.scope`)
    .run(accountId, provider, file, scope);
  return scope;
}

export function resumeSource(db: DatabaseSync, accountId: number, provider: string, scope: string, reconnected = false) {
  atomic(db, () => {
    db.prepare('UPDATE collection_provider_state SET paused=0,error=NULL WHERE provider=? AND scope=?').run(provider,scope);
    db.prepare(`UPDATE collection_tasks SET next_run_at=0,error=NULL,disabled=0,failures=0,lease_owner=NULL,lease_until=0
      ${reconnected ? ',last_success_at=NULL,last_success_id=NULL' : ''}
      WHERE provider=? AND scope=? AND key IN(SELECT task_key FROM collection_task_accounts WHERE account_id=?)`)
      .run(provider,scope,accountId);
  });
}
