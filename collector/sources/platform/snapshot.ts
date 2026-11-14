import { hash, stamp, type CollectionStore } from '../../core/store.ts';
import { loadSession, type PlatformAuth } from './session.ts';

// 创作后台账号级快照:每平台每轮一个总览请求,解析为可空的指标集。
// 抖音与小红书端点已用真实会话探测确认(2026-11-14),各收敛为一个;B站仍是推测候选,连上后需同样探测;schema_error 会自动禁用任务。
interface PlatformSnapshot {
  origin: string;
  referer: string;
  endpoints: string[];
  uid: string[];
  fans: string[];
  likes: string[];
  works: string[];
  views: string[];
}
export const SNAPSHOT_PLATFORMS: Record<string, PlatformSnapshot> = {
  douyin: {
    origin: 'https://creator.douyin.com',
    referer: 'https://creator.douyin.com/',
    endpoints: ['/aweme/v1/creator/user/info/'],
    uid: [],
    fans: ['douyin_user_verify_info.follower_count', 'user_profile.follower_count'],
    likes: ['douyin_user_verify_info.total_favorited', 'user_profile.total_favorited'],
    works: [],
    views: [],
  },
  xhs: {
    origin: 'https://creator.xiaohongshu.com',
    referer: 'https://creator.xiaohongshu.com/',
    endpoints: ['/api/galaxy/creator/home/personal_info'],
    uid: ['data.red_num'],
    fans: ['data.fans_count', 'data.grow_info.fans_count'],
    likes: ['data.faved_count'],
    works: [],
    views: [],
  },
  bili: {
    origin: 'https://member.bilibili.com',
    referer: 'https://member.bilibili.com/platform/home',
    endpoints: ['/x2/creative/web/data/overview', '/x2/creative/web/center/overview'],
    uid: ['data.uid', 'data.mid', 'data.user.mid'],
    fans: ['data.fans', 'data.follower', 'data.stat.fans'],
    likes: ['data.like', 'data.likes', 'data.stat.like'],
    works: ['data.archive_count', 'data.works', 'data.stat.archive'],
    views: ['data.play', 'data.views', 'data.stat.play'],
  },
};

export interface Snapshot { uid: string; metrics: { fans: number | null; likes: number | null; works: number | null; views: number | null } }

// “1.2万”/"3,406"/"890" 这类展示值统一为数字;解析不了返回 null,不强算。
function parseCount(value: string): number | null {
  const m = value.replace(/[,\s]/g, '').match(/^([\d.]+)([万亿kKwW]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = { 万: 1e4, w: 1e4, W: 1e4, k: 1e3, K: 1e3 }[m[2]] ?? 1;
  return Math.round(n * unit);
}
function pick(body: any, paths: string[]): number | null {
  for (const path of paths) {
    let cur: any = body;
    for (const key of path.split('.')) { cur = cur?.[key]; if (cur === null || cur === undefined) break; }
    if (typeof cur === 'number' && Number.isFinite(cur)) return cur;
    if (typeof cur === 'string') { const n = parseCount(cur); if (n !== null) return n; }
  }
  return null;
}

export async function fetchSnapshot(provider: string, auth: PlatformAuth, client: typeof fetch): Promise<Snapshot> {
  const p = SNAPSHOT_PLATFORMS[provider];
  if (!p) throw new Error('schema_error');
  for (const path of p.endpoints) {
    let text: string;
    try {
      const res = await client(p.origin + path, {
        headers: { cookie: auth.cookie, referer: p.referer, ...(auth.userAgent ? { 'user-agent': auth.userAgent } : {}) },
        signal: AbortSignal.timeout(20000), redirect: 'error',
      });
      if ([401, 403].includes(res.status)) throw new Error('login_required');
      if (res.status === 429) throw new Error('rate_limited');
      if (!res.ok) continue;
      text = await res.text();
    } catch (error) {
      if (/^(login_required|rate_limited|daily_budget_exhausted|tick_budget_exhausted|source_paused)$|^interval_pending/.test((error as Error)?.message ?? '')) throw error;
      continue;
    }
    if (/^\s*</.test(text)) throw new Error('login_required');
    let body: any;
    try { body = JSON.parse(text); } catch { continue; }
    const metrics = {
      fans: pick(body, p.fans), likes: pick(body, p.likes), works: pick(body, p.works), views: pick(body, p.views),
    };
    if (Object.values(metrics).every(v => v === null)) continue;
    return { uid: String(pick(body, p.uid) ?? 'self'), metrics };
  }
  throw new Error('schema_error');
}

// runner 的 execute 分发入口:凭证读取 → 当日去重 → 单请求快照。
export async function snapshotExecute(store: CollectionStore, run: any, client: typeof fetch, clock: () => number): Promise<any> {
  const credential = store.db.prepare(
    'SELECT c.auth_path FROM collection_credentials c JOIN collection_task_accounts a ON a.account_id=c.account_id WHERE a.task_key=? AND c.provider=? LIMIT 1',
  ).get(run.task_key, run.provider) as any;
  const auth = loadSession(credential?.auth_path);
  const version = stamp(clock()).slice(0, 10);
  const previous = store.latest(run.task_key);
  if (previous?.version === version) return { cached: previous, version };
  const snapshot = await fetchSnapshot(run.provider, auth, client);
  return { data: snapshot, version, fingerprint: hash(JSON.stringify(snapshot.metrics)) };
}
