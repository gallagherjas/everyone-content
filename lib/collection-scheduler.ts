import type { DatabaseSync } from 'node:sqlite';
import { listAccounts } from './accounts.ts';
import { SCHEDULE_SCOPES, latestScheduleSlot, providerForScope } from './collection-schedule.ts';
import { sourceBlocker } from '../collector/core/availability.ts';
import { hasPendingBloggerWork } from '../collector/core/bloggers.ts';
import { collectionDay } from './time.ts';

export interface CollectionLaunch { only?: string; scheduled?: boolean; limit?: number; retryTask?: string }

export function pendingBloggerAccount(db: DatabaseSync, now = Date.now()) {
  const budget = db.prepare(`SELECT l.daily_limit,(SELECT COUNT(*) FROM collection_requests
    WHERE provider='index' AND day=?) used FROM collection_limits l WHERE l.provider='index'`).get(collectionDay(now));
  if (!budget || Number(budget.used) >= Number(budget.daily_limit)) return undefined;
  return listAccounts(db).find(a => a.status === 'active' && hasPendingBloggerWork(db, a.id, now))?.id;
}

export function runScheduledCollection(
  db: DatabaseSync,
  start: (accountId: number, options: CollectionLaunch) => { run_id: number },
  now = Date.now(),
) {
  const due = listAccounts(db).filter(account => account.status === 'active').flatMap(account =>
    SCHEDULE_SCOPES.flatMap(scope => {
      const provider = providerForScope(scope);
      const schedule = account.config.schedules[scope];
      const slot = latestScheduleSlot(schedule, now);
      if (!slot || db.prepare('SELECT 1 FROM collection_schedule_runs WHERE account_id=? AND provider=? AND scheduled_at=?').get(account.id, scope, slot)
        || sourceBlocker(db, account.id, provider)) return [];
      return [{ accountId: account.id, scope, provider, slot, limit: schedule.request_limit }];
    }),
  ).sort((a, b) => a.slot.localeCompare(b.slot) || a.accountId - b.accountId);
  if (!due.length) return null;
  const job = due[0];
  // The existing launcher refuses while manual collection is running. A busy slot remains pending.
  const run = start(job.accountId, { scheduled: true, only: job.scope, limit: job.limit });
  db.prepare('INSERT INTO collection_schedule_runs(account_id,provider,scheduled_at,run_id) VALUES(?,?,?,?)')
    .run(job.accountId, job.scope, job.slot, run.run_id);
  return { ...job, run_id: run.run_id };
}
