// 博主链路的读取侧落库与视图：达友域(author_*)捕获 → 作品/作者/观测，以及 API 用的概览与详情。
import type { DatabaseSync } from 'node:sqlite';
import { count } from './discovery.ts';
import { identity } from './projection.ts';
import { taskKey, taskRetryable, type CollectionStore } from './store.ts';
import { sourceBlocker } from './availability.ts';
import { upsertAuthor,upsertWork,workUrl } from '../../lib/works.ts';
import { linkWork } from '../../lib/accounts.ts';
import { parseTime } from '../../lib/time.ts';

export interface BloggerProfile { secUid: string | null; fans: number | null; likes: number | null; items: number | null; tag1: string | null; tag2: string | null; avatar: string | null }
export type BloggerSearchState = 'queued' | 'running' | 'blocked' | 'failed' | 'deferred' | 'not_found';
export interface BloggerSearchStatus { searchState: BloggerSearchState; error: string | null; nextRetryAt: number | null }
export const profileOf = (row: any): Partial<BloggerProfile> => { try { return JSON.parse(row.note||'{}'); } catch { return {}; } };

// author_works 各榜单的每行都是完整对象(标题/赞评转关注/日期/链接)，按 item_id 去重合并并记录上榜榜单。
function worksFromCapture(data: any) {
  const merged = new Map<string, any>();
  for (const [list, rows] of Object.entries(data ?? {})) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows as any[]) {
      if (!/^\d+$/.test(String(row?.item_id ?? ''))) continue;
      const id = String(row.item_id), hit = merged.get(id) ?? { id, lists: [] as string[] };
      hit.lists.push(list);
      const day = String(row.create_time ?? '');
      merged.set(id, { ...hit,
        title: String(row.video_text ?? '').trim(),
        likes: count(row.like_cnt), comments: count(row.coment_cnt ?? row.comment_cnt),
        shares: count(row.share_cnt), follows: count(row.follow_cnt),
        publishedAt: /^\d{8}$/.test(day) ? `${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}T00:00:00+08:00` : hit.publishedAt ?? null,
        url: String(row.video_url ?? '') || workUrl(id) });
    }
  }
  return [...merged.values()];
}
const latestRun = (store: CollectionStore, accountId: number, type: string, id: string) => {
  const run = store.db.prepare(`SELECT r.* FROM collection_runs r
    JOIN collection_run_accounts x ON x.run_id=r.id
    WHERE x.account_id=? AND r.provider='index' AND r.operation=? AND r.target=? AND r.status='ok'
    ORDER BY r.id DESC LIMIT 1`).get(accountId, type, id);
  return run ? { run, data: store.data(run) } : null;
};

/** 把各博主最新 author_* 捕获落库：作品+作者身份+观测(指数事实与日增序列)。 */
export function projectBloggers(store: CollectionStore, a: any): void {
  const db = store.db;
  const bloggers = db.prepare("SELECT * FROM account_sources WHERE account_id=? AND kind='blogger'").all(a.id) as any[];
  for (const s of bloggers) {
    const profile = profileOf(s);
    const works = latestRun(store, a.id, 'author_works', s.source_key);
    if (works) {
      for (const w of worksFromCapture(works.data)) {
        const work = { id: w.id, title: w.title, publishedAt: w.publishedAt, authorId: profile.secUid ?? '', authorName: s.name,
          metrics: { views: null, likes: w.likes, comments: w.comments, shares: w.shares, collects: null } };
        upsertAuthor(db, work);
        identity(store, works.run, 'daren', s.source_key, { sec_uid: profile.secUid, nickname: s.name });
        const wid = upsertWork(db, work, 'index:blogger', 'fill');
        linkWork(db, a.id, wid, 'index:blogger');
        store.observation(works.run, 'work', wid, 'author_works', { likes: w.likes, comments: w.comments, shares: w.shares, follows: w.follows });
      }
    }
    const core = latestRun(store, a.id, 'author_core', s.source_key);
    if (core) {
      const series = (rows: any) => (rows ?? []).map((r: any) => ({ date: r.date, count: count(r.count) })).filter((r: any) => r.date);
      store.observation(core.run, 'author', s.source_key, 'author_core', {
        fans: series(core.data.fanslistday), likes: series(core.data.likelistday),
        summary: { newFansDay: count(core.data.fans_info?.new_fans_count_by_day), newFansWeek: count(core.data.fans_info?.new_fans_count_by_week), newLikesDay: count(core.data.like_info?.new_like_count_by_day) },
      });
    }
    const info = latestRun(store, a.id, 'author_info', s.source_key);
    if (info) {
      if (profile.secUid) db.prepare("UPDATE authors SET name=?,follower_count=? WHERE platform='douyin' AND author_id=?")
        .run(String(info.data.user_name ?? s.name), count(info.data.fans_count), profile.secUid);
      store.observation(info.run, 'author', s.source_key, 'author_info', {
        fans: count(info.data.fans_count), likes: count(info.data.like_count), items: count(info.data.item_count),
        tag1: info.data.first_tag_name ?? null, tag2: info.data.second_tag_name ?? null, intro: String(info.data.user_introduction ?? ''),
        gender: info.data.user_gender ?? null, location: info.data.user_location ?? null,
        first1wFansAt: info.data.fans_milestone?.first_1w_fans_date ?? null, createdAt: count(info.data.fans_milestone?.create_time),
      });
    }
  }
}

function bloggerJobReader(db: DatabaseSync, accountId: number) {
  const credential = db.prepare("SELECT scope FROM collection_credentials WHERE account_id=? AND provider='index'").get(accountId);
  const job = db.prepare(`SELECT t.error,t.disabled,t.lease_until,t.next_run_at,${taskRetryable} retryable,
    EXISTS(SELECT 1 FROM collection_runs r WHERE r.task_key=t.key AND r.status='ok') succeeded
    FROM collection_tasks t WHERE t.key=?`);
  return (row: {kind: string; source_key: string}) => {
    if (!credential) return undefined;
    const spec = row.kind === 'blogger_search'
      ? { type: 'author_search', keyword: row.source_key }
      : { type: 'author_works', id: row.source_key };
    return job.get(taskKey('index', String(credential.scope), spec)) as
      { error: string | null; disabled: number; lease_until: number; next_run_at: number; retryable: number; succeeded: number } | undefined;
  };
}

export function hasPendingBloggerWork(db: DatabaseSync, accountId: number, now: number) {
  const rows = db.prepare("SELECT kind,source_key FROM account_sources WHERE account_id=? AND status='ready' AND kind IN ('blogger_search','blogger')")
    .all(accountId) as { kind: string; source_key: string }[];
  if (!rows.length || sourceBlocker(db, accountId, 'index')) return false;
  const jobFor = bloggerJobReader(db, accountId);
  return rows.some(row => {
    const job = jobFor(row);
    return !job || (!job.disabled && job.lease_until <= now && job.next_run_at <= now &&
      (row.kind === 'blogger_search' || !job.succeeded));
  });
}

/** API 列表视图：登记行 + 概要统计(作品数来自已落库作品，最后采集时间来自最新 works 捕获)。 */
export function bloggerOverview(db: DatabaseSync, store: CollectionStore, accountId: number, now = Date.now()): any[] {
  const rows = db.prepare("SELECT * FROM account_sources WHERE account_id=? AND kind IN ('blogger','blogger_search') ORDER BY id").all(accountId) as any[];
  const jobFor = bloggerJobReader(db, accountId);
  const blocked = rows.some(row => row.kind === 'blogger_search') ? sourceBlocker(db, accountId, 'index') : null;
  return rows
    .map(row => {
      if (row.kind === 'blogger_search') {
        const job = jobFor(row);
        const searchState: BloggerSearchState = row.status === 'paused' ? 'not_found' : blocked ? 'blocked'
          : job && job.lease_until > now ? 'running' : job?.retryable ? 'failed'
          : job && job.next_run_at > now ? 'deferred' : 'queued';
        return { id: row.id, kind: row.kind, name: row.name, status: row.status, note: row.note,
          searchState, resolving: searchState === 'running', error: blocked ?? job?.error ?? null,
          nextRetryAt: (searchState === 'failed' || searchState === 'deferred') &&
            job && !job.disabled && job.next_run_at > now ? job.next_run_at : null };
      }
      const profile = profileOf(row);
      const works = latestRun(store, accountId, 'author_works', row.source_key);
      const worksCount = profile.secUid
        ? (db.prepare(`SELECT COUNT(*) n FROM works w WHERE w.platform='douyin' AND w.author_id=?
            AND EXISTS(SELECT 1 FROM account_works aw WHERE aw.work_id=w.id AND aw.account_id=?)`).get(profile.secUid, accountId) as any).n
        : works ? worksFromCapture(works.data).length : 0;
      return { id: row.id, kind: row.kind, userId: row.source_key, name: row.name, status: row.status, profile,
        options: (() => { try { return JSON.parse(row.options || '{}'); } catch { return {}; } })(),
        worksCount, lastCollectAt: works?.run.observed_at ?? null };
    });
}

/** API 详情视图：概览合并最新 info、作品列表与 core 日增序列。 */
export function bloggerDetail(store: CollectionStore, accountId: number, row: any): any | null {
  const db = store.db;
  const profile = { ...profileOf(row) };
  const info = latestRun(store, accountId, 'author_info', row.source_key);
  if (info) Object.assign(profile, { fans: count(info.data.fans_count), likes: count(info.data.like_count), items: count(info.data.item_count),
    tag1: info.data.first_tag_name ?? null, tag2: info.data.second_tag_name ?? null, intro: String(info.data.user_introduction ?? ''), lastInfoAt: info.run.observed_at });
  const works = latestRun(store, accountId, 'author_works', row.source_key);
  const core = latestRun(store, accountId, 'author_core', row.source_key);
  // 跨域共享：同一作品若被关键词采集过，合并精确发布时间与官方标记(低粉爆款等)。
  const shared = profile.secUid
    ? (db.prepare(`SELECT w.id wid,w.url,w.published_at,
        (SELECT metrics FROM collection_observations o WHERE o.kind='work' AND o.object_id=w.id AND o.dimension='videos' ORDER BY o.run_id DESC LIMIT 1) metrics
        FROM works w WHERE w.platform='douyin' AND w.author_id=?`).all(profile.secUid) as any[])
      .reduce((acc: Map<string, { publishedAt?: string; badges?: string[] }>, r) => {
        let badges: string[] | undefined, publishedAt: string | undefined;
        try { badges = JSON.parse(r.metrics ?? '{}').badges; } catch { /* 观测缺失时无标记 */ }
        if (r.published_at && !String(r.published_at).endsWith('16:00:00')) publishedAt = `${String(r.published_at).replace(' ', 'T')}Z`;
        acc.set(r.url.split('/').pop()!, { publishedAt, badges });
        return acc;
      }, new Map())
    : new Map<string, { publishedAt?: string; badges?: string[] }>();
  const recentOrder = new Map<string, number>(works?.data.create_time_list?.map((w: any, i: number) => [String(w?.item_id ?? ''), i]));
  return { id: row.id, userId: row.source_key, name: row.name, status: row.status, profile,
    options: (() => { try { return JSON.parse(row.options || '{}'); } catch { return {}; } })(),
    works: works ? worksFromCapture(works.data)
      .map(w => ({ ...w, publishedAt: shared.get(w.id)?.publishedAt ?? w.publishedAt, badges: shared.get(w.id)?.badges ?? [] }))
      .sort((a, b) => (parseTime(b.publishedAt)?.getTime() ?? -Infinity) - (parseTime(a.publishedAt)?.getTime() ?? -Infinity)
        || (recentOrder.get(a.id) ?? Infinity) - (recentOrder.get(b.id) ?? Infinity)) : [],
    trend: core ? { fans: (core.data.fanslistday ?? []).map((r: any) => ({ date: r.date, count: count(r.count) })),
      likes: (core.data.likelistday ?? []).map((r: any) => ({ date: r.date, count: count(r.count) })),
      summary: { newFansDay: count(core.data.fans_info?.new_fans_count_by_day), newFansWeek: count(core.data.fans_info?.new_fans_count_by_week) } } : null,
    lastCollectAt: works?.run.observed_at ?? null };
}
