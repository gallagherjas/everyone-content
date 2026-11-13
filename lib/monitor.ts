import type { DatabaseSync } from 'node:sqlite';
import { formatTime } from './time.ts';
import { SNAPSHOT_PLATFORMS } from '../collector/sources/platform/snapshot.ts';

export interface SnapshotPoint { at: string; atMs: number; fans: number | null; likes: number | null; works: number | null; views: number | null }

const PROVIDERS = Object.keys(SNAPSHOT_PLATFORMS);
const DAY = 86400000;

// 数据监控载荷:各创作后台的最新快照、今日/近7天粉丝净增与近30天序列。
// 观测按北京自然日取当日最新一条,升序返回供图表;净增从第二个快照起才有值。
export function monitorOverview(db: DatabaseSync, accountId: number) {
  const now = Date.now(), today = formatTime(now).slice(0, 10);
  const platforms: Record<string, any> = {};
  for (const provider of PROVIDERS) {
    const configured = !!db.prepare('SELECT 1 FROM collection_credentials WHERE account_id=? AND provider=?').get(accountId, provider);
    const state = db.prepare('SELECT paused,error FROM collection_provider_state WHERE provider=? AND scope=?').get(provider, `account:${accountId}`) as any;
    const rows = db.prepare(`SELECT r.observed_at,r.at_ms,o.metrics FROM collection_observations o
      JOIN collection_runs r ON r.id=o.run_id JOIN collection_run_accounts x ON x.run_id=r.id
      WHERE x.account_id=? AND r.provider=? AND o.kind='account' AND r.status='ok'
      ORDER BY r.at_ms DESC LIMIT 300`).all(accountId, provider) as any[];
    const byDay = new Map<string, SnapshotPoint>();
    for (const row of rows) {
      const atMs = Number(row.at_ms), day = formatTime(atMs).slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { at: day, atMs, ...JSON.parse(row.metrics) });
    }
    const series = [...byDay.values()].sort((a, b) => a.atMs - b.atMs).slice(-31);
    const latest = series.at(-1) ?? null;
    const weekBase = [...series].reverse().find(p => p.atMs <= now - 7 * DAY) ?? (series.length > 1 ? series[0] : undefined);
    const diffFans = (base: SnapshotPoint | undefined): number | null => {
      const cur = latest?.fans, prev = base?.fans;
      return cur == null || prev == null ? null : cur - prev;
    };
    platforms[provider] = {
      configured,
      paused: !!state?.paused, error: state?.error ?? null,
      latest: latest ? { at: latest.at, fans: latest.fans, likes: latest.likes, works: latest.works, views: latest.views } : null,
      deltaToday: diffFans(series.filter(p => p.at < today).at(-1)),
      delta7d: diffFans(weekBase),
      // 31 个点:表格窗口(昨日/近7天/近30天)的增量在前端按差分计算
      series: series.map(({ at, fans, likes, views }) => ({ at, fans, likes, views })),
    };
  }
  const withData = Object.values(platforms).filter((p: any) => p.latest?.fans != null) as any[];
  const sumDelta = (key: 'deltaToday' | 'delta7d'): number | null => {
    const values = withData.map(p => p[key]).filter(v => v != null) as number[];
    return values.length ? values.reduce((n, v) => n + v, 0) : null;
  };
  return {
    platforms,
    total: {
      fans: withData.reduce((n, p) => n + p.latest.fans, 0),
      deltaToday: sumDelta('deltaToday'),
      delta7d: sumDelta('delta7d'),
      platforms: withData.length,
    },
  };
}
