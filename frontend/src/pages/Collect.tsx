import { useCallback, useEffect, useRef, useState } from "react";
import { useApi, fmtTime, type Account } from "../api";
import { Badge, ConfirmBtn, Msg, Toggle, type BadgeTone } from "../components/Common";
import { Page } from "../components/Layout";
import PlatformAuthorization from "../components/PlatformAuthorization";
import CollectionSchedule, { type Budget } from "../components/CollectionSchedule";
import CollectionControls, { CollectionRunResult, SourceBlocker, useManualCollection } from "../components/CollectionControls";
import CollectionQueue from "../components/CollectionQueue";
import type { CollectionTaskStatus } from "../../../collector/core/status";
import type { BloggerSearchStatus } from "../../../collector/core/bloggers";
import type { CollectionProvider } from "../../../lib/collection-schedule";
import ExcludeKeywords from "../components/ExcludeKeywords";
import { names, operations, reason, searchLabels, searchMessage, statuses } from "../labels";
import { useCachedLoad, useInvalidatePages, usePageVisible, KeepAlive } from "../components/PageCache";
import Pager, { usePaged } from "../components/Pager";

interface Run { id: number; provider: CollectionProvider; operation: string; target: string; status: string; observed_at: string; version: string | null; error: string | null }
interface State { tasks: CollectionTaskStatus[]; runs: Run[]; budgets: Budget[]; credentials: Record<string, boolean>; blockers: Record<CollectionProvider, string | null>; queue: { total: number; due: number }; discovery: { keywords: string[] } | null }
interface Source { id: number; name: string }
interface BloggerRow extends Partial<BloggerSearchStatus> { id: number; kind: "blogger" | "blogger_search"; name: string; status: string; userId?: string; options?: { core?: boolean; info?: boolean }; lastCollectAt?: string | null }

const RUN_TONE: Record<string, BadgeTone> = { ok: "up", failed: "danger", running: "warn", cached: "gray", deferred: "warn" };
/** 单个来源的今日额度卡：用量/上限 + 细进度条；未连接的来源弱化展示 */
function BudgetCard({ label, used, limit, connected }: { label: string; used: number; limit: number; connected: boolean }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return <div className={`min-w-36 flex-1 rounded-xl border border-line bg-canvas px-4 py-3 ${connected ? "" : "opacity-50"}`}>
    <div className="flex items-baseline justify-between gap-2 text-sm"><span className="text-muted">{label}</span><span className="tabular-nums">{used}/{limit}</span></div>
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]"><div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-danger" : "bg-brand"}`} style={{ width: `${pct}%` }} /></div>
  </div>;
}

export default function CollectPage({ current, onUpdate, jumpTo }: { current: Account; onUpdate: (account: Account) => void; jumpTo?: { section: string } | null }) {
  const api = useApi(), archived = current.status === "archived";
  const visible = usePageVisible(), invalidate = useInvalidatePages();
  const manualRun = useManualCollection();
  const [section, setSection] = useState("overview");
  // 提醒中的操作可以直接打开连接或日志。
  useEffect(() => { if (jumpTo?.section) setSection(jumpTo.section); }, [jumpTo]);
  const [state, setState] = useState<State | null>(null);
  const [src, setSrc] = useState<{ keywords: Source[] }>({ keywords: [] }), [keyword, setKeyword] = useState(""), [bloggerName, setBloggerName] = useState("");
  const [bloggers, setBloggers] = useState<BloggerRow[]>([]);
  const [runDetail, setRunDetail] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(false), [message, setMessage] = useState("");
  const lastRuns = useRef<string | null>(null);

  const load = useCallback(() => api<State>("/api/collection").then(value => {
    setState(value);
    const runs = value.runs.map(run => `${run.id}:${run.status}`).join(',');
    if (lastRuns.current !== null && lastRuns.current !== runs) invalidate(['monitor', 'sources']);
    lastRuns.current = runs;
  }), [api, invalidate]);
  useCachedLoad('collection', load);
  useCachedLoad('sources', useCallback(() => api<{ keywords: Source[] }>("/api/sources").then(setSrc).catch(() => {}), [api]));
  const loadBloggers = useCallback(() => api<BloggerRow[]>("/api/bloggers").then(setBloggers).catch(() => {}), [api]);
  useCachedLoad('bloggers', loadBloggers);
  // 昵称解析与博主首轮采集是异步任务：有进行中的登记时轮询刷新列表。
  useEffect(() => {
    if (!visible || !bloggers.some(b => b.kind === "blogger_search" && b.status === "ready")) return;
    const timer = setTimeout(loadBloggers, 3000);
    return () => clearTimeout(timer);
  }, [visible, bloggers, loadBloggers]);
  useEffect(() => { if (!visible) return; const timer = setInterval(load, 10000); return () => clearInterval(timer); }, [visible, load]);
  const action = async (fn: () => Promise<unknown>, text: string) => {
    if (busy) return; setBusy(true); setFailure(false); setMessage("");
    try { const value = await fn(); setMessage(typeof value === "string" ? value : text); }
    catch (e) { setFailure(true); setMessage(String(e)); }
    finally { setBusy(false); }
  };
  const addKeyword = () => {
    if (archived || !keyword.trim()) return;
    void action(async () => {
      await api("/api/keywords", { method: "POST", body: JSON.stringify({ keyword }) });
      setKeyword("");
      invalidate(["collection", "sources"]);
    }, "已保存并重新筛选。");
  };
  const runPage = usePaged(state?.runs ?? []);
  const tracked = bloggers.filter(b => b.kind === "blogger"), pending = bloggers.filter(b => b.kind === "blogger_search");
  const indexBlocker = state?.blockers?.index;
  const onConnect = () => { setMessage(""); setSection("auth"); };
  const onResume = (provider: CollectionProvider) => void action(
    () => api("/api/collection/resume", { method: "POST", body: JSON.stringify({ provider }) }), "已恢复采集。");
  const removeBlogger = (id: number) => void action(
    () => api(`/api/bloggers/${id}`, { method: "DELETE" }), "已移出。");

  return <Page head="采集" active={section} onPick={key => { setSection(key); setMessage(""); setRunDetail(null); }} items={[
    { key: "overview", label: "总览" },
    { key: "auth", label: "连接" },
    { key: "schedule", label: "定时" },
    { key: "keywords", label: "采集词" },
    { key: "bloggers", label: "博主" },
    { key: "queue", label: "队列" },
    { key: "logs", label: "日志" },
  ]}>
    <div className="space-y-5">
      <KeepAlive active={section === "overview"}><section className="panel">
        <h2 className="font-semibold text-xl">采集总览</h2>
        <p className="mt-1.5 text-sm text-muted">额度跨账号共用，每日北京时间 00:00 重置。</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[...(state?.budgets ?? [])].sort((a, b) => (a.provider === 'index' ? 0 : 1) - (b.provider === 'index' ? 0 : 1))
            .map(b => <BudgetCard key={b.provider} label={names[b.provider] ?? b.provider} used={b.used} limit={b.daily_limit} connected={!!state?.credentials?.[b.provider]} />)}
        </div>
        <CollectionControls archived={archived} credentials={state?.credentials} blockers={state?.blockers}
          hasKeywords={!!state?.discovery?.keywords.length} hasBloggers={bloggers.some(row => row.status === "ready")}
          run={manualRun} onConnect={onConnect} onResume={onResume} />
      </section>
      <section className="panel">
        <h2 className="font-semibold text-xl">采集规则</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-6 text-muted">
          <li>话题榜与视频榜按采集词分别查询。视频采集近 7 天和近 30 天两个窗口，达人指数随视频榜更新。</li>
          <li>排除关键词全程生效：话题名称、视频标题或标签、达人昵称命中任一词即排除。</li>
          <li>页面按指数排名展示榜单：话题 Top20、视频 Top200（可切近7天/近30天口径与类型）、达人 Top10。</li>
          <li>博主走达友域单独采集：添加时搜索定位，此后每天一次作品榜，日增曲线与资料页按开关追加。</li>
        </ol>
        <p className="mt-2 text-xs leading-6 text-muted">删除采集词和调整排除词会重新筛选已有数据。新增采集词后，可在上方补采话题榜和视频榜。</p>
      </section></KeepAlive>

      <KeepAlive active={section === "keywords"}><section className="panel space-y-5">
        <h2 className="font-semibold text-xl">采集词</h2>
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="source-keyword">采集关键词<span className="ml-2 text-xs font-normal text-muted">{src.keywords.length} 个</span></label>
          <p className="text-xs leading-6 text-muted">用于抖音指数的话题与视频查询，每个关键词每天消耗 3 次额度。</p>
          <div className="flex gap-2">
            <input id="source-keyword" className="field flex-1" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="例如：效率工具、职场技能、日常生活" aria-label="新增关键词" maxLength={80} disabled={archived}
              onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) addKeyword(); }} />
            <button className="btn-primary shrink-0" disabled={archived || busy || !keyword.trim()}
              onClick={addKeyword}>添加</button>
          </div>
          <div className="flex flex-wrap gap-2">{src.keywords.map(s => <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-canvas pl-3 pr-1 text-sm" key={s.id}>
            <span className="break-all">{s.name}</span>
            <button type="button" className="rounded-full px-2 py-1 text-muted hover:text-danger disabled:opacity-40" aria-label={`移除关键词“${s.name}”`} disabled={archived || busy}
              onClick={() => void action(async () => {
                await api(`/api/sources/${s.id}`, { method: "DELETE" });
                invalidate(["collection", "sources"]);
              }, "已移出关键词并重新筛选。")}>×</button>
          </span>)}{!src.keywords.length && <p className="text-sm text-muted">尚未添加</p>}</div>
        </div>
        <ExcludeKeywords disabled={archived} />
      </section></KeepAlive>

      <KeepAlive active={section === "bloggers"}><section className="panel">
        <h2 className="font-semibold text-xl">博主追踪</h2>
        <p className="mt-2 text-sm text-muted">输入抖音昵称经指数搜索定位后开始追踪；作品榜固定 1 次/天，日增曲线与资料页按开关追加。数据浏览见「博主」页。</p>
        <div className="mt-3 flex gap-2">
          <input className="field min-w-0 flex-1" value={bloggerName} onChange={e => setBloggerName(e.target.value)} placeholder="例如：AI 造物笔记" aria-label="博主昵称" maxLength={80} disabled={archived} />
          <button className="btn-primary shrink-0" disabled={archived || busy || indexBlocker !== null || !bloggerName.trim()}
            onClick={() => void action(async () => { await api("/api/bloggers", { method: "POST", body: JSON.stringify({ keyword: bloggerName }) }); setBloggerName(""); }, "已登记昵称，等待解析。")}>添加</button>
        </div>
        {indexBlocker && <div className="mt-3"><SourceBlocker error={indexBlocker} disabled={archived || busy || !!manualRun.active}
          onConnect={onConnect} onResume={() => onResume('index')} /></div>}
        {pending.length > 0 && <div className="mt-3 space-y-2">
          {pending.map(p => {
            const detail = p.searchState !== "blocked" && searchMessage(p);
            return <div key={p.id} className="rounded-lg border border-line/70 bg-canvas/50 px-3 py-2.5">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex-1 font-medium">{p.name}</span>
                <span className="text-xs text-muted">{searchLabels[p.searchState ?? "queued"]}</span>
                <ConfirmBtn label="移出" confirmLabel="确认移出" disabled={archived || busy} onConfirm={() => removeBlogger(p.id)} />
              </div>
              {detail && <p className="text-xs text-muted">{detail}</p>}
            </div>;
          })}
        </div>}
        {!!tracked.length && <div className="mt-4 space-y-2">
          {tracked.map(b => <div key={b.id} className="rounded-lg border border-line/70 bg-canvas/50 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">{b.name}</span>
              <span className="flex items-baseline gap-3 text-xs text-muted tabular-nums">
                <span>{1 + (b.options?.core ? 1 : 0) + (b.options?.info ? 1 : 0)} 次/天</span>
                <span>{b.lastCollectAt ? `最近采集 ${fmtTime(b.lastCollectAt)}` : "尚未采集"}</span>
                <ConfirmBtn label="移出" confirmLabel="确认移出" disabled={busy}
                  onConfirm={() => removeBlogger(b.id)} />
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-2.5">
              <Toggle checked={b.status === "ready"} disabled={busy} label="追踪中" hint="暂停不消耗额度"
                onChange={v => void action(async () => { await api(`/api/bloggers/${b.id}`, { method: "PUT", body: JSON.stringify({ status: v ? "ready" : "paused" }) }); loadBloggers(); }, "已更新。")} />
              <Toggle checked={!!b.options?.core} disabled={busy} label="日增曲线" hint="+1 次/天"
                onChange={v => void action(async () => { await api(`/api/bloggers/${b.id}`, { method: "PUT", body: JSON.stringify({ core: v }) }); loadBloggers(); }, "已更新，下轮采集生效。")} />
              <Toggle checked={!!b.options?.info} disabled={busy} label="资料页" hint="+1 次/天"
                onChange={v => void action(async () => { await api(`/api/bloggers/${b.id}`, { method: "PUT", body: JSON.stringify({ info: v }) }); loadBloggers(); }, "已更新，下轮采集生效。")} />
            </div>
          </div>)}
        </div>}
      </section></KeepAlive>

      <KeepAlive active={section === "queue"}>
        <CollectionQueue tasks={state?.tasks} counts={state?.queue}
          bloggerNames={new Map(tracked.filter(b => b.userId).map(b => [b.userId!, b.name]))} />
      </KeepAlive>

      <KeepAlive active={section === "logs"}><section className="panel">
        <h2 className="font-semibold text-xl">采集日志</h2>
        <p className="mt-2 text-sm text-muted">时间均为北京时间。“查看记录”展示本次采集的入库数据。</p>
        <div className="mt-4 space-y-2">{runPage.slice.map(r => <div key={r.id} className="rounded-lg border border-line/70 bg-canvas/50 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 tabular-nums">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="w-24 shrink-0 text-muted">{names[r.provider]}</span>
              <span className="w-28 shrink-0 text-muted">{operations[r.operation] ?? r.operation}</span>
              {r.target !== r.operation && <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.target}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
              <span className="w-36">{fmtTime(r.observed_at)}</span>
              {r.version && <span className="w-32">数据版本 {r.version}</span>}
              <Badge tone={RUN_TONE[r.status] ?? "gray"}>{statuses[r.status] ?? r.status}</Badge>
              {r.status === "ok" && <a className="link ml-1" href="#" onClick={e => {
                e.preventDefault();
                if (runDetail?.id === r.id) { setRunDetail(null); return; }
                api<{ observed_at: string }>(`/api/collection/records/${r.id}`)
                  .then(data => setRunDetail({ id: r.id, text: JSON.stringify({ ...data, observed_at: fmtTime(data.observed_at) }, null, 2) }))
                  .catch(err => { setFailure(true); setMessage(String(err)); });
              }}>{runDetail?.id === r.id ? '收起记录' : '查看记录'}</a>}
              {r.status === "failed" && <button type="button"
                className="link ml-1 shrink-0 enabled:cursor-pointer disabled:cursor-not-allowed disabled:text-faint disabled:no-underline"
                disabled={archived || !!manualRun.active || state?.blockers?.[r.provider] !== null}
                title={reason(state?.blockers?.[r.provider] ?? null) ?? undefined}
                aria-label={`重试${operations[r.operation] ?? r.operation}记录 ${r.id}`}
                onClick={() => void manualRun.start(r.id)}>
                {manualRun.active?.target === r.id ? `重试中 ${manualRun.active.percent}%` : "重试"}
              </button>}
            </span>
          </div>
          {r.error && <p className={`mt-1 break-words text-xs leading-5 ${r.status === "failed" ? "text-danger" : "text-muted"}`} title={r.error}>{reason(r.error)}</p>}
          <CollectionRunResult result={manualRun.result} target={r.id} />
          {runDetail?.id === r.id && <div className="codebox mt-2 max-h-96">{runDetail.text}</div>}
        </div>)}</div>
        {!state?.runs.length && <p className="py-4 text-sm text-muted">尚无采集记录；手动采集后生成。</p>}
        <Pager {...runPage} />
      </section></KeepAlive>

      <KeepAlive active={section === "auth"}><section className="panel space-y-6">
        <PlatformAuthorization disabled={archived} />
      </section></KeepAlive>
      <KeepAlive active={section === "schedule"}><section className="panel space-y-6">
        <h2 className="font-semibold text-xl">定时采集</h2>
        <CollectionSchedule account={current} onSaved={onUpdate} budgets={state?.budgets} credentials={state?.credentials} />
      </section></KeepAlive>

      {message && <Msg tone={failure ? "error" : "ok"}><span className="block max-h-96 overflow-auto whitespace-pre-wrap break-all">{message}</span></Msg>}
    </div>
  </Page>;
}
