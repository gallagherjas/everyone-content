import test from 'node:test';
import assert from 'node:assert/strict';
import {Discovery,collectionPolicy,normalize} from '../../collector/core/discovery.ts';
const policy={excludeKeywords:['AIGC','抽象','搞笑','猫咪','AI短剧']};
const window={begin:'20261007',end:'20261105',days:30};
function add(d,type,data,id=1,extra={}){d.ingest({type,data,run:{id,version:'20261105',observed_at:'2026-11-07 02:00:00'},window:type==='topic_search'?window:{end:'20261105',days:7},keyword:'AI创业',...(type==='videos'?{days:7}:{}),...extra});}
const topic=(id,index,name='企业AI')=>({topic_id:String(id),topic_name:name,topic_index:String(index)});
const video=(id,likes=500,extra={})=>({itemId:String(id),title:'企业AI工作流',likes:String(likes),index:'20',nickname:'测试作者',...extra});

test('话题全量入选按30天指数排序；未知指数与7天窗口数据不参与，排除词生效',()=>{
 const d=new Discovery(policy,['AI创业','企业AI']);
 add(d,'topic_search',{topic_list:[topic(1,9999),topic(2,10000),topic(3,30000),topic(4,20000),topic(5,40000),topic(6,999999,'搞笑AI创业')]});
 add(d,'topic_search',{topic_list:[topic(7,999999)]},2,{window:null});
 assert.deepEqual(d.topics().map(t=>t.id),['5','3','4','2','1']);
 const empty=new Discovery(policy);add(empty,'topic_search',{topic_list:[topic(1,9999),{topic_id:'2',topic_name:'企业AI'}]});
 assert.equal(empty.topics().length,1);assert.equal(empty.tasks().length,0);
});
test('话题不派生关联任务，任务只随关键词生成',()=>{
 const d=new Discovery(policy,['AI创业']);add(d,'topic_search',{topic_list:[topic(1,15000)]});
 add(d,'videos',[video(1,500,{title:'企业AI #企业AI交付 #销售Agent'})],2);
 assert.deepEqual(d.tasks().map(t=>t.type),['topic_search','videos','videos']);
 assert.deepEqual(d.report().keywords,['AI创业']);
});
test('无点赞与低点赞视频同样入选，点赞数保留为指标并参与同分排序',()=>{
 const d=new Discovery(policy);add(d,'topic_search',{topic_list:[topic(1,20000)]});
 add(d,'videos',[video(10,500,{fans:12,duration:60}),video(11,499),video(12,null)],3);
 const report=d.report();assert.equal(report.counts.uniqueVideos,3);assert.equal(report.videos.length,3);
 assert.equal(report.videos[0].sources.length,1);assert.equal(report.videos[0].likes,500);
 assert.equal(report.videos[0].fans,12);assert.equal(report.videos.find(v=>v.id==='12')!.likes,null);
});
test('标题或标签命中排除词都拒绝，匹配兼容全角、大小写和空格',()=>{
 const d=new Discovery(policy);add(d,'topic_search',{topic_list:[topic(1,20000)]});
 add(d,'videos',[video(1,500,{title:'企业AI猫咪'}),video(2,500,{title:'企业AI #ＡＩＧＣ'}),video(3,500,{title:'企业AI #AI 短剧'}),video(4,500),video(5,500,{tags:['猫咪']})],3);
 assert.deepEqual(d.report().videos.map(v=>v.id),['4']);assert.equal(d.report().counts.excludedKeywords,4);
 assert.equal(normalize(' ＡＩ 创业 '),'ai创业');
});
test('跨关键词全量入选，按两窗口指数之和全局排序',()=>{
 const d=new Discovery(policy);
 add(d,'videos',[video(1,500,{index:'50',nickname:'甲'}),video(2,500,{index:'10',nickname:'乙'})]);
 add(d,'videos',[video(3,500,{index:'999',nickname:'丙'})],2,{keyword:'企业AI'});
 const r=d.report();assert.deepEqual(r.videos.map(v=>v.id),['3','1','2']);assert.equal(r.counts.uniqueVideos,3);
 assert.deepEqual(r.authors.map(a=>a.name).sort(),['丙','甲','乙'].sort());
});
test('策略只保留排除词，历史数值参数被忽略，非法排除词仍报错',()=>{
 assert.deepEqual(collectionPolicy().excludeKeywords,[]);
 assert.deepEqual(collectionPolicy({excludeKeywords:['AIGC'],minVideoLikes:499,maxTopics:99}).excludeKeywords,['AIGC']);
 assert.throws(()=>collectionPolicy({excludeKeywords:'猫咪'}),/terms/);
});

test('达人按入选视频作者归类汇总近30天指数，近7天不计入，昵称命中排除词的拒绝',()=>{
 const d=new Discovery(policy);
 add(d,'videos',[video(1,500,{nickname:'作者甲',index:'20'}),video(2,500,{nickname:'作者乙',index:'20'})]);
 add(d,'videos',[video(3,500,{nickname:'作者甲',index:'30'}),video(4,500,{nickname:'猫咪作者',index:'30'})],2,{keyword:'企业AI',days:30});
 const authors=d.report().authors,jia=authors.find(a=>a.name==='作者甲')!;
 assert.equal(jia.videos.length,2);assert.equal(jia.totalIndex,30); // 仅30天窗口的30计入
 assert.equal(authors.find(a=>a.name==='作者乙')!.totalIndex,0); // 乙只有7天指数
 assert.equal(authors.some(a=>a.name==='猫咪作者'),false);
});
test('视频自带徽标原样保留并跨窗口并集',()=>{
 const d=new Discovery(policy);
 add(d,'videos',[video(1,500,{isLowFansButHot:1})]);
 add(d,'videos',[video(1,500,{isHighFansRiseRate:1,isHighPlayOverRate:'0'})],2,{days:30});
 assert.deepEqual([...d.report().videos[0].badges].sort(),['highFansRise','lowFansHot']);
});
test('两窗口指数同等独立记录，按两窗之和全局排序',()=>{
 const d=new Discovery(policy);
 add(d,'videos',[video(1,500,{index:'50'})],1);
 add(d,'videos',[video(2,500,{index:'400'})],2,{days:30});
 add(d,'videos',[video(3,500,{index:'999'})],3,{keyword:'企业AI',days:7});
 const r=d.report();
 assert.deepEqual(r.videos.find(v=>v.id==='2').indexBy,{7:null,30:400});
 assert.deepEqual(r.videos.find(v=>v.id==='3').indexBy,{7:999,30:null});
 assert.deepEqual(r.videos.map(v=>v.id),['3','2','1']); // 按两窗之和降序：999、400、50
});
