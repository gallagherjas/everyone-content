import type { DatabaseSync } from 'node:sqlite';
import { atomic,hash,taskKey, type CollectionStore } from './store.ts';
import { rebuildAccount } from './projection.ts';
import { normalize,count } from './discovery.ts';
import { projectBloggers } from './bloggers.ts';

const DAY=86400000;
export interface PlanOptions { accountIds?: number[]; scheduled?: boolean; now?: number }
export function collectionAccounts(db: DatabaseSync,{accountIds,scheduled=false}:{accountIds?: number[];scheduled?: boolean}={}): any[] {
  return (db.prepare("SELECT * FROM accounts WHERE status='active' ORDER BY id").all() as any[]).map(a=>({...a,config:JSON.parse(a.config)}))
    .filter(a=>(!accountIds||accountIds.includes(a.id))&&(!scheduled||Object.values<any>(a.config.schedules).some(s=>s.enabled)))
    .map(a=>({...a,configSha:hash({index:a.config.index,strategy:a.strategy_sha})}));
}
export function bloggerOptions(raw: any): { core: boolean; info: boolean } {
  try { const o=JSON.parse(raw||'{}'); return { core: !!o.core, info: !!o.info }; }
  catch { return { core: false, info: false }; }
}
// 昵称搜索任务完成后把 blogger_search 转为正式 blogger 行；未命中的行转 paused 由用户处理。
function resolveSearches(db: DatabaseSync, a: any, scope: string, store: CollectionStore) {
  const rows=db.prepare("SELECT * FROM account_sources WHERE account_id=? AND kind='blogger_search'").all(a.id) as any[];
  for(const row of rows.filter(r=>r.status==='ready')){
    const run=store.latest(taskKey('index',scope,{type:'author_search',keyword:row.source_key}));
    if(!run||run.status!=='ok')continue;
    const want=normalize(row.source_key);
    const list=store.data(run).userlist??[];
    const name=(u: any)=>normalize(u.user_name);
    const hit=list.find((u: any)=>name(u)===want)??list.find((u: any)=>name(u).includes(want)||want.includes(name(u)));
    if(!hit){db.prepare("UPDATE account_sources SET status='paused',note='未找到该昵称的达人' WHERE id=?").run(row.id);continue;}
    const secUid=String(hit.aweme_url??'').match(/\/user\/(MS4wLjAB[\w-]+)/)?.[1]??null;
    const profile={secUid,fans:count(hit.follow_count),likes:count(hit.like_count),items:count(hit.item_count),tag1:hit.first_tag_name??null,tag2:hit.second_tag_name??null,avatar:hit.user_head_logo??null};
    atomic(db,()=>{
      db.prepare(`INSERT INTO account_sources(account_id,kind,source_key,name,note) VALUES(?,'blogger',?,?,?)
        ON CONFLICT(account_id,kind,source_key) DO UPDATE SET name=excluded.name,note=excluded.note`)
        .run(a.id,String(hit.user_id),String(hit.user_name),JSON.stringify(profile));
      db.prepare("DELETE FROM account_sources WHERE id=?").run(row.id);
    });
  }
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
        // 博主链路：先解析待搜索昵称，再按开关排任务；有博主才排达友域日期任务，避免空转额度。
        resolveSearches(db,a,cred.scope,store);
        const bloggers=db.prepare("SELECT * FROM account_sources WHERE account_id=? AND kind='blogger'").all(a.id) as any[];
        const pending=db.prepare("SELECT * FROM account_sources WHERE account_id=? AND kind='blogger_search' AND status='ready'").all(a.id) as any[];
        if(bloggers.length||pending.length){
          const authorDatesRun=store.latest(store.queue('index',cred.scope,{type:'author_dates'},[a],{interval:DAY,priority:100}).key);
          const authorDates=authorDatesRun?store.data(authorDatesRun):null;
          for(const s of pending)
            store.queue('index',cred.scope,{type:'author_search',keyword:s.source_key},[a],{interval:DAY,priority:40});
          for(const s of bloggers.filter(s=>s.status==='ready')){
            const opt=bloggerOptions(s.options);
            for(const [type,on] of [['author_works',true],['author_core',opt.core],['author_info',opt.info]] as const){
              if(!on)continue;
              const task=store.queue('index',cred.scope,{type,id:s.source_key},[a],{interval:DAY,priority:15});
              const previous=store.latest(task.key);
              if(authorDates?.datetime&&previous&&previous.version!==authorDates.datetime&&!task.error)
                db.prepare('UPDATE collection_tasks SET next_run_at=MIN(next_run_at,?) WHERE key=?').run(now,task.key);
            }
          }
          projectBloggers(store,a,cred.scope);
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
