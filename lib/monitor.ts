import type { DatabaseSync } from 'node:sqlite';
import { COLLECTION_DAY_MS, collectionDay } from './time.ts';
import { SNAPSHOT_PLATFORMS } from '../collector/sources/platform/snapshot.ts';
import { connectionStatus } from '../collector/core/availability.ts';

interface SnapshotPoint { at: string; fans: number | null; likes: number | null; works: number | null; views: number | null }

const PROVIDERS = Object.keys(SNAPSHOT_PLATFORMS);
// 趋势按同一快照版本取最后一次成功结果。
export function monitorOverview(db: DatabaseSync, accountId: number, now = Date.now()) {
  const today = collectionDay(now), weekAgo = collectionDay(now - 7 * COLLECTION_DAY_MS);
  const platforms: Record<string, any> = {};
  for (const provider of PROVIDERS) {
    const connection = connectionStatus(db, accountId, provider);
    const rows = db.prepare(`SELECT r.version,r.at_ms,o.metrics FROM collection_observations o
      JOIN collection_runs r ON r.id=o.run_id JOIN collection_run_accounts x ON x.run_id=r.id
      WHERE x.account_id=? AND r.provider=? AND o.kind='account' AND r.status='ok'
      ORDER BY r.at_ms DESC,r.id DESC LIMIT 300`).all(accountId, provider) as any[];
    const byDay = new Map<string, SnapshotPoint>();
    for (const row of rows) {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(row.version ?? '') ? row.version : collectionDay(Number(row.at_ms));
      if (!byDay.has(day)) byDay.set(day, { at: day, ...JSON.parse(row.metrics) });
    }
    const series = [...byDay.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-31);
    const latest = series.at(-1) ?? null;
    const weekBase = [...series].reverse().find(p => p.at <= weekAgo) ?? (series.length > 1 ? series[0] : undefined);
    const diffFans = (base: SnapshotPoint | undefined): number | null => {
      const cur = latest?.fans, prev = base?.fans;
      return cur == null || prev == null ? null : cur - prev;
    };
    platforms[provider] = {
      ...connection,
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
