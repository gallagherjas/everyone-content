import { hash, type CollectionStore } from '../../core/store.ts';
import { collectionDay } from '../../../lib/time.ts';
import { loadSession, type PlatformAuth } from './session.ts';

// 创作后台账号级快照：每平台一次总览请求，缺项保留 null。
const BILI_ORIGIN = 'https://member.bilibili.com';
export const BILI_CREATOR_HOME = BILI_ORIGIN + '/platform/home';
const BILI_STATS_PATH = '/x/web/data/index/stat?tmid=-1';
export const BILI_SESSION_URL = BILI_ORIGIN + BILI_STATS_PATH;
const DOUYIN_PROFILE_PATH = '/aweme/v1/creator/user/info/';

interface PlatformSnapshot {
  origin: string;
  referer: string;
  path: string;
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
    path: DOUYIN_PROFILE_PATH,
    uid: [],
    fans: ['douyin_user_verify_info.follower_count', 'user_profile.follower_count'],
    likes: ['douyin_user_verify_info.total_favorited', 'user_profile.total_favorited'],
    works: [],
    views: [],
  },
  xhs: {
    origin: 'https://creator.xiaohongshu.com',
    referer: 'https://creator.xiaohongshu.com/',
    path: '/api/galaxy/creator/home/personal_info',
    uid: ['data.red_num'],
    fans: ['data.fans_count', 'data.grow_info.fans_count'],
    likes: ['data.faved_count'],
    works: [],
    views: [],
  },
  bili: {
    origin: BILI_ORIGIN,
    referer: BILI_CREATOR_HOME,
    path: BILI_STATS_PATH,
    uid: [],
    fans: ['data.total_fans'],
    likes: ['data.total_like'],
    works: [],
    views: ['data.total_click'],
  },
};
export const DOUYIN_PROFILE_URL = SNAPSHOT_PLATFORMS.douyin.origin + DOUYIN_PROFILE_PATH;

export function douyinAccountName(body: any): string | undefined {
  if (body?.status_code !== 0) return undefined;
  const value = (...names: unknown[]) => names.find(name => typeof name === 'string' && name.trim()) as string | undefined;
  const nickname = value(body.user_profile?.nick_name, body.douyin_user_verify_info?.nick_name)?.trim();
  const handle = value(body.user_profile?.unique_id, body.douyin_user_verify_info?.douyin_unique_id)?.trim();
  return nickname && handle ? `${nickname}（${handle}）` : nickname || handle;
}

export interface Snapshot { uid: string; metrics: { fans: number | null; likes: number | null; works: number | null; views: number | null } }

// “1.2万”/"3,406"/"890" 这类展示值统一为数字;解析不了返回 null,不强算。
function parseCount(value: string): number | null {
  const m = value.replace(/[,\s]/g, '').match(/^([\d.]+)([万亿kKwW]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = { 万: 1e4, 亿: 1e8, w: 1e4, W: 1e4, k: 1e3, K: 1e3 }[m[2]] ?? 1;
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
  let res: Response;
  try {
    res = await client(p.origin + p.path, {
      headers: { cookie: auth.cookie, referer: p.referer, ...(auth.userAgent ? { 'user-agent': auth.userAgent } : {}) },
      signal: AbortSignal.timeout(20000), redirect: 'manual',
    });
  } catch (error) {
    if (/^(daily_budget_exhausted|tick_budget_exhausted|source_paused)$|^interval_pending /.test((error as Error)?.message ?? '')) throw error;
    throw new Error('transport_error', { cause: error });
  }
  if (res.status === 401) throw new Error('login_required');
  if (res.status === 429) throw new Error('rate_limited');
  if (!res.ok) throw new Error(`http_error_${res.status}`);
  const text = await res.text().catch(error => { throw new Error('transport_error', { cause: error }); });
  if (/^\s*</.test(text)) throw new Error('unexpected_html');
  let body: any;
  try { body = JSON.parse(text); } catch { throw new Error('invalid_response'); }
  const code = Number(body?.status_code ?? body?.code ?? 0);
  const message = body?.status_msg ?? body?.message ?? body?.msg;
  if (code === 401 || (provider === 'douyin' && code === 8) || (provider === 'bili' && code === -101) ||
      (typeof message === 'string' && /^(用户未登录|账号未登录|请先登录)[。！! ]*$/.test(message.trim()))) {
    throw new Error('login_required');
  }
  if (code === 429) throw new Error('rate_limited');
  if (![0, 200].includes(code) || body?.success === false) throw new Error('business_error');
  const metrics = {
    fans: pick(body, p.fans), likes: pick(body, p.likes), works: pick(body, p.works), views: pick(body, p.views),
  };
  if (Object.values(metrics).every(v => v === null)) throw new Error('schema_error');
  return { uid: String(pick(body, p.uid) ?? 'self'), metrics };
}

// runner 的 execute 分发入口:凭证读取 → 当日去重 → 单请求快照。
export async function snapshotExecute(store: CollectionStore, run: any, client: typeof fetch, clock: () => number): Promise<any> {
  const credential = store.credentialForRun(run.id);
  const auth = loadSession(credential?.auth_path);
  const previous = store.latest(run.task_key);
  if (credential?.last_success_at != null && previous?.version === collectionDay(run.at_ms))
    return { cached: previous, version: previous.version };
  const snapshot = await fetchSnapshot(run.provider, auth, client);
  return { data: snapshot, version: collectionDay(clock()), fingerprint: hash(JSON.stringify(snapshot.metrics)) };
}
