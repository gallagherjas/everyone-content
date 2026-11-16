import { ReadClient,loadAuth } from '../sources/douyin-index/client.ts';
import { indexEffectiveVersion,requestFor,semanticHash,usesTopicDates } from '../sources/douyin-index/protocol.ts';
import { SNAPSHOT_PLATFORMS,snapshotExecute } from '../sources/platform/snapshot.ts';
import { atomic,freshSnapshots,taskKey,taskInScope,scheduledTaskEnabled, type CollectionStore } from './store.ts';
import { parseJson } from '../../lib/json.ts';
import { COLLECTION_SCOPES, type CollectionProvider } from '../../lib/collection-schedule.ts';
import { availableProviders } from './availability.ts';
import { credentialBinding } from './settings.ts';
import { credentialBudgetKey } from './budget.ts';
import { COLLECTION_DAY_MS, collectionDay, collectionDayStart, nextCollectionDay, parseCollectionDay } from '../../lib/time.ts';

import { planCollection } from './planner.ts';
const HOUR=3600000;
export function controlledError(error: any): string {
  if(['ECONNREFUSED','ENOTFOUND','EHOSTUNREACH'].includes(error?.cause?.code??error?.code))return 'service_unavailable';
  if(error?.message==='login_or_challenge_html')return 'login_required';
  const code=String(error?.message??'');
  return /^(daily_budget_exhausted|tick_budget_exhausted|source_paused|source_dates_missing|login_required|rate_limited|payment_required|schema_error|decode_error|unsupported_encryption|identity_conflict|auth_required|invalid_auth_cookie|invalid_user_agent|auth_file_must_be_private_0600|transport_error|service_unavailable|business_error|unexpected_html|invalid_response|http_error_\d+)$/.test(code)?code:error?.code==='SCHEMA_ERROR'?'schema_error':error?.code==='ENOENT'?'auth_required':'request_failed';
}
function transport(store: CollectionStore,run: any,counts: Record<string,number>,fetchImpl: typeof fetch,sleep: (ms: number)=>Promise<void>,clock: ()=>number,requestLimit: number=Infinity) {
  return async(input: any,init?: any): Promise<Response> => {
    const url=new URL(typeof input==='string'?input:input.url??String(input));
    const provider=run.provider;
    const limit=store.db.prepare('SELECT * FROM collection_limits WHERE provider=?').get(provider) as any;
    if(Object.values(counts).reduce((a,b)=>a+b,0)>=requestLimit)throw new Error('tick_budget_exhausted');
    if((counts[provider]??0)>=limit.per_tick)throw new Error('tick_budget_exhausted');
    const clean=(value: any): any=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!/cookie|authorization|token|password|session|a_bogus|signature|passport|csrf/i.test(key)).map(([key,v])=>[key,clean(v)])):value;
    let body:any=null;try{if(typeof init?.body==='string')body=clean(parseJson(init.body));}catch{}
    const parameters={method:init?.method??'GET',query:clean(Object.fromEntries(url.searchParams)),body};
    const slot=store.reserve(run,url.pathname,clock(),null,parameters);counts[provider]=(counts[provider]??0)+1;
    await sleep(slot.wait);
    try {
      const response=await fetchImpl(input,init);
      const text=/json|text/.test(response.headers.get('content-type')??'')?await response.clone().text():null;
      store.requestResult(slot.id,text,response.status,response.headers.get('x-encrypted'));return response;
    }catch(error){store.db.prepare("UPDATE collection_requests SET status='failed',error=? WHERE id=?").run(controlledError(error),slot.id);throw error;}
  };
}
async function execute(store: CollectionStore,run: any,client: any,clock: ()=>number): Promise<any> {
  if (run.provider !== 'index') return snapshotExecute(store,run,client,clock);
  const spec=JSON.parse(run.request);
  const credential=store.credentialForRun(run.id);
  const datesRun=usesTopicDates(spec.type)?store.latest(taskKey('index',run.scope,{type:'topic_dates'})):null;
  const version=indexEffectiveVersion(spec.type,collectionDay(run.at_ms),datesRun?store.data(datesRun):null);
  if(!version)throw new Error('source_dates_missing');
  if(spec.type!=='topic_dates'){
    const previous=store.latest(run.task_key);
    if(previous?.version===version)return {cached:previous,version};
  }
  const auth=loadAuth(credential?.auth_path,{});
  const req=requestFor(spec,version);
  const response=await new ReadClient(auth,{fetchImpl:client,intervalMs:1000,sleep:async()=>{}}).read(spec,req);
  return {data:response.data,version:spec.type==='topic_dates'?collectionDay(clock()):version,fingerprint:semanticHash(spec.type,response.data)};
}

export interface RunOptions {
  accountIds?: number[]; scheduled?: boolean; only?: string; retryTask?: string;
  requestLimit?: number; fetchImpl?: typeof fetch;
  clock?: () => number; sleep?: (ms: number) => Promise<void>;
  log?: (message: string, participants: number[]) => void;
  progress?: (percent: number) => void;
}
export async function runCollection(store: CollectionStore,options: RunOptions={}) {
  if(options.only&&!COLLECTION_SCOPES.includes(options.only))throw new Error('未知采集来源');
  const clock=options.clock??Date.now,sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms))),counts: Record<string,number>={};
  const accounts=planCollection(store,{...options,now:clock()}),ids=accounts.map(a=>a.id),served: Record<number,number>={};
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const providers = new Map(accounts.map(a => [a.id, availableProviders(store.db, a.id, options.only,
    options.scheduled && !options.only ? a.config.schedules : undefined)]));
  for(const a of accounts)served[a.id]=(store.db.prepare("SELECT COUNT(*) n FROM collection_run_accounts a JOIN collection_runs r ON r.id=a.run_id WHERE a.account_id=? AND r.at_ms>=?").get(a.id,collectionDayStart(clock())) as any).n;
  const visited=new Set<string>();
  const participantsFor = (task: any) => store.accounts(task.key).filter(a =>
    providers.get(a.id)?.has(task.provider as CollectionProvider) &&
    (!options.scheduled || options.only || scheduledTaskEnabled(accountById.get(a.id)?.config.schedules, task))).map(a => a.id);
  const retryTarget = options.retryTask
    ? store.db.prepare('SELECT provider,scope,operation FROM collection_tasks WHERE key=?').get(options.retryTask)
    : undefined;
  const prerequisite = retryTarget?.provider === 'index' && usesTopicDates(String(retryTarget.operation))
    ? taskKey('index', String(retryTarget.scope), { type: 'topic_dates' }) : undefined;
  const due=()=>{
    const tasks = store.dueTasks(ids, clock(), !!options.retryTask)
      .filter(task=>!visited.has(task.key)&&taskInScope(task,options.only)&&participantsFor(task).length);
    if (!options.retryTask) return tasks;
    return tasks.some(task => task.key === options.retryTask) ? tasks.filter(task =>
      task.key === options.retryTask || task.key === prerequisite) : [];
  };
  const compare=(a: any,b: any)=>{
    const fairness=(t: any)=>Math.min(...store.accounts(t.key).map((a: any)=>served[a.id]??0));
    const urgency=(t: any)=>t.priority+Math.log1p(Math.max(0,clock()-t.next_run_at)/HOUR);
    return Math.floor(b.priority/10)-Math.floor(a.priority/10)||fairness(a)-fairness(b)||urgency(b)-urgency(a)||a.next_run_at-b.next_run_at;
  };
  const exhausted=new Set<string>(),dailyExhausted=new Map<string,Set<string>>(),summary={completed:0,cached:0,failed:0,deferred:0,requests:counts,
    accounts:Object.fromEntries(ids.map(id=>[id,{completed:0,cached:0,failed:0,deferred:0}]))};
  // 点单个平台时展示当日缓存，已到换日的任务走正常领取与请求。
  if(!options.retryTask&&!options.scheduled&&options.only&&Object.hasOwn(SNAPSHOT_PLATFORMS,options.only)){
    const at=clock();
    for(const id of ids){
      if (!providers.get(id)?.has(options.only as CollectionProvider)) continue;
      const [snapshot]=freshSnapshots(store.db,id,at,options.only);
      if(!snapshot)continue;
      atomic(store.db,()=>{
        const run=store.begin(snapshot,at,null,[id]);
        store.reuse(run.id,snapshot.previous_id,snapshot.version);
      });
      visited.add(snapshot.key);
      summary.cached++;
      summary.accounts[id].cached++;
      options.log?.(`${snapshot.provider}/${snapshot.operation} ${snapshot.target}：复用有效版本`,[id]);
    }
  }
  let tasks=due(),done=0,total=tasks.length;
  let indexChanged=false;
  while(true) {
    if(!tasks.length){
      if(!indexChanged)break;
      indexChanged=false;
      planCollection(store,{...options,now:clock()});
      tasks=due();
      if(!tasks.length)break;
    }
    tasks.sort(compare);const task=tasks.shift()!;
    visited.add(task.key);done++;total=Math.max(total,done+tasks.length);
    options.progress?.(Math.min(99,Math.round(done*100/total)));
    if(task.provider==='index'&&usesTopicDates(task.operation)&&!store.latest(taskKey('index',task.scope,{type:'topic_dates'})))continue;
    if((store.db.prepare('SELECT paused FROM collection_provider_state WHERE provider=? AND scope=?').get(task.provider,task.scope) as any)?.paused)continue;
    const participants=participantsFor(task);
    if(!participants.length)continue;
    const defer=(recorded: boolean)=>{
      if(recorded)summary.deferred++;
      for(const id of participants)summary.accounts[id].deferred++;
    };
    const dailyKeys=dailyExhausted.get(task.provider);
    const credential=dailyKeys && credentialBinding(store.db,participants[0],task.provider);
    const dailyKey=(credential && credentialBudgetKey(store.db,task.provider,credential.auth_path)) ?? task.scope;
    if(dailyKeys?.has(dailyKey) || exhausted.has(task.provider) || Object.values(counts).reduce((a,b)=>a+b,0)>=(options.requestLimit??Infinity) ||
      (counts[task.provider]??0)>=(store.db.prepare('SELECT per_tick FROM collection_limits WHERE provider=?').get(task.provider) as any).per_tick){
      defer(false);continue;
    }
    if(!store.claim(task,clock(),!!options.retryTask))continue;
    const run=store.begin(task,clock(),null,participants);
    try {
      const result=await execute(store,run,transport(store,run,counts,options.fetchImpl??fetch,sleep,clock,options.requestLimit),clock);
      const finishedAt=clock();
      const nextFrom=task.provider!=='index' ? parseCollectionDay(result.version)
        : task.operation.startsWith('author_') ? run.at_ms : finishedAt;
      let next=nextCollectionDay(nextFrom);
      if(result.cached){
        store.reuse(run.id,result.cached.id,result.version);
        summary.cached++;
      }else{
        // 指数的事实由 rebuildAccount 在读取侧落库;创作后台快照在此直接写观测。
        const project = task.provider==='index' ? ()=>{} : (finished: any,data: any)=>store.observation(finished,'account',data.uid,'account',data.metrics);
        store.finish(run,result.data,result.version,result.fingerprint,project,finishedAt);summary.completed++;
        if(task.provider==='index'&&task.operation==='topic_dates'){
          const effective=result.data.valid_day;
          const lag=effective&&effective<collectionDay(finishedAt-COLLECTION_DAY_MS).replaceAll('-','');
          const attempts=(store.db.prepare("SELECT COUNT(*) n FROM collection_runs WHERE task_key=? AND status='ok' AND version=?").get(task.key,result.version) as any).n;
          if(lag&&attempts<2)next=Math.min(next,finishedAt+6*HOUR);
        }
      }
      store.release(task,next);
      for(const a of store.accounts(task.key))served[a.id]=(served[a.id]??0)+1;
      if(task.provider==='index')indexChanged=true;
      for(const id of participants)summary.accounts[id][result.cached?'cached':'completed']++;
      options.log?.(`${task.provider}/${task.operation} ${task.target}：${result.cached?'复用有效版本':'完成'}`,participants);
    }catch(error){
      const pending=/^interval_pending (\d+)$/.exec((error as Error)?.message??'');
      if(pending){
        store.db.prepare("UPDATE collection_runs SET status='deferred',error='interval_pending' WHERE id=?").run(run.id);
        store.release(task,Number(pending[1]),'interval_pending');defer(true);
        options.log?.(`${task.provider}/${task.operation} ${task.target}：interval_pending`,participants);
        continue;
      }
      const code=controlledError(error);
      if(/^(daily|tick)_budget_exhausted$/.test(code)){
        store.db.prepare("UPDATE collection_runs SET status='deferred',error=? WHERE id=?").run(code,run.id);
        const retryAt=(error as {retryAt?:number})?.retryAt;
        const next=code==='daily_budget_exhausted' ? retryAt??nextCollectionDay(clock()) : clock()+300000;
        store.release(task,next,code);
        if(code==='daily_budget_exhausted'){
          const keys=dailyKeys??new Set<string>();
          keys.add(store.requestBudgetKey(run));
          dailyExhausted.set(task.provider,keys);
        }else exhausted.add(task.provider);
        defer(true);
      }else{store.fail(run,code,clock());summary.failed++;for(const id of participants)summary.accounts[id].failed++;if(code==='service_unavailable')exhausted.add(task.provider);}
      options.log?.(`${task.provider}/${task.operation} ${task.target}：${code}`,participants);
    }
  }
  if(indexChanged)planCollection(store,{...options,now:clock()});
  options.progress?.(100);
  return summary;
}
