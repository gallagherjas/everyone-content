import { atomic,hash } from './store.mjs';
import { rebuildAccount } from './projection.mjs';

const DAY=86400000;
export function collectionAccounts(db,{accountIds,scheduled=false}={}) {
  return db.prepare("SELECT * FROM accounts WHERE status='active' ORDER BY id").all().map(a=>({...a,config:JSON.parse(a.config)}))
    .filter(a=>(!accountIds||accountIds.includes(a.id))&&(!scheduled||a.config.schedules.index.enabled))
    .map(a=>({...a,configSha:hash({index:a.config.index,strategy:a.strategy_sha})}));
}
export function planCollection(store,options={}) {
  const db=store.db,now=options.now??Date.now(),accounts=collectionAccounts(db,options);
  atomic(db,()=>{
    for(const a of accounts) {
      db.prepare('DELETE FROM collection_task_accounts WHERE account_id=?').run(a.id);
      const cred=db.prepare('SELECT * FROM collection_credentials WHERE account_id=?').get(a.id);
      if(!cred)continue;
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
  });
  return accounts;
}
