import { collectionPolicy } from './discovery.ts';
import { requestFor,PATHS } from '../sources/douyin-index/protocol.ts';
// 指数功能是否启用由“是否登记授权文件”决定，这里不再保存独立开关。
export function indexConfig(value: any={discovery:null,tasks:[]}) {
  if(!value||typeof value!=='object'||!Array.isArray(value.tasks)||value.tasks.length>100)throw new Error('指数配置无效');
  const tasks=value.tasks.flatMap((t: any)=>{
    if(!Object.hasOwn(PATHS,t.type)||t.type.endsWith('_dates'))throw new Error('指数任务类型无效');
    if(!['videos','topic_search'].includes(t.type))return [];
    requestFor(t,{topic:{valid_day:'20261105'}});
    return [{type:t.type,keyword:t.keyword,...(t.type==='videos'?{days:t.days}:{})}];
  });
  return {discovery:value.discovery===null?null:collectionPolicy(value.discovery),tasks};
}
