import type { DatabaseSync } from 'node:sqlite';
import { atomic,hash, type CollectionStore } from './store.ts';
import { rebuildAccount } from './projection.ts';

const DAY=86400000;
export interface PlanOptions { accountIds?: number[]; scheduled?: boolean; now?: number }
export function collectionAccounts(db: DatabaseSync,{accountIds,scheduled=false}:{accountIds?: number[];scheduled?: boolean}={}): any[] {
  return (db.prepare("SELECT * FROM accounts WHERE status='active' ORDER BY id").all() as any[]).map(a=>({...a,config:JSON.parse(a.config)}))
    .filter(a=>(!accountIds||accountIds.includes(a.id))&&(!scheduled||Object.values<any>(a.config.schedules).some(s=>s.enabled)))
    .map(a=>({...a,configSha:hash({index:a.config.index,strategy:a.strategy_sha})}));
}
export function planCollection(store: CollectionStore,options: PlanOptions={}): any[] {
  const db=store.db,now=options.now??Date.now(),accounts=collectionAccounts(db,options);
  atomic(db,()=>{
    for(const a of accounts) {
      db.prepare('DELETE FROM collection_task_accounts WHERE account_id=?').run(a.id);
      const cred=db.prepare('SELECT * FROM collection_credentials WHERE account_id=? AND provider=?').get(a.id,'index') as any;
      if(cred) {
        const discovery=rebuildAccount(store,a);
        const datesRun=store.latest(store.queue('index',cred.scope,{type:'topic_dates'},[a],{interval:DAY,priority:100}).key);
        const dates=datesRun?store.data(datesRun):null;
        for(const spec of discovery.tasks()) {
          const task=store.queue('index',cred.scope,spec,[a],{interval:DAY,priority:spec.type==='topic_search'?30:spec.type==='videos'?20:10});
          const version=spec.type==='topic_relation'?dates?.valid_week:dates?.valid_day;
          const previous=store.latest(task.key);
          if(version&&previous&&previous.version!==version&&!task.error)
            db.prepare('UPDATE collection_tasks SET next_run_at=MIN(next_run_at,?) WHERE key=?').run(now,task.key);
        }
      }
      // 创作后台快照:各平台独立凭证,登记了哪个平台就排哪个,每天一次账号级快照。
      for(const provider of ['douyin','xhs','bili']) {
        const platform=db.prepare('SELECT * FROM collection_credentials WHERE account_id=? AND provider=?').get(a.id,provider) as any;
        if(platform)store.queue(provider,platform.scope,{type:'account_snapshot'},[a],{interval:DAY,priority:50});
      }
    }
  });
  return accounts;
}
