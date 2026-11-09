import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { indexConfig } from './config.mjs';
import { atomic } from './store.mjs';
import { loadAuth } from '../sources/douyin-index/client.mjs';
function activeAccount(db,id) {
  const a=db.prepare("SELECT * FROM accounts WHERE id=? AND status='active'").get(id);
  if(!a)throw new Error('必须明确指定一个启用的账号');return a;
}
export function configureIndex(store,accountId,file) {
  const db=store.db,a=activeAccount(db,accountId),input=JSON.parse(readFileSync(file,'utf8')),config=JSON.parse(a.config);
  config.index=indexConfig({discovery:input.discovery??null,tasks:input.tasks??[]});
  atomic(db,()=>{
    db.prepare('UPDATE accounts SET config=? WHERE id=?').run(JSON.stringify(config),accountId);
    for(const word of new Set([...(input.discovery?.seedKeywords??[]),...(input.tasks??[]).filter(t=>t.keyword).map(t=>t.keyword)]))
      db.prepare("INSERT OR IGNORE INTO account_sources(account_id,kind,source_key,name) VALUES(?,'keyword',?,?)").run(accountId,word,word);
  });
}
export function registerAuth(store,accountId,path) {
  activeAccount(store.db,accountId);const file=resolve(path);loadAuth(file,{});
  atomic(store.db,()=>{
    store.db.prepare(`INSERT INTO collection_credentials VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET auth_path=excluded.auth_path,scope=excluded.scope`)
      .run(accountId,file,`account:${accountId}`);
    store.db.prepare("UPDATE collection_provider_state SET paused=0,error=NULL WHERE provider='index' AND scope=?").run(`account:${accountId}`);
    store.db.prepare(`UPDATE collection_tasks SET next_run_at=0,error=NULL WHERE provider='index' AND scope=? AND disabled=0
      AND key IN(SELECT task_key FROM collection_task_accounts WHERE account_id=?)`).run(`account:${accountId}`,accountId);
  });
}
