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

export interface Capture { id: number; observed_at: string; source: string; metric_at?: string | null }
export function snapshot(db: DatabaseSync, workId: number, metrics: DouyinWork["metrics"], capture?: Capture) {
  if (capture && db.prepare("SELECT 1 FROM snapshots WHERE work_id=? AND capture_id=?").get(workId, capture.id)) return;
  db.prepare("INSERT OR IGNORE INTO snapshots (work_id, ts, metrics,source,capture_id,metric_at) VALUES (?, ?, ?,?,?,?)")
    .run(workId, capture?.observed_at ?? sqlTime(new Date()), JSON.stringify(metrics), capture?.source ?? "index", capture?.id ?? null, capture?.metric_at ?? capture?.observed_at ?? null);
}

export function upsertAuthor(db: DatabaseSync, w: DouyinWork) {
  if (!w.authorId) return;
  db.prepare(
    `INSERT INTO authors (platform, author_id, name, last_seen_at) VALUES ('douyin', ?, ?, datetime('now'))
     ON CONFLICT(platform, author_id) DO UPDATE SET name = COALESCE(excluded.name, name), last_seen_at = datetime('now')`,
  ).run(w.authorId, w.authorName || null);
}

export function upsertWork(db: DatabaseSync, w: DouyinWork, reason: string, capture?: Capture, saveMetrics = true): number {
  const date = Date.parse(w.publishedAt), pub = Number.isFinite(date) ? sqlTime(new Date(date)) : null;
  const row = db.prepare(`INSERT INTO works(platform,author_id,url,title,published_at,reason) VALUES('douyin',?,?,?,?,?)
    ON CONFLICT(url) DO UPDATE SET author_id=COALESCE(excluded.author_id,works.author_id),
    title=CASE WHEN excluded.title<>'' THEN excluded.title ELSE works.title END,published_at=COALESCE(excluded.published_at,works.published_at)
    RETURNING id`).get(w.authorId || null, workUrl(w.id), w.title, pub, reason) as { id: number };
  const id = Number(row.id);
  if (saveMetrics && Object.values(w.metrics).some((v) => typeof v === "number" && Number.isFinite(v))) snapshot(db, id, w.metrics, capture);
  return id;
}
