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
const {collectionStatus}=await import('../collector/core/status.ts');
const {defaultSchedules}=await import('../lib/collection-schedule.ts');
const DAY=86400000,HOUR=3600000,base=Date.UTC(2026,10,7,2);
function setup(){const db=new DatabaseSync(':memory:');migrate(db,':memory:');createAccount(db,'采集测试账号');db.prepare('UPDATE collection_limits SET interval_ms=0').run();return {db,store:new CollectionStore(db,join(root,hash(Math.random()))) };}
function account(db,id){const a=db.prepare('SELECT * FROM accounts WHERE id=?').get(id);return {...a,config:JSON.parse(a.config)};}
function config(db,id,patch){const a=account(db,id);db.prepare('UPDATE accounts SET config=? WHERE id=?').run(JSON.stringify({...a.config,...patch}),id);}
function auth(db,id,cookie){const file=join(root,`auth-${id}-${Math.random()}.json`);writeFileSync(file,JSON.stringify({cookie}),{mode:0o600});db.prepare('INSERT INTO collection_credentials VALUES(?,?,?)').run(id,file,`account:${id}`);}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
test('某账号登录失效不影响另一账号，同词查询与结果归属隔离',async()=>{
 const {db,store}=setup();try{
  const second=createAccount(db,'独立账号');
  for(const id of [1,second.id]){config(db,id,{index:{discovery:null,tasks:[]}});db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name) VALUES(?,'keyword','共用词','共用词')").run(id);auth(db,id,id===1?'expired':'valid');}
  const calls=[],fetchImpl=async(input,init)=>{
   const u=new URL(String(input));calls.push({path:u.pathname,cookie:init.headers.cookie});if(init.headers.cookie==='expired')return json({},401);
   if(u.pathname.endsWith('get_topic_valid_date'))return json({data:{valid_day:'20261105',valid_week:'20261101'}});
   if(u.pathname.endsWith('get_greater_users_valid_date'))return json({data:{datetime:'20261104'}});
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
  config(db,1,{index:{discovery:null,tasks:[{type:'topic_search',keyword:'测试'}]}});auth(db,1,'valid');let version='20261105',now=base,business=0;
  const fetchImpl=async(input,init)=>{const p=new URL(String(input)).pathname;if(p.endsWith('get_topic_valid_date'))return json({data:{valid_day:version,valid_week:'20261101'}});business++;const payload=JSON.parse(init.body);if(p.endsWith('query_topic')){assert.ok(payload.param.start_date);return json({data:{topic_list:[]}});}return json({data:{data:[]}});};
  const legacy=store.queue('index','account:1',{type:'topic_search',keyword:'测试'},[{id:1,configSha:'legacy'}]);
  store.claim(legacy,base-DAY);const old=store.begin(legacy,base-DAY);
  const slot=store.reserve(old,'/api/v2/index/query_topic',base-DAY,null,{body:{param:{start_date:'',end_date:version}}});
  store.requestResult(slot.id,'{}',200);store.finish(old,{topic_list:[{topic_id:'99',topic_name:'累计旧话题',topic_index:'999999'}]},version,'legacy',()=>{},base-DAY);store.release(legacy,base+DAY);
  const opts={accountIds:[1],only:'index',clock:()=>now,fetchImpl,sleep:async()=>{}};await runCollection(store,opts);assert.equal(business,3); // topic + two video windows, all legitimately empty
  now+=DAY+1;version='20261106';await runCollection(store,opts);assert.equal(business,6);
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
  const fetchImpl=async input=>{calls++;return json({data:new URL(String(input)).pathname.endsWith('get_topic_valid_date')?{valid_day:'20261105',valid_week:'20261101'}:{datetime:'20261104'}});};
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

test('指数按30天门槛与保留数入选，筛后入库并保留可用指标；历史记录不删除',async()=>{
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
  assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_topics').get().n,4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n,3); // The old work remains as history.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM account_works WHERE account_id=1 AND work_id=9999').get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM works WHERE url LIKE '%/105'").get().n,1); // 300赞视频随视频搜索直接入选
  assert.equal(db.prepare('SELECT published_at FROM works WHERE url LIKE \'%/101\'').get().published_at,'2026-11-06 02:00:00');
  const obs=db.prepare("SELECT * FROM collection_observations WHERE kind='work' AND object_id=(SELECT id FROM works WHERE url LIKE '%/101')").get();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM content_snapshots').get().n,1);
  assert.equal(obs.dimension,'videos');assert.equal(obs.effective_at,'20261105');assert.equal(JSON.parse(obs.metrics).likes,500);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_author_ids WHERE external_id IN ('700','900')").get().n,0); // 话题榜作者不再入库
  const view=collectionStatus(db,account(db,1),store).discovery;
  assert.equal(view.videos[0].fans,1200);assert.equal(view.topics.length,4);
  assert.equal(JSON.stringify(view).includes('fans_author_list'),false);assert.equal(JSON.stringify(view).includes('data_path'),false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'dx_%'").get().n,0);
  const before=db.prepare('SELECT COUNT(*) n FROM collection_runs').get().n;
  config(db,1,{index:{...account(db,1).config.index,discovery:{...account(db,1).config.index.discovery,minTopicIndex:999999}}});
  planCollection(store,{accountIds:[1],now});
  assert.equal(collectionStatus(db,account(db,1),store).discovery.topics.length,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_tasks t JOIN collection_task_accounts a ON a.task_key=t.key WHERE a.account_id=1 AND t.operation='topic_relation'").get().n,0);
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
