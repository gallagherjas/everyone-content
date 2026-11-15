import assert from 'node:assert/strict';
import { test,after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const root=mkdtempSync(join(tmpdir(),'everyone-collection-'));
process.env.EVERYONE_CONTENT_GIT_ROOT=root;process.env.EVERYONE_CONTENT_DATA_DIR=join(root,'runtime');
execFileSync('git',['init','-q',root]);after(()=>rmSync(root,{recursive:true,force:true}));
const {migrate}=await import('../db/migrate.ts');
const {createAccount}=await import('../lib/accounts.ts');
const {CollectionStore,hash}=await import('../collector/core/store.ts');
const {runCollection}=await import('../collector/core/runner.ts');
const {planCollection}=await import('../collector/core/planner.ts');
const {registerAuth,configureIndex}=await import('../collector/core/settings.ts');
const {collectionStatus,collectionOutcome}=await import('../collector/core/status.ts');
const {connectionStatus}=await import('../lib/platform-login.ts');
const {monitorOverview}=await import('../lib/monitor.ts');
const {bloggerOverview,bloggerDetail}=await import('../collector/core/bloggers.ts');
const {defaultSchedules}=await import('../lib/collection-schedule.ts');
const DAY=86400000,HOUR=3600000,base=Date.UTC(2026,10,7,2);
function setup(){const db=new DatabaseSync(':memory:');migrate(db,':memory:');createAccount(db,'采集测试账号');db.prepare('UPDATE collection_limits SET interval_ms=0').run();return {db,store:new CollectionStore(db,join(root,hash(Math.random()))) };}
function account(db,id){const a=db.prepare('SELECT * FROM accounts WHERE id=?').get(id);return {...a,config:JSON.parse(a.config)};}
function config(db,id,patch){const a=account(db,id);db.prepare('UPDATE accounts SET config=? WHERE id=?').run(JSON.stringify({...a.config,...patch}),id);}
function auth(db,id,cookie){const file=join(root,`auth-${id}-${Math.random()}.json`);writeFileSync(file,JSON.stringify({cookie}),{mode:0o600});db.prepare('INSERT INTO collection_credentials VALUES(?,?,?,?)').run(id,'index',file,`account:${id}`);}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
test('队列列出全部账号任务，待执行计数与可执行状态一致',()=>{
 const {db,store}=setup();try{
  const later=Date.now()+HOUR;
  const owners=[{id:1,configSha:'test'}];
  const add=(keyword: string)=>store.queue('index','account:1',{type:'topic_search',keyword},owners);
  for(let i=0;i<101;i++)add(`排队词${i}`);
  const waiting=add('未到时间'),running=add('执行中'),disabled=add('已停用');
  db.prepare('UPDATE collection_tasks SET next_run_at=? WHERE key=?').run(later,waiting.key);
  const previous=store.begin(waiting,base);
  store.finish(previous,{topic_list:[]},'20261105','test',()=>{},base+1000);
  assert.equal(collectionStatus(db,account(db,1),null).tasks.find(task=>task.key===waiting.key)?.last_success_at,base+1000);
  db.prepare('UPDATE collection_tasks SET last_success_at=NULL,last_success_id=NULL WHERE key=?').run(waiting.key);
  db.prepare('UPDATE collection_tasks SET lease_until=? WHERE key=?').run(later,running.key);
  db.prepare('UPDATE collection_tasks SET disabled=1 WHERE key=?').run(disabled.key);
  const paused=store.queue('xhs','account:1',{type:'account_snapshot'},owners);
  store.pause('xhs','account:1','login_required');
  const second=createAccount(db,'第二个队列账号');
  store.queue('index',`account:${second.id}`,{type:'topic_dates'},[{id:second.id,configSha:'test'}]);
  const summary=collectionStatus(db,account(db,1),null);
  assert.deepEqual(summary.queue,{total:105,due:101});
  assert.equal(summary.tasks.length,summary.queue.total);
  assert.equal(summary.tasks.filter(task=>task.status==='due').length,summary.queue.due);
  const state=new Map(summary.tasks.map(task=>[task.key,task]));
  assert.equal(state.get(waiting.key)?.status,'waiting');
  assert.equal(state.get(waiting.key)?.last_success_at,base);
  assert.equal(state.get(running.key)?.status,'running');
  assert.equal(state.get(disabled.key)?.status,'disabled');
  assert.equal(state.get(paused.key)?.status,'paused');
  assert.equal(state.get(paused.key)?.source_error,'login_required');
  assert.deepEqual(collectionStatus(db,second,null).queue,{total:1,due:1});
  assert.deepEqual(collectionStatus(db,{...account(db,1),status:'archived'},null).queue,{total:105,due:0});
 }finally{db.close();}
});
test('本日已采覆盖指数数据，官方新版出现时仍显示待执行',async()=>{
 const {db,store}=setup();try{
  auth(db,1,'valid');
  config(db,1,{index:{discovery:null,tasks:[{type:'topic_search',keyword:'指数缓存'}]}});
  const fetchImpl=async(input:RequestInfo|URL)=>String(input).endsWith('get_topic_valid_date')
    ? json({data:{valid_day:'20261105',valid_week:'20261101'}})
    : json({data:{topic_list:[]}});
  await runCollection(store,{accountIds:[1],only:'topic_rank',clock:()=>base,fetchImpl,sleep:async()=>{}});
  const status=(at=base+1000)=>collectionStatus(db,account(db,1),store,at).tasks;
  assert.equal(status().find(t=>t.operation==='topic_dates')?.status,'collected');
  const afterRecheckTime=status(base+6*HOUR+1000).find(t=>t.operation==='topic_dates')!;
  assert.equal(afterRecheckTime.next_run_at,base+6*HOUR);
  assert.equal(afterRecheckTime.status,'collected');
  assert.equal(status(base+DAY).find(t=>t.operation==='topic_dates')?.status,'due');
  assert.equal(status().find(t=>t.operation==='topic_search')?.status,'collected');
  db.prepare("UPDATE collection_tasks SET next_run_at=0 WHERE operation='topic_search'").run();
  assert.equal(status().find(t=>t.operation==='topic_search')?.status,'collected');
  const artifact=store.artifact({valid_day:'20261107',valid_week:'20261101'});
  db.prepare("UPDATE collection_runs SET data_path=?,data_sha=? WHERE operation='topic_dates'").run(artifact.path,artifact.sha);
  assert.equal(status().find(t=>t.operation==='topic_search')?.status,'due');
 }finally{db.close();}
});
test('某账号登录失效不影响另一账号，同词查询与结果归属隔离',async()=>{
 const {db,store}=setup();try{
  const second=createAccount(db,'独立账号');
  for(const id of [1,second.id]){config(db,id,{index:{discovery:null,tasks:[]}});db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name) VALUES(?,'keyword','共用词','共用词')").run(id);auth(db,id,id===1?'expired':'valid');}
  const calls=[],fetchImpl=async(input,init)=>{
   const u=new URL(String(input));calls.push({path:u.pathname,cookie:init.headers.cookie});if(init.headers.cookie==='expired')return json({},401);
   if(u.pathname.endsWith('get_topic_valid_date'))return json({data:{valid_day:'20261105',valid_week:'20261101'}});
   if(u.pathname.endsWith('query_topic'))return json({data:{topic_list:[]}});
   if(u.pathname.endsWith('itemQuery'))return json({data:{data:[{itemId:'991',title:'本账号可见作品',likes:'500'}]}});throw new Error('unexpected mock');
  };
  await runCollection(store,{clock:()=>base,fetchImpl,sleep:async()=>{}});
  assert.equal(db.prepare("SELECT paused FROM collection_provider_state WHERE provider='index' AND scope='account:1'").get().paused,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM account_works WHERE account_id=1').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM account_works WHERE account_id=?').get(second.id).n,1);
  assert.equal(calls.filter(r=>r.cookie==='expired').length,1);assert.equal(collectionStatus(db,account(db,second.id),store).runs.some(r=>r.status==='ok'),true);
 }finally{db.close();}
});
test('任务租约并发保护、超时恢复与旧worker写入保护',()=>{
 const {db,store}=setup();try{
  const task=store.queue('index','account:1',{type:'topic_dates'},[{id:1,configSha:'one'}]),other=new CollectionStore(db,store.directory+'/second');
  assert.equal(store.claim(task,base),true);const r=store.begin(task,base);assert.equal(other.claim(task,base),false);assert.equal(other.claim(task,base+900001),true);
  assert.throws(()=>store.finish(r,{},null,'x',()=>{},base+900002),/stale_lease/);other.release(task,base+1000000);assert.equal(store.claim(task,base+1000001),true);
 }finally{db.close();}
});
test('任务连续失败3次自动停用，成功清零计数，重连授权恢复',()=>{
 const {db,store}=setup();try{
  const task=store.queue('index','account:1',{type:'topic_dates'},[{id:1,configSha:'one'}]);
  for(let i=0;i<2;i++){const at=base+i*HOUR;store.claim(task,at);store.fail(store.begin(task,at),'request_failed',at);}
  assert.equal(db.prepare('SELECT disabled FROM collection_tasks WHERE key=?').get(task.key).disabled,0);
  store.claim(task,base+2*HOUR);store.fail(store.begin(task,base+2*HOUR),'request_failed',base+2*HOUR);
  assert.equal(db.prepare('SELECT disabled,failures FROM collection_tasks WHERE key=?').get(task.key).disabled,1);
  const file=join(root,'retry-auth.json');writeFileSync(file,JSON.stringify({cookie:'valid'}),{mode:0o600});
  registerAuth(store,1,file);
  const revived=db.prepare('SELECT disabled,failures,next_run_at FROM collection_tasks WHERE key=?').get(task.key);
  assert.equal([revived.disabled,revived.failures,revived.next_run_at].join(),'0,0,0');
  store.claim(task,base+3*HOUR);store.fail(store.begin(task,base+3*HOUR),'request_failed',base+3*HOUR);
  store.claim(task,base+4*HOUR);store.finish(store.begin(task,base+4*HOUR),{},null,'x',()=>{},base+4*HOUR);
  const settled=db.prepare('SELECT failures,disabled FROM collection_tasks WHERE key=?').get(task.key);
  assert.equal([settled.failures,settled.disabled].join(),'0,0');
 }finally{db.close();}
});
test('平台快照遇请求间隔即延后到窗口时刻，不占额度不睡进程，窗口后采集成功',async()=>{
 const {db,store}=setup();try{
  db.prepare("UPDATE collection_limits SET interval_ms=3600000 WHERE provider='douyin'").run();
  const file=join(root,'douyin-auth.json');writeFileSync(file,JSON.stringify({cookie:'ok'}),{mode:0o600});
  registerAuth(store,1,file,'douyin');
  db.prepare("INSERT INTO collection_provider_state VALUES('douyin','account:1',0,NULL,?)").run(base);
  const fetchImpl=async()=>json({douyin_user_verify_info:{follower_count:3,total_favorited:9}});
  const opts={accountIds:[1],only:'douyin',clock:()=>base+1000,fetchImpl,sleep:async()=>{}};
  const first=await runCollection(store,opts);
  assert.equal(first.deferred,1);assert.equal(first.completed,0);
  assert.equal(collectionOutcome(first.accounts[1]),'deferred');
  const task=db.prepare('SELECT error,next_run_at FROM collection_tasks WHERE provider=?').get('douyin');
  assert.equal(task.error,'interval_pending');assert.equal(task.next_run_at,base+3600000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_requests WHERE provider='douyin'").get().n,0);
  const later=await runCollection(store,{...opts,clock:()=>base+3600001});
  assert.equal(later.completed,1);
  assert.equal(db.prepare("SELECT failures,error FROM collection_tasks WHERE provider='douyin'").get().failures,0);
 }finally{db.close();}
});
test('跨午夜预留请求时按实际预留日计算额度和下一次可采时间',async()=>{
 const {db,store}=setup();try{
  const second=createAccount(db,'同平台另一账号');
  const file=join(root,'quota-midnight.json');writeFileSync(file,JSON.stringify({cookie:'ok'}),{mode:0o600});
  registerAuth(store,1,file,'xhs');
  db.prepare("UPDATE collection_limits SET interval_ms=60000,daily_limit=1 WHERE provider='xhs'").run();
  const midnight=Date.UTC(2026,10,15,16);
  const other=store.queue('xhs',`account:${second.id}`,{type:'account_snapshot'},[{id:second.id,configSha:'test'}]);
  store.reserve(store.begin(other,midnight),'/snapshot',midnight);
  const result=await runCollection(store,{accountIds:[1],only:'xhs',clock:()=>midnight-1000,sleep:async()=>{},
    fetchImpl:()=>assert.fail('预留日额度已用完')});
  assert.equal(result.deferred,1);
  const t=db.prepare("SELECT error,next_run_at FROM collection_tasks WHERE provider='xhs' AND scope='account:1'").get()!;
  assert.equal(t.error,'daily_budget_exhausted');
  assert.equal(t.next_run_at,midnight+DAY);
 }finally{db.close();}
});
test('快照同一采集日复用，换日可重新采集，趋势与旧任务都按同一日界线',async()=>{
 const {db,store}=setup();try{
  const file=join(root,'daily-xhs.json');writeFileSync(file,JSON.stringify({cookie:'ok'}),{mode:0o600});
  registerAuth(store,1,file,'xhs');
  const cutoff=Date.UTC(2026,10,15,16), first=cutoff-12*HOUR;
  let requests=0;
  const opts={accountIds:[1],only:'xhs',fetchImpl:async()=>json({code:0,data:{fans_count:++requests}}),sleep:async()=>{}};
  const task=()=>db.prepare("SELECT key,next_run_at FROM collection_tasks WHERE provider='xhs'").get()!;
  assert.equal((await runCollection(store,{...opts,clock:()=>first})).completed,1);
  assert.equal(task().next_run_at,cutoff);
  const status=(now: number)=>collectionStatus(db,account(db,1),store,now);
  assert.equal(status(cutoff-1).tasks[0].status,'collected');
  assert.equal(status(cutoff-1).queue.due,0);
  assert.equal(status(cutoff).tasks[0].status,'due');
  db.prepare('UPDATE collection_tasks SET next_run_at=? WHERE key=?').run(first+DAY,task().key);
  db.exec('PRAGMA user_version=5');
  migrate(db,':memory:');
  assert.equal(task().next_run_at,cutoff);
  const sameDay=await runCollection(store,{...opts,clock:()=>cutoff-HOUR-1});
  assert.equal(collectionOutcome(sameDay.accounts[1]),'cached');
  assert.equal(requests,1);
  assert.equal(task().next_run_at,cutoff);

  registerAuth(store,1,file,'xhs');
  assert.equal(status(cutoff-HOUR).tasks[0].status,'due');
  assert.equal((await runCollection(store,{...opts,clock:()=>cutoff-HOUR})).completed,1);
  const cached=monitorOverview(db,1,cutoff-1).platforms.xhs;
  assert.deepEqual(cached.series.map(point=>[point.at,point.fans]),[['2026-11-15',2]]);
  assert.equal((await runCollection(store,{...opts,clock:()=>cutoff})).completed,1);
  assert.equal(requests,3);
  assert.equal(task().next_run_at,cutoff+DAY);
  assert.deepEqual(monitorOverview(db,1,cutoff).platforms.xhs.series.map(point=>[point.at,point.fans]),
    [['2026-11-15',2],['2026-11-16',3]]);
 }finally{db.close();}
});
test('跨采集日收到快照时从新的一天复用缓存',async()=>{
 const {db,store}=setup();try{
  const file=join(root,'midnight-xhs.json');writeFileSync(file,JSON.stringify({cookie:'ok'}),{mode:0o600});
  registerAuth(store,1,file,'xhs');
  const cutoff=Date.UTC(2026,10,15,16);
  let now=cutoff-1000;
  const opts={accountIds:[1],only:'xhs',clock:()=>now,sleep:async()=>{},
    fetchImpl:async()=>{now=cutoff+1000;return json({code:0,data:{fans_count:3}});}};
  assert.equal((await runCollection(store,opts)).completed,1);
  const task=db.prepare("SELECT key,next_run_at FROM collection_tasks WHERE provider='xhs'").get()!;
  assert.equal(store.latest(String(task.key)).version,'2026-11-16');
  assert.equal(task.next_run_at,cutoff+DAY);
  const cached=await runCollection(store,{...opts,fetchImpl:()=>assert.fail('应复用新采集日的快照')});
  assert.equal(collectionOutcome(cached.accounts[1]),'cached');
 }finally{db.close();}
});
test('B站总览单请求采集，未登录时提示重连，成功后同日复用并在换日后更新',async()=>{
 const {db,store}=setup();try{
  const file=join(root,'bili-test.json');writeFileSync(file,JSON.stringify({cookie:'SESSDATA=synthetic'}),{mode:0o600});
  registerAuth(store,1,file,'bili');
  let now=base,calls=0;
  const opts={accountIds:[1],only:'bili',clock:()=>now,sleep:async()=>{}};
  const snapshot=async(input: RequestInfo | URL)=>{
   assert.equal(String(input),'https://member.bilibili.com/x/web/data/index/stat?tmid=-1');
   calls++;
   return calls===1?json({code:-101,message:'账号未登录'}):json({code:0,data:{total_fans:4,total_like:9,total_click:'1.2亿'}});
  };
  assert.equal((await runCollection(store,{...opts,fetchImpl:snapshot})).failed,1);
  assert.equal(connectionStatus(db,1,'bili').status,'expired');
  assert.equal(collectionStatus(db,account(db,1),store).runs[0].error,'login_required');
  registerAuth(store,1,file,'bili');now+=1000;
  assert.equal((await runCollection(store,{...opts,fetchImpl:snapshot})).completed,1);
  const monitor=monitorOverview(db,1,now).platforms.bili;
  assert.deepEqual(monitor.latest,{at:'2026-11-07',fans:4,likes:9,views:120000000,works:null});
  assert.equal(calls,2);
  assert.equal((await runCollection(store,{...opts,fetchImpl:snapshot})).cached,1);
  assert.equal(calls,2);
  now=Date.UTC(2026,10,7,16);
  assert.equal((await runCollection(store,{...opts,fetchImpl:snapshot})).completed,1);
  assert.equal(calls,3);
 }finally{db.close();}
});
test('迁移旧采集日：凌晨额度、快照与日期检查移入北京时间当日，官方内容版本保留',()=>{
 const {db,store}=setup();try{
  const now=Date.UTC(2026,10,15,16,30);
  const oldBoundary=Date.UTC(2026,10,16),newBoundary=Date.UTC(2026,10,16,16);
  const owner=[{id:1,configSha:'test'}];
  const snapshot=store.queue('xhs','account:1',{type:'account_snapshot'},owner);
  const previous=store.begin(snapshot,now);
  const slot=store.reserve(previous,'/snapshot',now);
  store.requestResult(slot.id,'{}',200);
  db.prepare("UPDATE collection_requests SET day='2026-11-15' WHERE id=?").run(slot.id);
  store.finish(previous,{metrics:{fans:3}},'2026-11-15','test',
    (run,data)=>store.observation(run,'account','self','account',data.metrics),now+1000);
  const cached=store.begin(snapshot,now+2000);
  store.reuse(cached.id,previous.id,'2026-11-15');
  const dates=store.queue('index','account:1',{type:'topic_dates'},owner);
  const datesRun=store.begin(dates,now);
  store.finish(datesRun,{valid_day:'20261115',valid_week:'20261109'},'2026-11-15','dates',()=>{},now);
  const content=store.queue('index','account:1',{type:'topic_search',keyword:'原官方版本'},owner);
  store.finish(store.begin(content,now),{topic_list:[]},'20261115','content',()=>{},now);
  for(const t of [snapshot,dates,content])db.prepare('UPDATE collection_tasks SET next_run_at=? WHERE key=?').run(oldBoundary,t.key);
  db.exec('PRAGMA user_version=6');
  migrate(db,':memory:');
  assert.equal(db.prepare('SELECT day FROM collection_requests WHERE id=?').get(slot.id)?.day,'2026-11-16');
  assert.equal(db.prepare('SELECT effective_at FROM collection_observations WHERE run_id=?').get(previous.id)?.effective_at,'2026-11-16');
  assert.equal(db.prepare('SELECT version FROM collection_runs WHERE id=?').get(cached.id)?.version,'2026-11-16');
  assert.equal(store.latest(dates.key).version,'2026-11-16');
  assert.equal(store.data(store.latest(dates.key)).valid_day,'20261115');
  assert.equal(store.latest(content.key).version,'20261115');
  const status=collectionStatus(db,account(db,1),store,now+5000);
  assert.ok(status.tasks.every(t=>t.next_run_at===newBoundary));
  assert.equal(status.budgets.find(b=>b.provider==='xhs').used,1);
  assert.equal(status.tasks.find(t=>t.provider==='xhs')?.status,'collected');
 }finally{db.close();}
});
test('重连同日仍实采验证，未登录响应暂停对应来源，其他平台可正常完成',async()=>{
  const {db,store}=setup();
  try {
    const file=join(root,'snapshot-verification-auth.json');
    writeFileSync(file,JSON.stringify({cookie:'synthetic-session'}),{mode:0o600});
    registerAuth(store,1,file,'douyin');
    registerAuth(store,1,file,'xhs');
    assert.equal(connectionStatus(db,1,'douyin').status,'configured');
    const opts={accountIds:[1],clock:()=>base, sleep:async()=>{}};
    const first=await runCollection(store,{...opts,only:'douyin',fetchImpl:async()=>json({user_profile:{follower_count:3}})});
    assert.equal(collectionOutcome(first.accounts[1]),'done');
    assert.equal(collectionStatus(db,account(db,1),store).runs[0].status,'ok');
    assert.equal(connectionStatus(db,1,'douyin').status,'verified');

    registerAuth(store,1,file,'douyin');
    assert.equal(connectionStatus(db,1,'douyin').status,'configured');
    const fetchImpl=async input=>new URL(String(input)).hostname==='creator.douyin.com'
      ? json({status_code:8,status_msg:'用户未登录'})
      : json({code:0,success:true,data:{fans_count:5,faved_count:10}});
    const next=await runCollection(store,{...opts,clock:()=>base+1000,fetchImpl});
    assert.deepEqual(next.accounts[1],{completed:1,cached:0,failed:1,deferred:0});
    assert.equal(collectionOutcome(next.accounts[1]),'partial');
    const state=collectionStatus(db,account(db,1),store);
    assert.equal(state.runs.find(r=>r.provider==='douyin').error,'login_required');
    assert.equal(state.tasks.find(t=>t.provider==='douyin').disabled,0);
    assert.deepEqual(connectionStatus(db,1,'douyin'),{status:'expired',configured:true,paused:true,error:'login_required'});
    assert.equal(connectionStatus(db,1,'xhs').status,'verified');
    const idle=await runCollection(store,{...opts,clock:()=>base+2000,fetchImpl:()=>assert.fail('不应发起请求')});
    assert.equal(collectionOutcome(idle.accounts[1]),'empty');
  } finally {db.close();}
});
test('未登记授权不排指数任务也不伪造失败；登记后立即参与采集',async()=>{
 const {db,store}=setup();try{
  config(db,1,{index:{discovery:null,tasks:[{type:'videos',keyword:'测试'}]}});
  const calls=[],fetchImpl=async input=>{
   const path=new URL(String(input)).pathname;calls.push(path);
   if(path.endsWith('get_topic_valid_date'))return json({data:{valid_day:'20261105',valid_week:'20261101'}});
   if(path.endsWith('query_topic'))return json({data:{topic_list:[]}});
   return json({data:{data:[{itemId:'123',title:'测试视频',likes:'600',nickname:'测试作者'}]}});
  };
  const opts={accountIds:[1],only:'index',clock:()=>base,fetchImpl,sleep:async()=>{}};
  const idle=await runCollection(store,opts);assert.equal(idle.failed,0);assert.equal(calls.length,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_runs').get().n,0);
  const file=join(root,'restored-auth.json');writeFileSync(file,JSON.stringify({cookie:'valid'}),{mode:0o600});
  registerAuth(store,1,file);
  const restored=await runCollection(store,opts);assert.equal(restored.failed,0);assert.equal(restored.completed,4);
  assert.ok(calls[0].endsWith('get_topic_valid_date'));assert.equal(collectionStatus(db,account(db,1),store).discovery.ready,true);
 }finally{db.close();}
});
test('30天窗口有效版本跨日更新，合法空结果缓存，旧累计缓存不复用',async()=>{
 const {db,store}=setup();try{
  config(db,1,{index:{discovery:null,tasks:[{type:'topic_search',keyword:'测试'}]}});auth(db,1,'valid');let version='20261105',now=base+8*HOUR,business=0;
  const fetchImpl=async(input,init)=>{const p=new URL(String(input)).pathname;if(p.endsWith('get_topic_valid_date'))return json({data:{valid_day:version,valid_week:'20261101'}});business++;const payload=JSON.parse(init.body);if(p.endsWith('query_topic')){assert.ok(payload.param.start_date);return json({data:{topic_list:[]}});}return json({data:{data:[]}});};
  const legacy=store.queue('index','account:1',{type:'topic_search',keyword:'测试'},[{id:1,configSha:'legacy'}]);
  store.claim(legacy,base-DAY);const old=store.begin(legacy,base-DAY);
  const slot=store.reserve(old,'/api/v2/index/query_topic',base-DAY,null,{body:{param:{start_date:'',end_date:version}}});
  store.requestResult(slot.id,'{}',200);store.finish(old,{topic_list:[{topic_id:'99',topic_name:'累计旧话题',topic_index:'999999'}]},version,'legacy',()=>{},base-DAY);store.release(legacy,base+DAY);
  const opts={accountIds:[1],only:'index',clock:()=>now,fetchImpl,sleep:async()=>{}};await runCollection(store,opts);assert.equal(business,3); // topic + two video windows, all legitimately empty
  now=base+22*HOUR;version='20261106';await runCollection(store,opts);assert.equal(business,6);
  now+=DAY+1;await runCollection(store,opts);assert.equal(business,6);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_observations WHERE kind='topic'").get().n,0);
 }finally{db.close();}
});
test('有效日期更新时补采尚未满24小时的旧关键词，新增关键词不会挡住整批结果',async()=>{
 const {db,store}=setup();try{
  const tasks=[{type:'videos',keyword:'旧词甲'},{type:'videos',keyword:'旧词乙'}];
  config(db,1,{index:{discovery:null,tasks}});auth(db,1,'valid');
  let version='20261105',week='20261101',now=base;const calls=[];
  const fetchImpl=async(input,init)=>{
   const path=new URL(String(input)).pathname,payload=init.body?JSON.parse(init.body):null;calls.push({path,payload});
   if(path.endsWith('get_topic_valid_date'))return json({data:{valid_day:version,valid_week:week}});
   if(path.endsWith('query_topic'))return json({data:{topic_list:[{topic_id:'77',topic_name:'测试话题',topic_index:'10000'}]}});
   if(path.endsWith('itemQuery'))return json({data:{data:[{itemId:'123',title:'测试视频',likes:'600',index:'1000',nickname:'测试作者'}]}});
   throw new Error('unexpected endpoint');
  };
  const opts={accountIds:[1],only:'index',clock:()=>now,fetchImpl,sleep:async()=>{}};
  await runCollection(store,opts);assert.equal(collectionStatus(db,account(db,1),store).discovery.ready,true);
  version='20261106';week='20261102';now+=6*HOUR+1;calls.length=0;
  config(db,1,{index:{discovery:null,tasks:[...tasks,{type:'videos',keyword:'新词'}]}});
  const result=await runCollection(store,opts),view=collectionStatus(db,account(db,1),store).discovery;
  assert.equal(result.failed,0);assert.equal(result.requests.index,10);assert.equal(view.ready,true);
  assert.equal(view.videos.length,1);assert.equal(view.authors.length,1);
  assert.deepEqual(view.pending,{topicSearch:[],videos:[]});
  assert.equal(calls.some(c=>c.path.endsWith('get_topic_relation')),false); // 不再采集话题关联
  assert.deepEqual(calls.filter(c=>c.path.endsWith('query_topic')).map(c=>c.payload.param.keyword).sort(),['新词','旧词乙','旧词甲'].sort());
  const task=db.prepare("SELECT * FROM collection_tasks WHERE provider='index' AND operation='videos' AND target='旧词甲#7'").get();
  db.prepare("UPDATE collection_tasks SET error='service_unavailable',next_run_at=? WHERE key=?").run(now+HOUR,task.key);
  version='20261107';const dateRun=store.latest(db.prepare("SELECT key FROM collection_tasks WHERE operation='topic_dates'").get().key);
  const data={...store.data(dateRun),valid_day:version},artifact=store.artifact(data);
  db.prepare('UPDATE collection_runs SET data_path=?,data_sha=? WHERE id=?').run(artifact.path,artifact.sha,dateRun.id);
  planCollection(store,{accountIds:[1],now});
  assert.equal(db.prepare('SELECT next_run_at FROM collection_tasks WHERE key=?').get(task.key).next_run_at,now+HOUR);
 }finally{db.close();}
});
test('六个关键词受每轮次数分批采集时显示缺失项，下一轮补齐后展示结果',async()=>{
 const {db,store}=setup();try{
  config(db,1,{index:{discovery:null,tasks:Array.from({length:6},(_,i)=>({type:'videos',keyword:'词'+i}))}});auth(db,1,'valid');
  let calls=0;
  const fetchImpl=async input=>{
   calls++;const path=new URL(String(input)).pathname;
   if(path.endsWith('get_topic_valid_date'))return json({data:{valid_day:'20261105',valid_week:'20261101'}});
   if(path.endsWith('query_topic'))return json({data:{topic_list:[{topic_id:'77',topic_name:'测试话题',topic_index:'10000'}]}});
   if(path.endsWith('itemQuery'))return json({data:{data:[{itemId:'123',title:'测试视频',likes:'600',index:'1000',nickname:'测试作者'}]}});
   throw new Error('unexpected endpoint');
  };
  const opts={accountIds:[1],only:'index',clock:()=>base,fetchImpl,sleep:async()=>{}};
  await runCollection(store,opts);let view=collectionStatus(db,account(db,1),store).discovery;
  assert.equal(calls,10);assert.equal(view.ready,false);assert.equal(view.videos.length,0);
  assert.equal(view.pending.topicSearch.length,0);assert.ok(view.pending.videos.length>=1);
  await runCollection(store,opts);view=collectionStatus(db,account(db,1),store).discovery;
  assert.equal(calls,19);assert.equal(view.ready,true);assert.equal(view.videos.length,1);assert.equal(view.authors.length,1);
 }finally{db.close();}
});
test('指数客户端保留配额异常，只排队一次，不伪造批量网络失败',async()=>{
 const {db,store}=setup();try{
  config(db,1,{index:{discovery:null,tasks:[{type:'videos',keyword:'第一个词'},{type:'videos',keyword:'第二个词'}]}});auth(db,1,'valid');
  db.prepare("UPDATE collection_limits SET daily_limit=1 WHERE provider='index'").run();let calls=0;
  const fetchImpl=async()=>{calls++;return json({data:{valid_day:'20261105',valid_week:'20261101'}});};
  const r=await runCollection(store,{accountIds:[1],clock:()=>base,fetchImpl,sleep:async()=>{}});
  assert.equal(calls,1);assert.equal(r.failed,0);assert.equal(r.deferred,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_runs WHERE status='failed'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_runs WHERE status='deferred'").get().n,1);
 }finally{db.close();}
});

test('同级发现任务在每次执行后重新按账号公平轮转',async()=>{
 const {db,store}=setup();try{
  const second=createAccount(db,'另一个发现账号');
  for(const id of [1,second.id]){config(db,id,{index:{discovery:null,tasks:[{type:'videos',keyword:'甲'},{type:'videos',keyword:'乙'},{type:'videos',keyword:'丙'}]}});auth(db,id,'owner-'+id);}
  db.prepare("UPDATE collection_limits SET daily_limit=4 WHERE provider='index'").run();const owners=[];
  const fetchImpl=async(input,init)=>{const p=new URL(String(input)).pathname;if(p.endsWith('get_topic_valid_date'))return json({data:{valid_day:'20261105',valid_week:'20261101'}});owners.push(init.headers.cookie);return json({data:p.endsWith('query_topic')?{topic_list:[]}:{data:[]}});};
  await runCollection(store,{clock:()=>base,fetchImpl,sleep:async()=>{}});assert.equal(owners.length,2);assert.equal(new Set(owners).size,2);
 }finally{db.close();}
});

test('新账号独立登记授权与采集规则',()=>{
 const {db,store}=setup();try{
  const a=createAccount(db,'独立园艺账号'),authFile=join(root,'garden-auth.json'),cfg=join(root,'garden-config.json');
  writeFileSync(authFile,JSON.stringify({cookie:'test-only-garden'}),{mode:0o600});
  writeFileSync(cfg,JSON.stringify({discovery:{seedKeywords:['阳台种花'],excludeKeywords:['广告']}}));
  registerAuth(store,a.id,authFile);configureIndex(store,a.id,cfg);
  assert.equal(db.prepare('SELECT scope FROM collection_credentials WHERE account_id=?').get(a.id).scope,`account:${a.id}`);
  assert.deepEqual(account(db,a.id).config.index.discovery.excludeKeywords,['广告']);assert.equal('enabled' in account(db,a.id).config.index,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_credentials WHERE account_id=1').get().n,0);
  assert.deepEqual(db.prepare('SELECT source_key FROM account_sources WHERE account_id=?').all(a.id).map(r=>r.source_key),['阳台种花']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_runs').get().n,0);
 }finally{db.close();}
});

test('指数全量入选并按榜单展示，排除词即时生效；历史记录不删除',async()=>{
 const {db,store}=setup();try{
  config(db,1,{index:{discovery:{excludeKeywords:['AIGC','猫咪'],minTopicIndex:10000,maxVideos:10},tasks:[{type:'topic_trend',id:'999'},{type:'topic_audience',id:'999'},{type:'author_fans',id:'abc'}]}});
  auth(db,1,'valid');db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name) VALUES(1,'keyword','企业AI','企业AI')").run();
  db.prepare("INSERT INTO works(id,url,published_at,reason) VALUES(9999,'https://www.douyin.com/video/9999','2026-11-06 02:00:00','index')").run();
  db.prepare("INSERT INTO account_works(account_id,work_id,reason) VALUES(1,9999,'index:selected')").run();
  db.prepare("INSERT INTO contents(account_id,published_url,published_at) VALUES(1,'https://www.douyin.com/video/101','2026-11-06 02:00:00')").run();
  const calls=[];let now=base;
  const fetchImpl=async(input,init)=>{
   now+=3000;const path=new URL(String(input)).pathname,payload=init.body?JSON.parse(init.body):null;calls.push({path,payload});
   if(path.endsWith('get_topic_valid_date'))return json({data:{valid_day:'20261105',valid_week:'20261101'}});
   if(path.endsWith('query_topic'))return json({data:{topic_list:[1,2,3,4].map(n=>({topic_id:String(n),topic_name:'企业AI'+n,topic_index:String(n*10000)})).concat([{topic_id:'5',topic_name:'企业AI',topic_index:'9999'}])}});
   if(path.endsWith('itemQuery'))return json({data:{data:[{itemId:'101',title:'企业AI工作流',likes:'500',index:'500',nickname:'测试作者',fans:1200,duration:90,createTime:'2026-11-06 10:00:00'},{itemId:'102',title:'企业AI',likes:'499',index:'9999'},{itemId:'103',title:'企业AI #AIGC',likes:'9999',index:'9999'},{itemId:'105',title:'企业AI',likes:'700',index:'100'}]}});
   if(path.endsWith('get_topic_relation'))return json({data:{item_list:[{item_id:'101',title:'企业AI工作流',digg_cnt:'100',comment_cnt:'5'},{item_id:'104',title:'企业AI案例',digg_cnt:'200',comment_cnt:'3'},{item_id:'105',title:'企业AI 猫咪',digg_cnt:'300'}],digg_author_list:[{author_id:'700',author_name:'话题作者',digg_cnt:'100'}],comment_author_list:[{author_id:'700',author_name:'话题作者',comment_cnt:'3'}],fans_author_list:[{author_id:'900',author_name:'不保留的粉丝榜作者'}]}});
   throw new Error('unexpected endpoint');
  };
  const result=await runCollection(store,{accountIds:[1],only:'index',clock:()=>now,fetchImpl,sleep:async()=>{}});
  assert.equal(result.failed,0);assert.equal(result.completed,4);
  assert.equal(calls.some(c=>c.path.endsWith('get_topic_relation')),false); // 不再采集话题关联视频与达人榜
  assert.deepEqual(calls.find(c=>c.path.endsWith('query_topic')).payload.param,{app_name:'aweme',keyword:'企业AI',start_date:'20261007',end_date:'20261105'});
  assert.equal(calls.some(c=>/portrait|multi_topic|daren/.test(c.path)),false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_topics').get().n,5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n,4); // The old work remains as history.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM account_works WHERE account_id=1 AND work_id=9999').get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM works WHERE url LIKE '%/105'").get().n,1); // 300赞视频随视频搜索直接入选
  assert.equal(db.prepare('SELECT published_at FROM works WHERE url LIKE \'%/101\'').get().published_at,'2026-11-06 02:00:00');
  const obs=db.prepare("SELECT * FROM collection_observations WHERE kind='work' AND object_id=(SELECT id FROM works WHERE url LIKE '%/101')").get();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM content_snapshots').get().n,1);
  assert.equal(obs.dimension,'videos');assert.equal(obs.effective_at,'20261105');assert.equal(JSON.parse(obs.metrics).likes,500);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_author_ids WHERE external_id IN ('700','900')").get().n,0); // 话题榜作者不再入库
  const view=collectionStatus(db,account(db,1),store).discovery;
  assert.equal(view.videos[0].likes,499);assert.equal(view.videos[0].fans,null);assert.equal(view.topics.length,5); // 499赞但指数最高，全量入选居首
  assert.equal(JSON.stringify(view).includes('fans_author_list'),false);assert.equal(JSON.stringify(view).includes('data_path'),false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'dx_%'").get().n,0);
  const before=db.prepare('SELECT COUNT(*) n FROM collection_runs').get().n;
  config(db,1,{index:{...account(db,1).config.index,discovery:{...account(db,1).config.index.discovery,excludeKeywords:['企业AI1']}}});
  planCollection(store,{accountIds:[1],now});
  assert.equal(collectionStatus(db,account(db,1),store).discovery.topics.length,4); // 排除词即时生效
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_tasks t JOIN collection_task_accounts a ON a.task_key=t.key WHERE a.account_id=1 AND t.operation='topic_relation'").get().n,0);
  db.prepare("DELETE FROM account_sources WHERE account_id=1 AND kind='keyword'").run();
  const filtered=collectionStatus(db,account(db,1),store).discovery;
  assert.deepEqual([filtered.keywords,filtered.topics,filtered.videos,filtered.authors],[[],[],[],[]]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_runs').get().n,before);
 }finally{db.close();}
});
test('指数返回登录页时暂停本账号授权范围，不将HTML当作采集数据', async () => {
 const {db,store}=setup();try{
  auth(db,1,'test-only');
  const result=await runCollection(store,{accountIds:[1],only:'index',clock:()=>base,sleep:async()=>{},fetchImpl:async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})});
  assert.equal(result.failed,1);
  const state=db.prepare("SELECT paused,error FROM collection_provider_state WHERE provider='index' AND scope='account:1'").get();
  assert.equal(state.paused,1);assert.equal(state.error,'login_required');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n,0);
 }finally{db.close();}
});
test('博主链路：昵称搜索解析为博主，作品按指数落库并进入详情视图', async () => {
 const {db,store}=setup();try{
  config(db,1,{index:{discovery:null,tasks:[]}});
  db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name) VALUES(1,'keyword','ai教程','ai教程')").run();
  auth(db,1,'valid');
  db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name) VALUES(1,'blogger_search','AI 造物笔记','AI 造物笔记')").run();
  const workRow=(id: string,text: string,likes: number,extra={})=>({item_id:id,video_text:text,like_cnt:String(likes),coment_cnt:'5',share_cnt:'2',follow_cnt:'1',rank:1,create_time:'20261101',video_url:`https://www.douyin.com/video/${id}`,...extra});
  const newest=workRow('7702','作品乙',60,{create_time:'20261107'});
  const sameDay=workRow('7703','作品丙',200,{create_time:'20261107'});
  const works={like_list:[workRow('7701','作品甲 #ai教程',100),sameDay,newest],comment_list:[],share_list:[],
   follow_list:[],index_list:[workRow('7701','作品甲 #ai教程',100)],create_time_list:[newest,sameDay]};
  const fetchImpl=async(input,init)=>{
   const p=new URL(String(input)).pathname;
   if(p.endsWith('get_topic_valid_date'))return json({data:{valid_day:'20261105',valid_week:'20261101'}});
   if(p.endsWith('query_topic'))return json({data:{topic_list:[]}});
   if(p.endsWith('itemQuery'))return json({data:{data:[]}});
   if(p.endsWith('get_sug_great_user_list')){assert.equal(JSON.parse(init.body).keyword,'AI 造物笔记');
    return json({data:{userlist:[{user_id:'diguser1',user_name:'别的达人'},{user_id:'diguser2',user_name:'AI 造物笔记',follow_count:'13277',like_count:'23973',item_count:'33',first_tag_name:'科技',second_tag_name:'前沿科技',aweme_url:'https://www.douyin.com/user/MS4wLjABAAAAWX1?src=todo'}]}});}
   if(p.endsWith('get_great_user_top_video')){assert.equal(JSON.parse(init.body).user_id,'diguser2');return json({data:works});}
   throw new Error('unexpected '+p);
  };
  const summary=await runCollection(store,{accountIds:[1],only:'index',clock:()=>base,fetchImpl,sleep:async()=>{}});
  assert.equal(summary.failed,0);
  const row=db.prepare("SELECT * FROM account_sources WHERE kind='blogger'").get();
  assert.equal(row.source_key,'diguser2');assert.equal(row.name,'AI 造物笔记');
  assert.deepEqual(JSON.parse(row.note),{secUid:'MS4wLjABAAAAWX1',fans:13277,likes:23973,items:33,tag1:'科技',tag2:'前沿科技',avatar:null});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM account_sources WHERE kind='blogger_search'").get().n,0);
  const work=db.prepare("SELECT w.url,w.title,w.author_id FROM works w JOIN account_works a ON a.work_id=w.id WHERE a.account_id=1 AND a.reason='index:blogger' AND w.url LIKE '%/7701'").get();
  assert.equal(work.url,'https://www.douyin.com/video/7701');assert.equal(work.title,'作品甲 #ai教程');assert.equal(work.author_id,'MS4wLjABAAAAWX1');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_observations WHERE kind='work' AND dimension='author_works'").get().n,3);
  const overview=bloggerOverview(db,store,1);
  assert.equal(overview.length,1);assert.equal(overview[0].worksCount,3);assert.equal(overview[0].profile.fans,13277);
  const detail=bloggerDetail(store,1,row);
  assert.deepEqual(detail.works.map(w=>w.id),['7702','7703','7701']);
  assert.equal(detail.works[0].likes,60);assert.equal(detail.works[0].url,'https://www.douyin.com/video/7702');
  assert.equal(detail.works[0].publishedAt,'2026-11-07T00:00:00+08:00');assert.equal(detail.trend,null);
  db.prepare("UPDATE works SET published_at='2026-11-07 02:00:00' WHERE url LIKE '%/7703'").run();
  assert.deepEqual(bloggerDetail(store,1,row).works.map(w=>w.id),['7703','7702','7701']);
 }finally{db.close();}
});
test('手动采集按范围独立：topic 只跑话题域，author 只跑达友域',async()=>{
 const {db,store}=setup();try{
  config(db,1,{index:{discovery:null,tasks:[]}});
  db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name) VALUES(1,'keyword','ai教程','ai教程')").run();
  auth(db,1,'valid');
  db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name) VALUES(1,'blogger_search','AI 造物笔记','AI 造物笔记')").run();
  const legacy=store.queue('index','account:1',{type:'author_dates'},[{id:1,configSha:'legacy'}]);
  const legacyRun=store.begin(legacy,base-DAY);
  store.finish(legacyRun,{datetime:'20261104'},'2026-11-06','legacy',()=>{},base-DAY);
  db.exec('PRAGMA user_version=7');
  migrate(db,':memory:');
  const migrated=collectionStatus(db,account(db,1),store,base);
  assert.ok(!migrated.tasks.some(t=>t.operation==='author_dates'));
  assert.ok(migrated.runs.some(r=>r.id===legacyRun.id));
  const calls:string[]=[],windows: {start_date:string;end_date:string}[]=[];
  const fetchImpl=async(input: any,init: any)=>{
   const p=new URL(String(input)).pathname;calls.push(p.split('/').pop()!);
   if(p.endsWith('get_topic_valid_date'))return json({data:{valid_day:'20261105',valid_week:'20261101'}});
   if(p.endsWith('query_topic'))return json({data:{topic_list:[]}});
   if(p.endsWith('itemQuery'))return json({data:{data:[]}});
   if(p.endsWith('get_sug_great_user_list'))return json({data:{userlist:[{user_id:'diguser2',user_name:'AI 造物笔记',follow_count:'13277',aweme_url:'https://www.douyin.com/user/MS4wLjABAAAAWX1'}]}});
   if(p.endsWith('get_great_user_top_video')){
    const {start_date,end_date}=JSON.parse(init.body);
    windows.push({start_date,end_date});
    return json({data:{like_list:[],comment_list:[],share_list:[],follow_list:[],index_list:[],create_time_list:[]}});
   }
   throw new Error('unexpected '+p);
  };
  // 先独立采达友域：昵称解析为博主、作品落库，同时到期的话题任务不被触碰。
  const opts={accountIds:[1],fetchImpl,sleep:async()=>{}};
  const author=await runCollection(store,{...opts,only:'author',clock:()=>base});
  assert.equal(author.failed,0);assert.equal(author.completed,2);
  assert.equal(collectionStatus(db,account(db,1),store,base+1000).tasks.find(t=>t.operation==='author_works')?.status,'collected');
  assert.deepEqual(calls,['get_sug_great_user_list','get_great_user_top_video']);
  assert.equal(db.prepare("SELECT source_key FROM account_sources WHERE kind='blogger'").get().source_key,'diguser2');
  calls.length=0;
  const midnight=Date.UTC(2026,10,7,16);
  await runCollection(store,{...opts,only:'author',clock:()=>midnight-1});
  assert.deepEqual(calls,[]);
  const topic=await runCollection(store,{...opts,only:'topic',clock:()=>midnight});
  assert.equal(topic.failed,0);assert.equal(topic.completed,4); // topic_dates + topic_search + 两个视频窗口
  assert.deepEqual(calls,['get_topic_valid_date','query_topic','itemQuery','itemQuery']);
  calls.length=0;
  await runCollection(store,{...opts,only:'author',clock:()=>midnight});
  assert.deepEqual(calls,['get_great_user_top_video']);
  assert.deepEqual(windows,[{start_date:'20261009',end_date:'20261107'},{start_date:'20261010',end_date:'20261108'}]);
 }finally{db.close();}
});
test('话题和视频独立采集有效期，达人跟随视频，定时只执行启用的范围',async()=>{
 const {db,store}=setup();try{
  db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name) VALUES(1,'keyword','独立榜单','独立榜单')").run();
  auth(db,1,'valid');
  const schedules=account(db,1).config.schedules;
  config(db,1,{schedules:{...schedules,video_rank:{...schedules.video_rank,enabled:true}}});
  let now=base,version='20261105';
  const calls:string[]=[];
  const fetchImpl=async(input:any)=>{
   const endpoint=new URL(String(input)).pathname.split('/').pop()!;
   calls.push(endpoint);
   if(endpoint==='get_topic_valid_date')return json({data:{valid_day:version,valid_week:'20261101'}});
   if(endpoint==='query_topic')return json({data:{topic_list:[{topic_id:'77',topic_name:'测试话题',topic_index:'100'}]}});
   if(endpoint==='itemQuery')return json({data:{data:[{itemId:'123',title:'测试视频',likes:'600',index:'1000',nickname:'测试作者'}]}});
   throw new Error('unexpected endpoint');
  };
  const opts={accountIds:[1],clock:()=>now,fetchImpl,sleep:async()=>{}};
  const read=()=>collectionStatus(db,account(db,1),store).discovery;

  await runCollection(store,{...opts,only:'topic_rank',scheduled:true});
  assert.deepEqual(calls,[]);
  await runCollection(store,{...opts,only:'topic_rank'});
  assert.deepEqual(calls,['get_topic_valid_date','query_topic']);
  assert.deepEqual(read().versions,{topics:version,videos:null});
  assert.equal(read().topics.length,1);
  assert.equal(read().videos.length,0);
  calls.length=0;
  await runCollection(store,{...opts,only:'video_rank',scheduled:true});
  assert.deepEqual(calls,['itemQuery','itemQuery']);
  assert.deepEqual(read().versions,{topics:version,videos:version});
  assert.equal(read().authors[0].name,'测试作者');

  now+=DAY+1000;version='20261106';calls.length=0;
  await runCollection(store,{...opts,only:'topic_rank'});
  assert.deepEqual(calls,['get_topic_valid_date','query_topic']);
  assert.deepEqual(read().versions,{topics:version,videos:'20261105'});
  assert.deepEqual(read().pending.videos,['独立榜单']);
  assert.equal(read().authors[0].name,'测试作者');
  calls.length=0;
  await runCollection(store,{...opts,only:'video_rank',scheduled:true});
  assert.deepEqual(calls,['itemQuery','itemQuery']);
  assert.deepEqual(read().versions,{topics:version,videos:version});
  assert.deepEqual(read().pending.videos,[]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_requests WHERE provider='index'").get().n,8);

  now+=DAY+1000;version='20261107';calls.length=0;
  await runCollection(store,{...opts,only:'video_rank',scheduled:true});
  assert.deepEqual(calls,['get_topic_valid_date','itemQuery','itemQuery']);
  assert.deepEqual(read().versions,{topics:'20261106',videos:version});
  assert.deepEqual(read().pending.topicSearch,['独立榜单']);
  assert.equal(read().videos.length,1);
  assert.equal(read().authors[0].name,'测试作者');
 }finally{db.close();}
});
