import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv } from 'node:crypto';
import { decode, parseJson, PATHS, requestFor, unwrap, validateData, semanticHash } from '../../collector/sources/douyin-index/protocol.ts';
import { ReadClient, loadAuth } from '../../collector/sources/douyin-index/client.ts';

const dates={topic:{valid_day:'20261105',valid_week:'20261101'}};
test('官方周窗口正确生成；阻止任意URL与非法ID',()=>{
 assert.deepEqual(requestFor({type:'topic_relation',id:'123'},dates).payload,{app_name:'aweme',topic_ids:['123'],begin_date:'20261026',end_date:'20261101'});
 assert.equal(requestFor({type:'videos',keyword:'企业AI',days:7},dates).payload.dateType,7);
 assert.equal(requestFor({type:'videos',keyword:'企业AI',days:30},dates).payload.dateType,30);
 assert.throws(()=>requestFor({type:'videos',keyword:'企业AI',days:14},dates),/invalid_video_window/);
 assert.deepEqual(requestFor({type:'topic_search',keyword:'企业AI'},dates).payload.param,{app_name:'aweme',keyword:'企业AI',start_date:'20261007',end_date:'20261105'});
 assert.throws(()=>requestFor({type:'https://evil.test'},dates),/not_allowed/);
 assert.throws(()=>requestFor({type:'topic_relation',id:'not-numeric'},dates),/topic_id/);
});
test('保留19位ID；解密官方模式2；只有BaseResp不冒充关联数据',()=>{
 assert.equal(parseJson('{"id":9000000000000000001}').id,'9000000000000000001');
 const cipher=createCipheriv('aes-128-cbc',Buffer.from('SjXbYTJb7zXoUToSicUL3A==','base64'),Buffer.from('OekMLjghRg8vlX/PemLc+Q==','base64'));
 const encrypted=Buffer.concat([cipher.update('{"data":[{"id":9000000000000000001}]}'),cipher.final()]).toString('base64');
 assert.equal(decode(JSON.stringify({data:encrypted}),'2').data[0].id,'9000000000000000001');
 assert.throws(()=>validateData('topic_relation',{BaseResp:{StatusCode:0}}),/schema_error/);
});
test('媒体签名、排名、顺序不产生新内容变化；真实指标变化仍可识别',()=>{
 const a={data:[{itemId:'1',url:'signed1',likes:5},{itemId:'2',url:'signed2'}]};
 const b={data:[{itemId:'2',url:'signed3'},{itemId:'1',url:'signed4',likes:9}]};
 assert.equal(semanticHash('videos',a),semanticHash('videos',b));
 b.data.push({itemId:'3'});assert.notEqual(semanticHash('videos',a),semanticHash('videos',b));
});
test('直接HTTP使用固定源、只读白名单，不导出凭据；登录、限流、业务错误停止',async()=>{
 let init;const task={type:'videos',keyword:'AI创业',days:7},req=requestFor(task,dates);
 const client=new ReadClient({cookie:'private-cookie'},{sleep:async()=>{},fetchImpl:async(url,options)=>{assert.equal(url,'https://creator.douyin.com'+PATHS.videos);init=options;return new Response('{"status":0,"data":{"data":[]}}');}});
 const result=await client.read(task,req);assert.equal(init.headers.cookie,'private-cookie');assert.equal(init.redirect,'error');assert.ok(!JSON.stringify(result).includes('private-cookie'));
 for(const [status,body,error]of[[401,'{}','login_required'],[429,'{}','rate_limited'],[200,'{"status":5}','business_error'],[200,'<html>login</html>','login_or_challenge_html']]){
  const c=new ReadClient({cookie:'secret'},{sleep:async()=>{},fetchImpl:async()=>new Response(body,{status})});await assert.rejects(c.read(task,req),new RegExp(error));
 }
 await assert.rejects(client.read(task,{...req,path:'/api/delete'}),/not_allowed/);
});
test('登录文件权限必须私密，支持Cookie和外部storageState，不读取浏览器配置',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dx-auth-')),file=join(dir,'auth.json');
 writeFileSync(file,JSON.stringify({cookie:'fixture-cookie'}),{mode:0o600});assert.equal(loadAuth(file,{}).cookie,'fixture-cookie');
 // Windows的mode不区分组/其他位，0600位校验仅在POSIX上执行。
 if(process.platform!=='win32'){chmodSync(file,0o644);assert.throws(()=>loadAuth(file,{}),/0600/);}
 writeFileSync(file,JSON.stringify({cookies:[{domain:'.douyin.com',name:'sessionid',value:'test-only',expires:-1},{domain:'other.test',name:'bad',value:'never-use'}]}));chmodSync(file,0o600);assert.equal(loadAuth(file,{}).cookie,'sessionid=test-only');
});
