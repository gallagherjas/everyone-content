// 工作台提醒：登录失效、采集异常与博主新作品全部从采集运行态现算，不另存事实。
import type { DatabaseSync } from 'node:sqlite';
import { AUTH_ERROR } from './platform-login.ts';
import { profileOf } from '../collector/core/bloggers.ts';

export interface NoticeIssue { kind: 'paused' | 'disabled' | 'run_failed'; provider?: string; error?: string; count?: number }
export interface BloggerNotice { id: number; name: string; latest: string | null; items: { title: string; url: string; addedAt: string }[] }

export function noticeOverview(db: DatabaseSync, accountId: number) {
  // 只提醒已连接的平台：未连接的来源本来就不采集，不构成异常。
  const connected = (db.prepare('SELECT provider FROM collection_credentials WHERE account_id=?').all(accountId) as { provider: string }[])
    .map((r) => r.provider);
  const paused = connected.length
    ? db.prepare(`SELECT provider,error FROM collection_provider_state WHERE scope=? AND paused=1 AND error IS NOT NULL AND provider IN (${connected.map(() => '?').join(',')})`)
        .all(`account:${accountId}`, ...connected) as { provider: string; error: string }[]
    : [];
  const auth = paused.filter((s) => AUTH_ERROR.test(s.error)).map((s) => ({ provider: s.provider }));
  const issues: NoticeIssue[] = [
    ...paused.filter((s) => !AUTH_ERROR.test(s.error)).map((s) => ({ kind: 'paused' as const, provider: s.provider, error: s.error })),
    ...(db.prepare(`SELECT t.error,COUNT(*) n FROM collection_tasks t JOIN collection_task_accounts x ON x.task_key=t.key
        WHERE x.account_id=? AND t.disabled=1 GROUP BY t.error`).all(accountId) as { error: string | null; n: number }[])
      .map((r) => ({ kind: 'disabled' as const, error: r.error ?? '', count: r.n })),
  ];
  const run = db.prepare("SELECT status FROM task_runs WHERE account_id=? AND task='collect' ORDER BY id DESC LIMIT 1").get(accountId) as { status: string } | undefined;
  if (run?.status === 'failed') issues.push({ kind: 'run_failed' as const });
  // 近30天新增作品即提醒素材；latest 为水位值，前端按博主记已读，更早的更新到博主页回看。
  const bloggers: BloggerNotice[] = (db.prepare("SELECT id,name,note FROM account_sources WHERE account_id=? AND kind='blogger' ORDER BY id").all(accountId) as { id: number; name: string; note: string }[])
    .map((row) => {
      const secUid = profileOf(row).secUid;
      if (!secUid) return { id: row.id, name: row.name, latest: null, items: [] };
      const items = (db.prepare(`SELECT w.title,w.url,aw.added_at FROM account_works aw JOIN works w ON w.id=aw.work_id
        WHERE aw.account_id=? AND aw.reason='index:blogger' AND w.author_id=? AND aw.added_at>datetime('now','-30 day')
        ORDER BY aw.added_at DESC LIMIT 20`).all(accountId, secUid) as { title: string; url: string; added_at: string }[])
        .map((w) => ({ title: w.title, url: w.url, addedAt: w.added_at }));
      return { id: row.id, name: row.name, latest: items[0]?.addedAt ?? null, items };
    });
  return { auth, issues, bloggers };
}
