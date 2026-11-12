import test from 'node:test';
import assert from 'node:assert/strict';
import {Discovery,collectionPolicy,normalize} from '../../collector/core/discovery.ts';
const policy={excludeKeywords:['AIGC','抽象','搞笑','猫咪','AI短剧']};
const window={begin:'20261007',end:'20261105',days:30};
function add(d,type,data,id=1,extra={}){d.ingest({type,data,run:{id,version:'20261105',observed_at:'2026-11-07 02:00:00'},window:type==='topic_search'?window:{end:'20261105',days:7},keyword:'AI创业',...extra});}
const topic=(id,index,name='企业AI')=>({topic_id:String(id),topic_name:name,topic_index:String(index)});
const video=(id,likes=100,extra={})=>({itemId:String(id),title:'企业AI工作流',likes:String(likes),index:'20',nickname:'测试作者',...extra});

test('30天指数先过硬门槛再全局取前三，低指数、未知和累计数据均不凑数',()=>{
 const d=new Discovery(policy,['AI创业','企业AI']);
 add(d,'topic_search',{topic_list:[topic(1,9999),topic(2,10000),topic(3,30000),topic(4,20000),topic(5,40000),topic(6,999999,'搞笑AI创业')]});
 add(d,'topic_search',{topic_list:[topic(7,999999)]},2,{window:null});
 assert.deepEqual(d.topics().map(t=>t.id),['5','3','4']);
 const empty=new Discovery(policy);add(empty,'topic_search',{topic_list:[topic(1,9999),{topic_id:'2',topic_name:'企业AI'}]});
 assert.equal(empty.topics().length,0);assert.equal(empty.tasks().length,0);
});
test('保留话题不派生关联任务，不扩词、不抓趋势、人群或达人详情',()=>{
 const d=new Discovery(policy,['AI创业']);add(d,'topic_search',{topic_list:[topic(1,15000)]});
 add(d,'videos',[video(1,100,{title:'企业AI #企业AI交付 #销售Agent'})],2);
 assert.deepEqual(d.tasks().map(t=>t.type),['topic_search','videos']);
 assert.deepEqual(d.report().keywords,['AI创业']);
});
test('100赞边界保留，未知和99赞拒绝',()=>{
 const d=new Discovery(policy);add(d,'topic_search',{topic_list:[topic(1,20000)]});
 add(d,'videos',[video(10,100,{fans:12,duration:60}),video(11,99),video(12,null)],3);
 const report=d.report();assert.equal(report.counts.uniqueVideos,3);assert.equal(report.videos.length,1);
 assert.equal(report.videos[0].sources.length,1);assert.equal(report.videos[0].likes,100);
 assert.equal(report.videos[0].fans,12);assert.equal(report.counts.rejected.likes,2);
});
test('标题或标签命中排除词都拒绝，匹配兼容全角、大小写和空格',()=>{
 const d=new Discovery(policy);add(d,'topic_search',{topic_list:[topic(1,20000)]});
 add(d,'videos',[video(1,200,{title:'企业AI猫咪'}),video(2,200,{title:'企业AI #ＡＩＧＣ'}),video(3,200,{title:'企业AI #AI 短剧'}),video(4,200),video(5,200,{tags:['猫咪']})],3);
 assert.deepEqual(d.report().videos.map(v=>v.id),['4']);assert.equal(d.report().counts.rejected.keywords,4);
 assert.equal(normalize(' ＡＩ 创业 '),'ai创业');
});
test('不同查询指数分别排序，保留上限作用于入库选择，达人只来自高指数入选视频',()=>{
 const d=new Discovery({...policy,maxVideos:2});
 add(d,'videos',[video(1,100,{index:'50',nickname:'甲'}),video(2,100,{index:'10',nickname:'乙'})]);
 add(d,'videos',[video(3,100,{index:'999',nickname:'丙'})],2,{keyword:'企业AI'});
 const r=d.report();assert.deepEqual(r.videos.map(v=>v.id),['1','3']);assert.equal(r.counts.eligibleVideos,3);
 assert.deepEqual(r.authors.map(a=>a.name).sort(),['丙','甲'].sort());
});
test('规则不继承账号排除词，禁止把点赞底线调低或扩大话题名额',()=>{
 assert.deepEqual(collectionPolicy().excludeKeywords,[]);
 assert.throws(()=>collectionPolicy({minVideoLikes:99}),/limit/);
 assert.equal(collectionPolicy({maxTopics:5}).maxTopics,5);
 assert.throws(()=>collectionPolicy({maxTopics:6}),/limit/);
 assert.throws(()=>collectionPolicy({excludeKeywords:'猫咪'}),/terms/);
});

test('达人按入选视频作者归类汇总近7天指数，昵称命中排除词的拒绝',()=>{
 const d=new Discovery(policy);
 add(d,'videos',[video(1,100,{nickname:'作者甲'}),video(2,100,{nickname:'作者乙'})]);
 add(d,'videos',[video(3,100,{nickname:'作者甲',index:'30'}),video(4,100,{nickname:'猫咪作者'})],2,{keyword:'企业AI'});
 const authors=d.report().authors,jia=authors.find(a=>a.name==='作者甲')!;
 assert.equal(jia.videos.length,2);assert.equal(jia.totalIndex,50); // 20+30
 assert.equal(authors.some(a=>a.name==='猫咪作者'),false);
 assert.equal(authors.every(a=>a.topics===undefined),true);
});
