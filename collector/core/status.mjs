import { indexSelection,selectionView } from './projection.mjs';
export function collectionRuns(db,accountId) {
  return db.prepare(`SELECT r.id,r.provider,r.operation,r.target,r.status,r.observed_at,r.version,r.error FROM collection_runs r
    JOIN collection_run_accounts x ON x.run_id=r.id WHERE x.account_id=? ORDER BY r.id DESC LIMIT 50`).all(accountId);
}
export function collectionStatus(db,a,store) {
  const tasks=db.prepare(`SELECT t.key,t.provider,t.operation,t.target,t.next_run_at,t.last_success_at,t.error,t.disabled,
    t.lease_until,COALESCE(p.paused,0) paused,p.error source_error FROM collection_tasks t JOIN collection_task_accounts x ON x.task_key=t.key
    LEFT JOIN collection_provider_state p ON p.provider=t.provider AND p.scope=t.scope WHERE x.account_id=? ORDER BY t.priority DESC,t.next_run_at LIMIT 100`).all(a.id);
  const runs=collectionRuns(db,a.id);
  const budgets=db.prepare(`SELECT l.provider,l.daily_limit,l.per_tick,(SELECT COUNT(*) FROM collection_requests q WHERE q.provider=l.provider AND q.day=date('now')) used
    FROM collection_limits l ORDER BY l.provider`).all();
  let discovery=null;
  if(db.prepare('SELECT 1 FROM collection_credentials WHERE account_id=?').get(a.id)&&store)discovery=selectionView(indexSelection(store,a));
  const queue=db.prepare('SELECT COUNT(*) total,SUM(t.next_run_at<=? AND t.disabled=0) due FROM collection_tasks t JOIN collection_task_accounts x ON x.task_key=t.key WHERE x.account_id=?').get(Date.now(),a.id);
  return {tasks,runs,budgets,discovery,queue,indexCredential:!!db.prepare('SELECT 1 FROM collection_credentials WHERE account_id=?').get(a.id)};
}
