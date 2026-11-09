import type { DatabaseSync } from 'node:sqlite';
import { listAccounts } from './accounts.ts';
import { COLLECTION_PROVIDERS, latestScheduleSlot } from './collection-schedule.ts';

export function runScheduledCollection(
  db: DatabaseSync,
  start: (accountId: number, args: string[]) => { run_id: number },
  now = Date.now(),
) {
  const due = listAccounts(db).filter(account => account.status === 'active').flatMap(account =>
    COLLECTION_PROVIDERS.flatMap(provider => {
      // 指数功能以“已登记授权文件”为开关；未登记的账号不排定时的指数采集。
      if (provider === 'index' && !db.prepare('SELECT 1 FROM collection_credentials WHERE account_id=?').get(account.id)) return [];
      const schedule = account.config.schedules[provider];
      const slot = latestScheduleSlot(schedule, now);
      if (!slot || db.prepare('SELECT 1 FROM collection_schedule_runs WHERE account_id=? AND provider=? AND scheduled_at=?').get(account.id, provider, slot)) return [];
      return [{ accountId: account.id, provider, slot, limit: schedule.request_limit }];
    }),
  ).sort((a, b) => a.slot.localeCompare(b.slot) || a.accountId - b.accountId);
  if (!due.length) return null;
  const job = due[0];
  // The existing launcher refuses while manual collection is running. A busy slot remains pending.
  const run = start(job.accountId, ['--scheduled', `--only=${job.provider}`, `--limit=${job.limit}`]);
  db.prepare('INSERT INTO collection_schedule_runs(account_id,provider,scheduled_at,run_id) VALUES(?,?,?,?)')
    .run(job.accountId, job.provider, job.slot, run.run_id);
  return { ...job, run_id: run.run_id };
}
