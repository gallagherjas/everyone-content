import { createContext, useContext, useMemo } from "react";
import { parseTime } from '../../lib/time';
import type { CollectionSchedules } from '../../lib/collection-schedule';
import { useInvalidatePages } from './components/PageCache';
export { formatTime as fmtTime, parseTime } from '../../lib/time';

export const AccountContext = createContext<number | null>(null);
export async function api<T>(path: string, init?: RequestInit, accountId?: number | null): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(accountId ? { "x-everyone-content-account": String(accountId) } : {}), ...init?.headers } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `请求失败（${res.status}）`);
  }
  return res.json();
}
// 请求闭包绑定账号，切换账号时已发起的保存/发布不会转向新账号。
export function useApi() {
  const id = useContext(AccountContext);
  const invalidate = useInvalidatePages();
  return useMemo(() => async <T,>(path: string, init?: RequestInit) => {
    const result = await api<T>(path, init, id);
    if (!['GET', 'HEAD'].includes((init?.method ?? 'GET').toUpperCase())) invalidate();
    return result;
  }, [id, invalidate]);
}

export interface AccountConfig {
  schedules: CollectionSchedules;
  index: { discovery: Record<string, unknown> | null; tasks: {type: string; id?: string; keyword?: string; name?: string}[] };
}
export interface Account {
  id: number; name: string; platform: string; profile_url: string; status: "active" | "archived";
  config: AccountConfig; strategy_sha: string | null;
}

// 计量统一千分位纯数字,不用万/k缩写
export const fmtNum = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US');

export const relTime = (s: string | null) => {
  const date = parseTime(s);
  if (!date) return "—";
  const diff = Date.now() - date.getTime();
  const h = diff / 3600_000;
  if (h < 1) return "刚刚";
  if (h < 24) return `${Math.floor(h)} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};
