import { ReadClient,loadAuth } from '../sources/douyin-index/client.ts';
import { requestFor,semanticHash } from '../sources/douyin-index/protocol.ts';
import { atomic,stamp,taskKey,PROVIDERS, type CollectionStore } from './store.ts';
import { parseJson } from '../../lib/json.ts';

import { planCollection } from './planner.ts';
const DAY=86400000,HOUR=3600000;
export function controlledError(error: any): string {
  if(['ECONNREFUSED','ENOTFOUND','EHOSTUNREACH'].includes(error?.cause?.code??error?.code))return 'service_unavailable';
  if(error?.message==='login_or_challenge_html')return 'login_required';
  const code=String(error?.message??'');
  return /^(daily_budget_exhausted|tick_budget_exhausted|source_paused|source_dates_missing|login_required|rate_limited|payment_required|schema_error|decode_error|unsupported_encryption|identity_conflict|auth_required|invalid_auth_cookie|invalid_user_agent|auth_file_must_be_private_0600|transport_error|service_unavailable|business_error|http_error_\d+)$/.test(code)?code:error?.code==='SCHEMA_ERROR'?'schema_error':error?.code==='ENOENT'?'auth_required':'request_failed';
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
  const spec=JSON.parse(run.request);
  const credential=store.db.prepare('SELECT c.auth_path FROM collection_credentials c JOIN collection_task_accounts a ON a.account_id=c.account_id WHERE a.task_key=? AND c.scope=? LIMIT 1').get(run.task_key,run.scope) as any;
  const lastDates=store.latest(taskKey('index',run.scope,{type:'topic_dates'}));
  const dates=lastDates?{topic:store.data(lastDates)}:{};
  if(spec.type!=='topic_dates'&&!dates.topic)throw new Error('source_dates_missing');
  const version=spec.type==='topic_dates'?new Date(clock()).toISOString().slice(0,10):spec.type==='topic_relation'?dates.topic.valid_week:dates.topic.valid_day;
  const previous=store.latest(run.task_key);
  if(spec.type!=='topic_dates'&&previous?.version===version)return {cached:previous,version};
  const auth=loadAuth(credential?.auth_path,{});
  const req=requestFor(spec,dates);
  const response=await new ReadClient(auth,{fetchImpl:client,intervalMs:1000,sleep:async()=>{}}).read(spec,req);
  return {data:response.data,version,fingerprint:semanticHash(spec.type,response.data)};
}

export interface RunOptions {
  accountIds?: number[]; scheduled?: boolean; only?: string;
  requestLimit?: number; fetchImpl?: typeof fetch;
  clock?: () => number; sleep?: (ms: number) => Promise<void>;
  log?: (message: string, participants: number[]) => void;
  progress?: (percent: number) => void;
}
export async function runCollection(store: CollectionStore,options: RunOptions={}) {
  if(options.only&&!PROVIDERS.includes(options.only))throw new Error('未知采集来源');
  const clock=options.clock??Date.now,sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms))),counts: Record<string,number>={};
  const accounts=planCollection(store,{...options,now:clock()}),ids=accounts.map(a=>a.id),served: Record<number,number>={};
  for(const a of accounts)served[a.id]=(store.db.prepare("SELECT COUNT(*) n FROM collection_run_accounts a JOIN collection_runs r ON r.id=a.run_id WHERE a.account_id=? AND r.observed_at>=?").get(a.id,stamp(clock()).slice(0,10)) as any).n;
  let tasks=store.dueTasks(ids,clock());
  const visited=new Set<string>();let done=0,total=tasks.length;
  const compare=(a: any,b: any)=>{
    const fairness=(t: any)=>Math.min(...store.accounts(t.key).map((a: any)=>served[a.id]??0));
    const urgency=(t: any)=>t.priority+Math.log1p(Math.max(0,clock()-t.next_run_at)/HOUR);
    return Math.floor(b.priority/10)-Math.floor(a.priority/10)||fairness(a)-fairness(b)||urgency(b)-urgency(a)||a.next_run_at-b.next_run_at;
  };
  const exhausted=new Set<string>(),summary={completed:0,cached:0,failed:0,deferred:0,requests:counts,accounts:Object.fromEntries(ids.map(id=>[id,{completed:0,cached:0,failed:0}] as [number,any]))};
  let indexChanged=false;
  while(true) {
    if(!tasks.length){
      if(!indexChanged)break;
      indexChanged=false;
      planCollection(store,{...options,now:clock()});
      tasks=store.dueTasks(ids,clock()).filter(t=>!visited.has(t.key));
      if(!tasks.length)break;
    }
    tasks.sort(compare);const task=tasks.shift()!;
    visited.add(task.key);done++;total=Math.max(total,done+tasks.length);
    options.progress?.(Math.min(99,Math.round(done*100/total)));
    if(Object.values(counts).reduce((a,b)=>a+b,0)>=(options.requestLimit??Infinity))break;
    if((options.only&&task.provider!==options.only)||exhausted.has(task.provider))continue;
    if(task.provider==='index'&&task.operation!=='topic_dates'&&!store.latest(taskKey('index',task.scope,{type:'topic_dates'})))continue;
    if((counts[task.provider]??0)>=(store.db.prepare('SELECT per_tick FROM collection_limits WHERE provider=?').get(task.provider) as any).per_tick)continue;
    if((store.db.prepare('SELECT paused FROM collection_provider_state WHERE provider=? AND scope=?').get(task.provider,task.scope) as any)?.paused)continue;
    const assigned=new Set(store.accounts(task.key).map((a: any)=>a.id));
    const participants=accounts.filter(a=>assigned.has(a.id)&&(!options.scheduled||a.config.schedules[task.provider]?.enabled)).map(a=>a.id);
    if(!participants.length||!store.claim(task,clock()))continue;
    const run=store.begin(task,clock(),null,participants);
    try {
      const result=await execute(store,run,transport(store,run,counts,options.fetchImpl??fetch,sleep,clock,options.requestLimit),clock);
      if(result.cached){
        atomic(store.db,()=>{
          store.db.prepare("UPDATE collection_runs SET status='cached',version=? WHERE id=?").run(result.version,run.id);
          for(const id of participants)store.db.prepare('INSERT OR IGNORE INTO collection_run_accounts VALUES(?,?,?)').run(result.cached.id,id,accounts.find(a=>a.id===id)!.configSha);
        });summary.cached++;
        store.release(task,clock()+Math.min(HOUR,task.interval_ms));
      }else{
        store.finish(run,result.data,result.version,result.fingerprint,()=>{},clock());summary.completed++;
        let interval=task.interval_ms;
        if(task.provider==='index'&&task.operation.endsWith('_dates')){
          const effective=result.data.valid_day??result.data.datetime;
          const lag=effective&&Date.parse(`${effective.slice(0,4)}-${effective.slice(4,6)}-${effective.slice(6,8)}T00:00:00Z`)<clock()-DAY;
          const today=stamp(clock()).slice(0,10),attempts=(store.db.prepare("SELECT COUNT(*) n FROM collection_runs WHERE task_key=? AND status='ok' AND observed_at>=?").get(task.key,today) as any).n;
          if(lag&&attempts<2)interval=6*HOUR;
        }
        store.release(task,clock()+interval);
      }
      for(const a of store.accounts(task.key))served[a.id]=(served[a.id]??0)+1;
      if(task.provider==='index')indexChanged=true;
      for(const id of participants)summary.accounts[id][result.cached?'cached':'completed']++;
      options.log?.(`${task.provider}/${task.operation} ${task.target}：${result.cached?'复用有效版本':'完成'}`,participants);
    }catch(error){
      const code=controlledError(error);
      if(/^(daily|tick)_budget_exhausted$/.test(code)){
        store.db.prepare("UPDATE collection_runs SET status='deferred',error=? WHERE id=?").run(code,run.id);
        store.release(task,code.startsWith('daily')?Math.floor(clock()/DAY)*DAY+DAY:clock()+300000,code);exhausted.add(task.provider);summary.deferred++;
      }else{store.fail(run,code,clock());summary.failed++;for(const id of participants)summary.accounts[id].failed++;if(code==='service_unavailable')exhausted.add(task.provider);}
      options.log?.(`${task.provider}/${task.operation} ${task.target}：${code}`,participants);
    }
  }
  if(indexChanged)planCollection(store,{...options,now:clock()});
  options.progress?.(100);
  return summary;
}
