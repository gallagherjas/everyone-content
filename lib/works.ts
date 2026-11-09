// 作品/作者写库的共享逻辑(collect 与 server 共用,单一事实来源)
import type { DatabaseSync } from "node:sqlite";
export interface DouyinWork {
  id: string;
  title: string;
  publishedAt: string;
  authorId: string;
  authorName: string;
  metrics: { views: number | null; likes: number | null; comments: number | null; shares: number | null; collects: number | null };
}

/** ISO → SQLite 时间格式(UTC,空格分隔),与 datetime('now') 可比 */
export const sqlTime = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);

export const workUrl = (id: string) => `https://www.douyin.com/video/${id}`;

export function upsertAuthor(db: DatabaseSync, w: DouyinWork) {
  if (!w.authorId) return;
  db.prepare(
    `INSERT INTO authors (platform, author_id, name, last_seen_at) VALUES ('douyin', ?, ?, datetime('now'))
     ON CONFLICT(platform, author_id) DO UPDATE SET name = COALESCE(excluded.name, name), last_seen_at = datetime('now')`,
  ).run(w.authorId, w.authorName || null);
}

export function upsertWork(db: DatabaseSync, w: DouyinWork, reason: string): number {
  const date = Date.parse(w.publishedAt), pub = Number.isFinite(date) ? sqlTime(new Date(date)) : null;
  const row = db.prepare(`INSERT INTO works(platform,author_id,url,title,published_at,reason) VALUES('douyin',?,?,?,?,?)
    ON CONFLICT(url) DO UPDATE SET author_id=COALESCE(excluded.author_id,works.author_id),
    title=CASE WHEN excluded.title<>'' THEN excluded.title ELSE works.title END,published_at=COALESCE(excluded.published_at,works.published_at)
    RETURNING id`).get(w.authorId || null, workUrl(w.id), w.title, pub, reason) as { id: number };
  return Number(row.id);
}
