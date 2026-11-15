import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AccountContext, useApi } from "../api";
import { names, reason } from "../labels";
import { usePageVersions } from "./PageCache";

type Issue =
  | { kind: "paused"; provider: string; error: string }
  | { kind: "disabled"; error: string; count: number }
  | { kind: "run_failed" | "run_partial" };
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
  markBloggerSeen: (id: number) => void;
}
const NoticesState = createContext<NoticesState>({ auth: [], issues: [], bloggers: [], bloggerCount: 0, markBloggerSeen: () => {} });

function describeIssue(issue: Issue) {
  if (issue.kind === "paused") return { title: `${names[issue.provider] ?? issue.provider}采集已暂停`, detail: reason(issue.error) };
  if (issue.kind === "disabled") return { title: `${issue.count} 个采集任务已停用`, detail: reason(issue.error) };
  return { title: issue.kind === "run_partial" ? "最近一轮部分采集失败" : "最近一轮采集失败", detail: null };
}

/** 轮询异常状态与博主新作品，博主详情打开时记录已读水位。 */
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
    markBloggerSeen,
  }), [data, bloggers, markBloggerSeen]);
  return <NoticesState.Provider value={value}>{children}</NoticesState.Provider>;
}
export const useNotices = () => useContext(NoticesState);

export function NoticeMenu({ onAction }: { onAction: (section: "auth" | "logs") => void }) {
  const { auth, issues } = useNotices();
  const [open, setOpen] = useState(false);
  const id = useId();
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const hasIssues = auth.length > 0 || issues.length > 0;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      if (container.current?.contains(document.activeElement)) trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const goTo = (section: "auth" | "logs") => {
    setOpen(false);
    trigger.current?.focus();
    onAction(section);
  };
  return <div ref={container} className="relative col-start-2 row-start-1 ml-auto shrink-0 self-center"
    onPointerEnter={event => { if (event.pointerType === "mouse") setOpen(true); }}
    onPointerLeave={event => {
      if (event.pointerType === "mouse" && !panel.current?.contains(document.activeElement)) setOpen(false);
    }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" aria-label="提醒" aria-description={hasIssues ? "有待处理的异常" : undefined}
      aria-controls={id} aria-expanded={open} onClick={() => setOpen(value => !value)}
      className="relative grid size-10 place-items-center rounded-lg text-ink transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-brand aria-expanded:text-brand">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
      {hasIssues && <span aria-hidden="true" className="absolute right-2 top-1.5 size-2 rounded-full bg-danger" />}
    </button>
    <div hidden={!open} className="absolute right-0 top-full z-10 w-[min(22rem,calc(100vw-2rem))] pt-2">
      <section ref={panel} id={id} aria-label="异常提醒"
        className="max-h-[min(26rem,65vh)] space-y-3 overflow-auto rounded-2xl border border-line bg-card p-4 shadow-lg">
        <h2 className="text-sm font-semibold">提醒</h2>
        {hasIssues ? <ul className="divide-y divide-line">
          {auth.map(({ provider }) => <li key={provider} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0 text-sm">
              <p>{names[provider] ?? provider}登录已失效</p>
              <p className="mt-0.5 text-xs text-muted">相关采集已暂停。</p>
            </div>
            <button className="btn-sm shrink-0" type="button" onClick={() => goTo("auth")}>去连接</button>
          </li>)}
          {issues.map(issue => {
            const { title, detail } = describeIssue(issue);
            return <li key={issue.kind === "paused" ? issue.provider + "-paused" : issue.kind === "disabled" ? issue.error + "-disabled" : issue.kind}
              className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0 text-sm">
                <p>{title}</p>
                {detail && <p className="mt-0.5 text-xs leading-5 text-muted">{detail}</p>}
              </div>
              <button className="btn-sm shrink-0" type="button" onClick={() => goTo("logs")}>查看日志</button>
            </li>;
          })}
        </ul> : <p className="text-sm text-muted">暂无异常。</p>}
      </section>
    </div>
  </div>;
}
