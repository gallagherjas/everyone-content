import type { DatabaseSync } from 'node:sqlite';
import { indexSelection,selectionView } from './projection.ts';
import { freshSnapshots, taskKey, type CollectionStore } from './store.ts';
import { collectionBlockers } from './availability.ts';
import { collectionDay, collectionDayStart } from '../../lib/time.ts';
import { indexEffectiveVersion, usesTopicDates, type TopicDates } from '../sources/douyin-index/protocol.ts';
import { credentialBudgetKey, dailyBudget } from './budget.ts';
import { credentialIdentity } from './credential-identity.ts';
import { platformAccountLabel } from '../sources/platform/identity.ts';
import { COLLECTION_PROVIDERS } from '../../lib/collection-schedule.ts';

export type CollectionOutcome = 'done' | 'partial' | 'failed' | 'done_with_deferred' | 'deferred' | 'cached' | 'empty';
export function collectionOutcome({ completed, cached, failed, deferred }: Record<'completed' | 'cached' | 'failed' | 'deferred', number>): CollectionOutcome {
  if (failed) return completed || cached ? 'partial' : 'failed';
  if (deferred) return completed || cached ? 'done_with_deferred' : 'deferred';
  if (completed) return 'done';
  return cached ? 'cached' : 'empty';
}
export function collectionRuns(db: DatabaseSync,accountId: number): any[] {
  return db.prepare(`SELECT r.id,r.provider,r.operation,r.target,r.status,r.observed_at,r.version,r.error FROM collection_runs r
    JOIN collection_run_accounts x ON x.run_id=r.id WHERE x.account_id=? ORDER BY r.id DESC LIMIT 50`).all(accountId) as any[];
}
export interface CollectionTaskStatus {
  key: string;
  provider: string;
  operation: string;
  target: string;
  next_run_at: number;
  last_success_at: number | null;
  error: string | null;
  disabled: number;
  lease_until: number;
  paused: number;
  source_error: string | null;
  status: 'due' | 'collected' | 'waiting' | 'running' | 'paused' | 'disabled' | 'archived';
}
export function collectionStatus(db: DatabaseSync,a: any,store: CollectionStore | null,now=Date.now()) {
  const today=collectionDay(now),start=collectionDayStart(now);
  const rows=db.prepare(`SELECT t.key,t.provider,t.scope,t.operation,t.target,t.next_run_at,t.error,t.disabled,
    t.lease_until,COALESCE(p.paused,0) paused,p.error source_error,
    (SELECT COALESCE(CASE WHEN r.id=t.last_success_id THEN t.last_success_at END,r.at_ms)
      FROM collection_runs r JOIN collection_run_accounts a ON a.run_id=r.id
      WHERE r.task_key=t.key AND a.account_id=x.account_id AND r.status='ok' ORDER BY r.at_ms DESC LIMIT 1) last_success_at,
    CASE WHEN t.provider='index' THEN (SELECT r.version FROM collection_runs r
      JOIN collection_run_accounts a ON a.run_id=r.id
      WHERE r.task_key=t.key AND a.account_id=x.account_id AND r.status IN ('ok','cached')
        AND (r.at_ms>=? OR (r.id=t.last_success_id AND t.last_success_at>=?))
      ORDER BY r.at_ms DESC,r.id DESC LIMIT 1) END today_version,
    CASE WHEN ? THEN 'archived' WHEN COALESCE(p.paused,0)<>0 THEN 'paused' WHEN t.lease_until>? THEN 'running'
      WHEN t.disabled<>0 THEN 'disabled' WHEN t.next_run_at<=? THEN 'due' ELSE 'waiting' END status
    FROM collection_tasks t JOIN collection_task_accounts x ON x.task_key=t.key
    LEFT JOIN collection_provider_state p ON p.provider=t.provider AND p.scope=t.scope
    WHERE x.account_id=? ORDER BY t.priority DESC,t.next_run_at,t.key`)
    .all(start,start,Number(a.status==='archived'),now,now,a.id) as unknown as
      (CollectionTaskStatus & { scope: string; today_version: string | null })[];
  const snapshots=new Set(freshSnapshots(db,a.id,now).map(task=>task.key));
  const dates=new Map<string,TopicDates | null>();
  const tasks=rows.map(({scope,today_version,...task})=>{
    if(task.error || (task.status!=='waiting'&&task.status!=='due'))return task;
    if(snapshots.has(task.key))return {...task,status:'collected' as const};
    if(!today_version || task.provider!=='index')return task;
    if(!usesTopicDates(task.operation))
      return indexEffectiveVersion(task.operation,today)===today_version ? {...task,status:'collected' as const} : task;
    if(!store)return task;
    const key=taskKey('index',scope,{type:'topic_dates'});
    if(!dates.has(key)){
      const run=store.latest(key);
      dates.set(key,run?store.data(run):null);
    }
    return indexEffectiveVersion(task.operation,today,dates.get(key))===today_version ? {...task,status:'collected' as const} : task;
  });
  const runs=collectionRuns(db,a.id);
  const bindings=new Map(db.prepare('SELECT provider,auth_path FROM collection_credentials WHERE account_id=?').all(a.id)
    .map(row=>[String(row.provider),String(row.auth_path)]));
  const budgets=[...COLLECTION_PROVIDERS].sort().map(provider=>{
    const file=bindings.get(provider), key=file ? credentialBudgetKey(db,provider,file) : null;
    const {daily_limit,per_tick,used}=dailyBudget(db,provider,key,today);
    return {provider,daily_limit,per_tick,used,account_name:file ? platformAccountLabel(credentialIdentity(db,provider,file)) : null};
  });
  let discovery=null;
  const credentials=Object.fromEntries([...bindings.keys()].map(provider=>[provider,true]));
  if(store&&(credentials.index||db.prepare(`SELECT 1 FROM collection_run_accounts x
    JOIN collection_runs r ON r.id=x.run_id
    WHERE x.account_id=? AND r.provider='index' AND r.status='ok' LIMIT 1`).get(a.id)))
    discovery=selectionView(indexSelection(store,a));
  const queue={total:tasks.length,due:tasks.filter(t=>t.status==='due').length};
  return {tasks,runs,budgets,discovery,queue,credentials,blockers:collectionBlockers(db,a.id)};
}
