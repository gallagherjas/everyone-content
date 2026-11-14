import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';

export const PROVIDERS = ['index', 'douyin', 'xhs', 'bili'];
export const hash = (value: any): string => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const stamp = (ms: number): string => new Date(ms).toISOString().slice(0,19).replace('T',' ');
export const taskKey = (provider: string,scope: string,spec: any): string => hash({provider,scope,type:spec.type,id:spec.id??null,keyword:spec.keyword??null,
  ...(provider==='index'&&spec.type==='topic_search'?{windowDays:spec.windowDays??null}:{})
  ,...(provider==='index'&&spec.type==='videos'?{days:spec.days??null}:{}),contract:provider==='index'?2:1});
export const taskTarget = (spec: any): string => spec.type==='videos' ? `${spec.keyword}#${spec.days}` : String(spec.id??spec.keyword??spec.type);
export function atomic<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('SAVEPOINT collection_write');
  try { const result=fn(); db.exec('RELEASE collection_write'); return result; }
  catch(error) { db.exec('ROLLBACK TO collection_write; RELEASE collection_write'); throw error; }
}
export class CollectionStore {
  db: DatabaseSync; directory: string; owner: string;
  constructor(db: DatabaseSync, directory: string) { this.db=db; this.directory=resolve(directory,'collection'); this.owner=randomUUID(); }
  artifact(value: any): {path: string; sha: string} {
    const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value)),sha=hash(bytes);
    const dir=join(this.directory,'objects',sha.slice(0,2));mkdirSync(dir,{recursive:true,mode:0o700});
    const path=join(dir,sha+'.json.gz');
    if(!existsSync(path))writeFileSync(path,gzipSync(bytes),{mode:0o600,flag:'wx'});
    return {path,sha};
  }
  read(path: string,sha: string): string {
    // 用relative判断归属，路径分隔符在Windows上同样正确。
    const inside=relative(join(this.directory,'objects'),resolve(path));
    if(!inside||inside.startsWith('..')||isAbsolute(inside))throw new Error('artifact_scope_mismatch');
    const bytes=gunzipSync(readFileSync(path));if(hash(bytes)!==sha)throw new Error('artifact_checksum_mismatch');return bytes.toString('utf8');
  }
  data(run: any): any { return JSON.parse(this.read(run.data_path,run.data_sha)); }
  queue(provider: string,scope: string,spec: any,accounts: {id: number; configSha: string}[],{interval=86400000,priority=1}:{interval?: number;priority?: number}={}) {
    if(!PROVIDERS.includes(provider))throw new Error('未知采集来源');
    const key=taskKey(provider,scope,spec),target=taskTarget(spec);
    this.db.prepare(`INSERT INTO collection_tasks(key,provider,scope,operation,target,spec,priority,interval_ms)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET spec=excluded.spec,priority=excluded.priority,
      next_run_at=CASE WHEN collection_tasks.interval_ms<>excluded.interval_ms AND collection_tasks.last_success_at IS NOT NULL AND collection_tasks.failures=0
        THEN collection_tasks.last_success_at+excluded.interval_ms ELSE collection_tasks.next_run_at END,
      interval_ms=excluded.interval_ms`).run(key,provider,scope,spec.type,target,JSON.stringify(spec),priority,interval);
    for(const a of accounts)this.db.prepare(`INSERT INTO collection_task_accounts VALUES(?,?,?)
      ON CONFLICT(task_key,account_id) DO UPDATE SET config_sha=excluded.config_sha`).run(key,a.id,a.configSha);
    return this.db.prepare('SELECT * FROM collection_tasks WHERE key=?').get(key) as any;
  }
  latest(key: string): any { return this.db.prepare("SELECT * FROM collection_runs WHERE task_key=? AND status='ok' ORDER BY id DESC LIMIT 1").get(key) as any; }
  accounts(key: string): any[] { return this.db.prepare('SELECT a.*,ta.config_sha FROM collection_task_accounts ta JOIN accounts a ON a.id=ta.account_id WHERE task_key=? AND a.status=\'active\'').all(key) as any[]; }
  dueTasks(accountIds: number[],now=Date.now()): any[] {
    if(!accountIds.length)return [];
    return this.db.prepare(`SELECT DISTINCT t.* FROM collection_tasks t JOIN collection_task_accounts a ON a.task_key=t.key
      LEFT JOIN collection_provider_state p ON p.provider=t.provider AND p.scope=t.scope
      WHERE a.account_id IN (${accountIds.map(()=>'?').join(',')}) AND t.provider IN (${PROVIDERS.map(()=>'?').join(',')}) AND t.disabled=0 AND t.next_run_at<=?
      AND t.lease_until<=? AND COALESCE(p.paused,0)=0 ORDER BY t.priority DESC,t.next_run_at,t.key`).all(...accountIds,...PROVIDERS,now,now) as any[];
  }
  claim(task: any,now=Date.now()): boolean {
    return this.db.prepare('UPDATE collection_tasks SET lease_owner=?,lease_until=? WHERE key=? AND lease_until<=? AND next_run_at<=?')
      .run(this.owner,now+900000,task.key,now,now).changes===1;
  }
  release(task: any,next: number,error: string | null=null): void {
    this.db.prepare('UPDATE collection_tasks SET lease_owner=NULL,lease_until=0,next_run_at=?,error=? WHERE key=? AND lease_owner=?')
      .run(next,error,task.key,this.owner);
  }
  begin(task: any,now=Date.now(),sourceKey: string | null=null,accountIds: number[] | null=null): any {
    const id=Number(this.db.prepare(`INSERT INTO collection_runs(task_key,provider,scope,operation,target,request,observed_at,at_ms,source_key)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(task.key,task.provider,task.scope,task.operation,task.target,task.spec,stamp(now),now,sourceKey).lastInsertRowid);
    for(const a of this.accounts(task.key).filter(a=>!accountIds||accountIds.includes(a.id)))
      this.db.prepare('INSERT INTO collection_run_accounts VALUES(?,?,?)').run(id,a.id,a.config_sha);
    return this.db.prepare('SELECT * FROM collection_runs WHERE id=?').get(id) as any;
  }
  reserve(run: any,endpoint: string,now=Date.now(),sourceKey: string | null=null,parameters: Record<string, unknown>={}): {id: number; wait: number} {
    return atomic(this.db,()=>{
      const limit=this.db.prepare('SELECT * FROM collection_limits WHERE provider=?').get(run.provider) as any;
      const state=this.db.prepare('SELECT * FROM collection_provider_state WHERE provider=? AND scope=?').get(run.provider,run.scope) as any;
      if(state?.paused)throw new Error('source_paused');
      const previous=(this.db.prepare('SELECT MAX(last_request_at) at FROM collection_provider_state WHERE provider=?').get(run.provider) as any)?.at??0;
      const at=sourceKey?now:Math.max(now,previous+limit.interval_ms);
      // 距离允许的请求窗口还很久时不占额度不占锁,任务延后到窗口时刻,由下一次采集触发;避免进程内长睡冻结进度并独占采集资源。
      if(!sourceKey&&at-now>600000)throw new Error(`interval_pending ${at}`);
      const day=new Date(at).toISOString().slice(0,10);
      const used=(this.db.prepare('SELECT COUNT(*) n FROM collection_requests WHERE provider=? AND day=?').get(run.provider,day) as any).n;
      if(used>=limit.daily_limit)throw new Error('daily_budget_exhausted');
      const id=Number(this.db.prepare('INSERT INTO collection_requests(run_id,provider,scope,day,at_ms,endpoint,source_key,parameters) VALUES(?,?,?,?,?,?,?,?)')
        .run(run.id,run.provider,run.scope,day,at,endpoint,sourceKey,JSON.stringify(parameters)).lastInsertRowid);
      this.db.prepare(`INSERT INTO collection_provider_state(provider,scope,last_request_at) VALUES(?,?,?)
        ON CONFLICT(provider,scope) DO UPDATE SET last_request_at=MAX(last_request_at,excluded.last_request_at)`).run(run.provider,run.scope,at);
      this.db.prepare('UPDATE collection_tasks SET lease_until=? WHERE key=? AND lease_owner=?').run(at+900000,run.task_key,this.owner);
      return {id,wait:at-now};
    });
  }
  requestResult(id: number,text: string | null,status: number,encryption: string | null=null): void {
    const raw=typeof text==='string'&&!/^\s*</.test(text)?this.artifact(text):null;
    this.db.prepare('UPDATE collection_requests SET status=?,http_status=?,encryption=?,raw_path=?,raw_sha=? WHERE id=?')
      .run(status>=200&&status<300?'ok':'http_error',status,encryption,raw?.path??null,raw?.sha??null,id);
  }
  finish(run: any,data: any,version: string,semanticHash: string,project: (run: any,data: any)=>void,now=Date.now()): void {
    const artifact=this.artifact(data),previous=this.latest(run.task_key);
    atomic(this.db,()=>{
      const task=this.db.prepare('SELECT lease_owner FROM collection_tasks WHERE key=?').get(run.task_key) as any;
      if(task?.lease_owner&&task.lease_owner!==this.owner)throw new Error('stale_lease');
      this.db.prepare("UPDATE collection_runs SET status='ok',version=?,data_path=?,data_sha=?,semantic_hash=?,changed=? WHERE id=?")
        .run(version,artifact.path,artifact.sha,semanticHash,previous?Number(previous.semantic_hash!==semanticHash):null,run.id);
      project({...run,version,status:'ok',data_path:artifact.path,data_sha:artifact.sha},data);
      this.db.prepare('UPDATE collection_tasks SET last_success_at=?,last_success_id=?,failures=0,error=NULL WHERE key=?').run(now,run.id,run.task_key);
    });
  }
  fail(run: any,code: string,now=Date.now()): void {
    // Only controlled error codes enter runtime state; never persist credentials or arbitrary upstream text.
    this.db.prepare("UPDATE collection_runs SET status='failed',error=? WHERE id=?").run(code,run.id);
    const task=this.db.prepare('SELECT lease_owner FROM collection_tasks WHERE key=?').get(run.task_key) as any;
    if(task?.lease_owner&&task.lease_owner!==this.owner)return;
    this.db.prepare('UPDATE collection_tasks SET failures=failures+1 WHERE key=?').run(run.task_key);
    const failures=(this.db.prepare('SELECT failures FROM collection_tasks WHERE key=?').get(run.task_key) as any).failures;
    if(/login_required|rate_limited|payment_required|auth_required|invalid_auth|auth_file|ENOENT/.test(code))this.pause(run.provider,run.scope,code);
    if(/schema_error|decode_error|unsupported_encryption/.test(code))this.db.prepare('UPDATE collection_tasks SET disabled=1 WHERE provider=? AND scope=? AND operation=?').run(run.provider,run.scope,run.operation);
    // 除登录限流(暂停来源)与结构错误(按操作停用)外的错误连续 3 次即停用该任务,不再无限重试;成功清零,重连授权或 resume 恢复。
    if(failures>=3)this.db.prepare('UPDATE collection_tasks SET disabled=1 WHERE key=?').run(run.task_key);
    this.release({key:run.task_key},now+Math.min(86400000,300000*2**Math.min(6,failures)),code);
  }
  pause(provider: string,scope: string,error: string): void {
    this.db.prepare(`INSERT INTO collection_provider_state(provider,scope,paused,error) VALUES(?,?,1,?)
      ON CONFLICT(provider,scope) DO UPDATE SET paused=1,error=excluded.error`).run(provider,scope,error);
  }
  observation(run: any,kind: string,id: string | number,dimension: string,metrics: any,window: any=null): void {
    this.db.prepare('INSERT OR IGNORE INTO collection_observations VALUES(?,?,?,?,?,?,?)')
      .run(run.id,kind,String(id),dimension,run.version,window===null?null:JSON.stringify(window),JSON.stringify(metrics));
  }
}
