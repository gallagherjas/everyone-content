import { useCallback, useEffect, useRef, useState } from "react";
import { useApi, fmtTime, type Account } from "../api";
import { Badge, ConfirmBtn, Msg, Toggle, type BadgeTone } from "../components/Common";
import { Page } from "../components/Layout";
import PlatformAuthorization from "../components/PlatformAuthorization";
import CollectionSchedule from "../components/CollectionSchedule";
import ExcludeKeywords from "../components/ExcludeKeywords";
import { names, reason, statuses } from "../labels";
import { useCachedLoad, useInvalidatePages, usePageVisible, KeepAlive } from "../components/PageCache";
import Pager, { usePaged } from "../components/Pager";

interface Run { id: number; provider: string; operation: string; target: string; status: string; observed_at: string; version: string | null; error: string | null }
interface State { runs: Run[]; budgets: { provider: string; daily_limit: number; used: number }[]; credentials: Record<string, boolean>; queue: { total: number; due: number } }
interface Source { id: number; name: string }
interface BloggerRow { id: number; kind: "blogger" | "blogger_search"; name: string; status: string; resolving?: boolean; options?: { core?: boolean; info?: boolean }; lastCollectAt?: string | null }

const RUN_TONE: Record<string, BadgeTone> = { ok: "up", failed: "danger", running: "warn", cached: "gray", deferred: "warn" };

/** 单个来源的今日额度卡：用量/上限 + 细进度条；未连接的来源弱化展示 */
function BudgetCard({ label, used, limit, connected }: { label: string; used: number; limit: number; connected: boolean }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return <div className={`min-w-36 flex-1 rounded-xl border border-line bg-canvas px-4 py-3 ${connected ? "" : "opacity-50"}`}>
    <div className="flex items-baseline justify-between gap-2 text-sm"><span className="text-muted">{label}</span><span className="tabular-nums">{used}/{limit}</span></div>
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]"><div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-danger" : "bg-brand"}`} style={{ width: `${pct}%` }} /></div>
  </div>;
}

export default function CollectPage({ current, onUpdate }: { current: Account; onUpdate: (account: Account) => void }) {
  const api = useApi(), archived = current.status === "archived";
  const visible = usePageVisible(), invalidate = useInvalidatePages();
  const [section, setSection] = useState("overview");
  const [state, setState] = useState<State | null>(null), [percent, setPercent] = useState<number | null>(null);
  const [src, setSrc] = useState<{ keywords: Source[] }>({ keywords: [] }), [keyword, setKeyword] = useState(""), [bloggerName, setBloggerName] = useState("");
  const [bloggers, setBloggers] = useState<BloggerRow[]>([]);
  const [runDetail, setRunDetail] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(false), [message, setMessage] = useState("");
  const lastRuns = useRef<string | null>(null), wasRunning = useRef(false);

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
    if (!visible || !bloggers.some(b => b.resolving)) return;
    const timer = setTimeout(loadBloggers, 3000);
    return () => clearTimeout(timer);
  }, [visible, bloggers, loadBloggers]);
  // 采集进度轮询：完成后广播刷新各数据页，这里也是全工作台唯一的完成信号源。
  useEffect(() => {
    if (!visible) return; let alive = true;
    const poll = () => api<{ running: boolean; progress: number | null }>("/api/collection/progress").then(p => {
      if (!alive) return;
      setPercent(p.running ? (p.progress ?? 0) : null);
      if (p.running) wasRunning.current = true;
      else if (wasRunning.current) { wasRunning.current = false; load(); invalidate(['bloggers', 'monitor', 'sources']); setMessage("采集完成，结果已更新。"); }
    }).catch(() => {});
    poll();
    const timer = setInterval(poll, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [visible, load, invalidate, api]);
  useEffect(() => { if (!visible) return; const timer = setInterval(load, 10000); return () => clearInterval(timer); }, [visible, load]);

  const action = async (fn: () => Promise<unknown>, text: string) => {
    if (busy) return; setBusy(true); setFailure(false); setMessage("");
    try { const value = await fn(); setMessage(typeof value === "string" ? value : text); }
    catch (e) { setFailure(true); setMessage(String(e)); }
    finally { setBusy(false); }
  };
  const runPage = usePaged(state?.runs ?? []);
  const tracked = bloggers.filter(b => b.kind === "blogger"), pending = bloggers.filter(b => b.kind === "blogger_search");

  return <Page head="采集" active={section} onPick={key => { setSection(key); setMessage(""); setRunDetail(null); }} items={[
    { key: "overview", label: "总览" },
    { key: "auth", label: "授权" },
    { key: "schedule", label: "定时" },
    { key: "keywords", label: "采集词" },
    { key: "bloggers", label: "博主" },
    { key: "logs", label: "日志" },
  ]}>
    <div className="space-y-5">
      <KeepAlive active={section === "overview"}><section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-xl">采集总览</h2>
            <p className="mt-1.5 text-sm text-muted" title="每日采集次数上限，跨账号共用；每天北京时间08:00重置">
              队列 {state?.queue.total ?? '—'} 项 · 待执行 {state?.queue.due ?? '—'} 项；额度跨账号共用，每日 08:00 重置。
            </p>
          </div>
          {percent === null
            ? <button className="btn-primary" disabled={archived || busy} onClick={async () => { try { await api("/api/run/collect", { method: "POST" }); wasRunning.current = true; setPercent(0); setMessage(""); } catch (e) { setFailure(true); setMessage(String(e)); } }}>手动采集</button>
            : <button className="btn-progress"><span className="absolute inset-0 flex items-center justify-center">{percent}%</span><span className="absolute inset-0 flex items-center justify-center bg-brand text-white transition-[clip-path] duration-500" style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}>{percent}%</span></button>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(state?.budgets ?? []).map(b => <BudgetCard key={b.provider} label={names[b.provider] ?? b.provider} used={b.used} limit={b.daily_limit} connected={!!state?.credentials?.[b.provider]} />)}
        </div>
        <div className="mt-5 rounded-xl border border-line bg-canvas px-4 py-3">
          <p className="text-xs leading-6 text-brand">tips：了解规则前请先打开抖音指数了解其基本知识。</p>
          <p className="mt-1 text-sm font-medium">采集按 关键词 → 话题 → 视频 → 达人 逐级发现：</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-6 text-muted">
            <li>每个关键词搜索全部命中话题，以及近7天与近30天两个窗口的视频；不做数量与指数门槛限制。</li>
            <li>排除关键词全程生效：话题名称、视频标题或标签、达人昵称命中任一词即排除。</li>
            <li>页面按指数排名展示榜单：话题 Top20、视频 Top200（可切近7天/近30天口径与类型）、达人 Top10。</li>
            <li>博主走达友域单独采集：添加时搜索定位，此后每天一次作品榜，日增曲线与资料页按开关追加。</li>
          </ol>
          <p className="mt-2 text-xs leading-6 text-muted">调整采集词与排除词即时生效，现有数据立即按新规则重新整理，无需重新采集。</p>
        </div>
      </section></KeepAlive>

      <KeepAlive active={section === "keywords"}><section className="panel space-y-5">
        <h2 className="font-semibold text-xl">采集词</h2>
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="source-keyword">采集关键词<span className="ml-2 text-xs font-normal text-muted">{src.keywords.length} 个</span></label>
          <p className="text-xs leading-6 text-muted">用于抖音指数的话题与视频查询，每个关键词每天消耗 3 次额度。</p>
          <div className="flex gap-2">
            <input id="source-keyword" className="field flex-1" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="例如：效率工具、职场技能、日常生活" aria-label="新增关键词" maxLength={80} disabled={archived}
              onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void action(async () => { await api("/api/keywords", { method: "POST", body: JSON.stringify({ keyword }) }); setKeyword(""); load(); }, "已添加关键词。"); }} />
            <button className="btn-primary shrink-0" disabled={archived || busy || !keyword.trim()}
              onClick={() => void action(async () => { await api("/api/keywords", { method: "POST", body: JSON.stringify({ keyword }) }); setKeyword(""); load(); }, "已添加关键词。")}>添加</button>
          </div>
          <div className="flex flex-wrap gap-2">{src.keywords.map(s => <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-canvas pl-3 pr-1 text-sm" key={s.id}>
            <span className="break-all">{s.name}</span>
            <button type="button" className="rounded-full px-2 py-1 text-muted hover:text-danger disabled:opacity-40" aria-label={`移除关键词“${s.name}”`} disabled={archived || busy}
              onClick={() => void action(async () => { await api(`/api/sources/${s.id}`, { method: "DELETE" }); load(); }, "已移出。")}>×</button>
          </span>)}{!src.keywords.length && <p className="text-sm text-muted">尚未添加</p>}</div>
        </div>
        <ExcludeKeywords disabled={archived} />
      </section></KeepAlive>

      <KeepAlive active={section === "bloggers"}><section className="panel">
        <h2 className="font-semibold text-xl">博主追踪</h2>
        <p className="mt-2 text-sm text-muted">输入抖音昵称经指数搜索定位后开始追踪；作品榜固定 1 次/天，日增曲线与资料页按开关追加。数据浏览见「博主」页。</p>
        <div className="mt-3 flex gap-2">
          <input className="field min-w-0 flex-1" value={bloggerName} onChange={e => setBloggerName(e.target.value)} placeholder="例如：AI 造物笔记" aria-label="博主昵称" maxLength={80} disabled={archived} />
          <button className="btn-primary shrink-0" disabled={busy || !bloggerName.trim()}
            onClick={() => void action(async () => { await api("/api/bloggers", { method: "POST", body: JSON.stringify({ keyword: bloggerName }) }); setBloggerName(""); loadBloggers(); }, "已登记昵称，解析完成后出现在列表。")}>添加</button>
        </div>
        {pending.length > 0 && <p className="mt-3 text-sm text-muted">待解析：{pending.map(p => `${p.name}${p.status === "paused" ? "（未找到）" : ""}`).join("、")}</p>}
        {!!tracked.length && <div className="mt-4 space-y-2">
          {tracked.map(b => <div key={b.id} className="rounded-lg border border-line/70 bg-canvas/50 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">{b.name}</span>
              <span className="flex items-baseline gap-3 text-xs text-muted tabular-nums">
                <span>{1 + (b.options?.core ? 1 : 0) + (b.options?.info ? 1 : 0)} 次/天</span>
                <span>{b.lastCollectAt ? `最近采集 ${fmtTime(b.lastCollectAt)}` : "尚未采集"}</span>
                <ConfirmBtn label="移出" confirmLabel="确认移出" disabled={busy}
                  onConfirm={() => void action(async () => { await api(`/api/bloggers/${b.id}`, { method: "DELETE" }); loadBloggers(); }, "已移出。")} />
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

      <KeepAlive active={section === "logs"}><section className="panel">
        <h2 className="font-semibold text-xl">采集日志</h2>
        <p className="mt-2 text-sm text-muted">时间均为北京时间。“查看记录”展示本次采集的入库数据。</p>
        <div className="mt-4 space-y-2">{runPage.slice.map(r => <div key={r.id} className="rounded-lg border border-line/70 bg-canvas/50 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 tabular-nums">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="w-24 shrink-0 text-muted">{names[r.provider]}</span>
              <span className="w-28 shrink-0 text-muted">{r.operation}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.target}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
              <span className="w-36">{fmtTime(r.observed_at)}</span>
              {r.version && <span className="w-32">数据版本 {r.version}</span>}
              <Badge tone={RUN_TONE[r.status] ?? "gray"}>{statuses[r.status] ?? r.status}</Badge>
              {r.error && <span className="max-w-48 truncate text-danger">{reason(r.error)}</span>}
              {r.status === "ok" && <a className="link ml-1" href="#" onClick={e => {
                e.preventDefault();
                if (runDetail?.id === r.id) { setRunDetail(null); return; }
                api<{ observed_at: string }>(`/api/collection/records/${r.id}`)
                  .then(data => setRunDetail({ id: r.id, text: JSON.stringify({ ...data, observed_at: fmtTime(data.observed_at) }, null, 2) }))
                  .catch(err => { setFailure(true); setMessage(String(err)); });
              }}>{runDetail?.id === r.id ? '收起记录' : '查看记录'}</a>}
            </span>
          </div>
          {runDetail?.id === r.id && <div className="codebox mt-2 max-h-96">{runDetail.text}</div>}
        </div>)}</div>
        {!state?.runs.length && <p className="py-4 text-sm text-muted">尚无采集记录；手动采集后生成。</p>}
        <Pager {...runPage} />
      </section></KeepAlive>

      <KeepAlive active={section === "auth"}><section className="panel space-y-6">
        <h2 className="font-semibold text-xl">平台授权</h2>
        <PlatformAuthorization disabled={archived} />
      </section></KeepAlive>
      <KeepAlive active={section === "schedule"}><section className="panel space-y-6">
        <h2 className="font-semibold text-xl">定时采集</h2>
        <CollectionSchedule account={current} onSaved={onUpdate} />
      </section></KeepAlive>

      {message && <Msg tone={failure ? "error" : "ok"}><span className="block max-h-96 overflow-auto whitespace-pre-wrap break-all">{message}</span></Msg>}
    </div>
  </Page>;
}
