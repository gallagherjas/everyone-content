import { openDb } from "../lib/db.ts";
import { DATA } from "../lib/strategies.ts";
import { lock,withTask } from "../lib/tasks.ts";
import { CollectionStore,PROVIDERS } from "./core/store.mjs";
import { planCollection,collectionAccounts } from "./core/planner.mjs";
import { runCollection } from "./core/runner.mjs";
import { registerAuth,configureIndex } from "./core/settings.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key,...value]=arg.replace(/^--/, "").split("="); return [key,value.join("=")||true]; }));
const db=openDb();
let unlock: (()=>void)|undefined;
try {
  if(Object.keys(args).some(k=>!["account","scheduled","only","plan","config","auth","limit"].includes(k)))throw new Error("未知采集参数");
  if(args.only&&!PROVIDERS.includes(args.only))throw new Error("未知采集来源");
  const id=Number(args.account), options={...(id?{accountIds:[id]}:{}),scheduled:!!args.scheduled,...(typeof args.only==="string"?{only:args.only}:{}),...(args.limit?{requestLimit:Number(args.limit)}:{})};
  if(args.account&&(!Number.isSafeInteger(id)||id<1))throw new Error("账号编号无效");
  if(args.limit&&(!Number.isSafeInteger(options.requestLimit)||Number(options.requestLimit)<1))throw new Error("未知或无效的请求上限");
  unlock=lock("collection");
  const store=new CollectionStore(db,DATA);
  if(args.auth||args.config){
    if(!id)throw new Error("必须为授权或策略明确指定账号");
    if(typeof args.config==="string")configureIndex(store,id,args.config);
    if(typeof args.auth==="string")registerAuth(store,id,args.auth);
  }
  if(args.plan) {
    const accounts=planCollection(store,options);
    console.log(JSON.stringify({accounts:accounts.map((a:any)=>a.id),due:store.dueTasks(accounts.map((a:any)=>a.id)).map((t:any)=>({provider:t.provider,operation:t.operation,target:t.target}))}));
  } else {
    const accounts=collectionAccounts(db,options);
    if(!accounts.length)console.log("没有启用的采集账号，本轮跳过。");
    else {
      const lines: {line:string;ids:number[]}[]=[];
      const runId=Number(process.env.EVERYONE_CONTENT_RUN_ID);
      const result=await runCollection(store,{...options,
        log:(line:string,ids:number[])=>{lines.push({line,ids});console.log(line);},
        progress:(percent:number)=>{if(runId&&id)db.prepare('UPDATE task_runs SET progress=? WHERE id=? AND account_id=?').run(percent,runId,id);}});
      for(const a of accounts)await withTask(db,a,"collect",async(log)=>{for(const entry of lines.filter(e=>e.ids.includes(a.id)))log(entry.line);log(JSON.stringify(result.accounts[a.id]));if(result.accounts[a.id].failed)return "partial";});
    }
  }
} catch(error) { console.error(error instanceof Error&&/^(未知|账号|没有|必须|授权|原始)/.test(error.message)?error.message:"采集未完成，请查看账号采集状态与失败原因。");process.exitCode=1; }
finally {unlock?.();db.close();}
