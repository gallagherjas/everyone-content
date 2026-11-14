import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccountContext, useApi } from "../api";
import { names, reason } from "../labels";
import { usePageVersions } from "./PageCache";

interface Issue { kind: "paused" | "disabled" | "run_failed"; provider?: string; error?: string; count?: number }
interface NoticesData {
  auth: { provider: string }[];
  issues: Issue[];
  bloggers: { id: number; name: string; latest: string | null; items: { title: string; url: string; addedAt: string }[] }[];
}
type BloggerRow = NoticesData["bloggers"][number] & { count: number };

// 博主已读水位按账号隔离，值为服务端返回的 UTC 时间字符串，同格式可直接比较。
const seenKey = (account: number) => `everyone-content-blogger-seen-${account}`;
const readSeen = (account: number): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(seenKey(account)) ?? "{}"); } catch { return {}; }
};
const writeSeen = (account: number, value: Record<string, string>) =>
  localStorage.setItem(seenKey(account), JSON.stringify(value));

interface NoticesState {
  auth: NoticesData["auth"];
  issues: Issue[];
  bloggers: BloggerRow[];
  bloggerCount: number;
  collectIssue: number;
  markBloggerSeen: (id: number) => void;
}
const NoticesState = createContext<NoticesState>({ auth: [], issues: [], bloggers: [], bloggerCount: 0, collectIssue: 0, markBloggerSeen: () => {} });

/** 采集异常的悬浮明细文案(采集页红点用)，与横幅共用 names/reason 口径 */
export const issueText = (auth: NoticesData["auth"], issues: Issue[]) => [
  ...auth.map((a) => `${names[a.provider] ?? a.provider}登录已失效，请重新连接`),
  ...issues.map((i) => i.kind === "paused" ? `${names[i.provider!] ?? i.provider}采集暂停：${reason(i.error ?? null) ?? i.error}`
    : i.kind === "disabled" ? `${i.count} 个采集任务被禁用（${reason(i.error ?? null) ?? i.error}）`
    : "最近一轮采集失败，可到「日志」查看"),
].join("；");

/** 提醒中心：轮询 /api/notices 派生红点与横幅素材；博主红点按博主记水位，点开详情才算已读 */
export function NoticesProvider({ children }: { children: ReactNode }) {
  // 提醒中心只挂在账号工作区内，账号上下文必为当前账号编号。
  const accountId = useContext(AccountContext)!;
  const api = useApi();
  const versions = usePageVersions();
  const [data, setData] = useState<NoticesData | null>(null);
  const [seen, setSeen] = useState<Record<string, string>>(() => readSeen(accountId));
  // 挂载即拉取，此后 20 秒一轮；写操作或采集完成(页面版本变化)立即刷新。
  useEffect(() => {
    let alive = true;
    const load = () => api<NoticesData>("/api/notices").then((value) => { if (alive) setData(value); }).catch(() => {});
    load();
    const timer = setInterval(load, 20000);
    return () => { alive = false; clearInterval(timer); };
  }, [api, versions]);
  // 首次见到的博主不回放历史：水位静默初始化为当前最新，此后新增才算未读。
  useEffect(() => {
    if (!data) return;
    setSeen((current) => {
      if (data.bloggers.every((b) => String(b.id) in current)) return current;
      const next = { ...current };
      for (const b of data.bloggers) if (!(String(b.id) in next)) next[b.id] = b.latest ?? "";
      writeSeen(accountId, next);
      return next;
    });
  }, [data, accountId]);
  const bloggers = useMemo(() => (data?.bloggers ?? []).map((b) => ({
    ...b, count: b.items.filter((item) => item.addedAt > (seen[b.id] ?? "")).length,
  })), [data, seen]);
  const markBloggerSeen = useCallback((id: number) => {
    const latest = data?.bloggers.find((b) => b.id === id)?.latest;
    if (!latest) return;
    setSeen((current) => {
      if ((current[id] ?? "") >= latest) return current;
      const next = { ...current, [id]: latest };
      writeSeen(accountId, next);
      return next;
    });
  }, [data, accountId]);
  const value = useMemo(() => ({
    auth: data?.auth ?? [],
    issues: data?.issues ?? [],
    bloggers,
    bloggerCount: bloggers.reduce((n, b) => n + b.count, 0),
    collectIssue: (data?.auth.length ?? 0) + (data?.issues.length ?? 0),
    markBloggerSeen,
  }), [data, bloggers, markBloggerSeen]);
  return <NoticesState.Provider value={value}>{children}</NoticesState.Provider>;
}
export const useNotices = () => useContext(NoticesState);

/** 登录失效横幅：常驻直到重新连接，按钮直达「采集 → 连接」。 */
export function NoticeBanner({ onConnect }: { onConnect: () => void }) {
  const { auth } = useNotices();
  if (!auth.length) return null;
  const label = names[auth[0].provider] ?? auth[0].provider;
  return <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warn/10 px-4 py-2.5 text-sm text-warn">
    <span>{auth.length > 1 ? `${label} 等 ${auth.length} 个平台登录已失效，相关采集已暂停。` : `${label}登录已失效，相关采集已暂停。`}</span>
    <button type="button" onClick={onConnect}
      className="shrink-0 rounded-xl border border-warn/50 px-3.5 py-1 text-xs text-warn transition hover:bg-warn/15">去连接</button>
  </div>;
}
